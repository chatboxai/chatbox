import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import {
  SessionRowConflictError,
  type SessionRowSqlBatchOptions,
  type SessionRowSqlBindValue,
  type SessionRowSqlDatabase,
  type SessionRowSqlStatement,
  SqlSessionRowStore,
} from '@chatbox/core'
import {
  INSERT_MESSAGE_NAVIGATION_SQL,
  stagedMetadataStatements,
  textTokenCleanupStatement,
} from '@chatbox/core/persistence'
import type {
  GeneratingMessageRef,
  SessionBranchMessagesRequest,
  SessionBranchPreviewRequest,
  SessionMessageMetadataRequest,
  SessionMessageRelationsRequest,
  SessionMessagesRequest,
  SessionMessagesSnapshot,
  SessionNavigationPage,
  SessionNavigationRepairRequest,
  SessionRowCommit,
  SessionRowIterationRequest,
  SessionRowSnapshot,
  SessionRowStorePort,
  SessionRowsDiff,
  SessionTextTokenResult,
  SessionTextTokenSource,
  SessionThreadPage,
  SessionThreadPageRequest,
  SessionThreadRead,
  SessionThreadRequest,
  SessionThreadStateRequest,
  SessionTokenCacheRequest,
  SessionTokenCacheResult,
  SessionTranscriptPage,
  SessionTranscriptRequest,
} from '@chatbox/core/ports'
import type { MessageRowStatus } from '@chatbox/core/session/session-tree'

const DB_NAME = 'chatbox-messages'

const BRIDGE_CALL_LIMIT = 512 * 1024
const BRIDGE_BATCH_TARGET = 480 * 1024
const TEXT_SLICE_CHARACTERS = 16 * 1024
const STAGING_INSERT_BIND_LIMIT = 900
const encoder = new TextEncoder()
let mutationSequence = 0

const THREAD_COLUMNS =
  'session_id, thread_id, seq, name, created_at, root_message_id, active_leaf_message_id, compaction_points_json, session_prompt_context_snapshot_json, session_record_json, commit_revision, projection_json'
const MESSAGE_COLUMNS =
  'session_id, message_id, thread_id, parent_message_id, active_child_id, seq, kind, status, created_at, updated_at, branch_id, payload_id, payload_utf8_length, row_metadata_json, selected_depth, message_json'
const INSERT_STAGED_MESSAGE_SQL = `INSERT OR REPLACE INTO session_messages_staging (mutation_id, ${MESSAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
interface NativeStatement {
  statement: string
  values: SessionRowSqlBindValue[]
}

function createMutationId(): string {
  mutationSequence += 1
  const runtimeCrypto = (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto
  return runtimeCrypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${mutationSequence.toString(36)}`
}

function utf8Size(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

function splitText(value: string): string[] {
  const slices: string[] = []
  for (let offset = 0; offset < value.length; ) {
    let end = Math.min(value.length, offset + TEXT_SLICE_CHARACTERS)
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--
    slices.push(value.slice(offset, end))
    offset = end
  }
  return slices
}

function toNative(statement: SessionRowSqlStatement): NativeStatement {
  return { statement: statement.sql, values: statement.params }
}

function revisionGuardStatement(sessionId: string, expectedRevision: number | null): SessionRowSqlStatement {
  return expectedRevision === null
    ? {
        sql: 'INSERT INTO session_row_revision_guard (value) SELECT 1 WHERE EXISTS (SELECT 1 FROM session_row_heads WHERE session_id = ?)',
        params: [sessionId],
      }
    : {
        sql: 'INSERT INTO session_row_revision_guard (value) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM session_row_heads WHERE session_id = ? AND revision = ?)',
        params: [sessionId, expectedRevision],
      }
}

function* splitNativeBatches(statements: Iterable<SessionRowSqlStatement>): Generator<NativeStatement[]> {
  let current: NativeStatement[] = []
  let currentBytes = 2 // JSON array brackets.
  for (const statement of statements) {
    const native = toNative(statement)
    const nativeBytes = utf8Size(native)
    if (nativeBytes + 2 > BRIDGE_CALL_LIMIT) {
      throw new Error('session row statement exceeds the Capacitor bridge limit')
    }
    const separatorBytes = current.length > 0 ? 1 : 0
    if (current.length > 0 && currentBytes + separatorBytes + nativeBytes > BRIDGE_BATCH_TARGET) {
      yield current
      current = [native]
      currentBytes = nativeBytes + 2
    } else {
      current.push(native)
      currentBytes += separatorBytes + nativeBytes
    }
  }
  if (current.length > 0) yield current
}

function coalesceStagingInserts(batch: NativeStatement[]): NativeStatement[] {
  const result: NativeStatement[] = []
  const groups = new Map<string, NativeStatement[]>()
  const flush = () => {
    for (const [sql, rows] of groups) {
      const width = rows[0].values.length
      const rowLimit = Math.floor(STAGING_INSERT_BIND_LIMIT / width)
      const tupleStart = sql.indexOf(' VALUES ') + ' VALUES '.length
      for (let offset = 0; offset < rows.length; offset += rowLimit) {
        const selected = rows.slice(offset, offset + rowLimit)
        result.push({
          statement: sql.slice(0, tupleStart) + selected.map(() => sql.slice(tupleStart)).join(', '),
          values: selected.flatMap((row) => row.values),
        })
      }
    }
    groups.clear()
  }
  // These tables have no foreign keys or INSERT triggers. Only reorder their
  // inserts inside one native transaction, retaining each table's row order.
  // Updates, deletes, thread writes and every transaction boundary are barriers.
  for (const statement of batch) {
    const width =
      statement.statement === INSERT_STAGED_MESSAGE_SQL
        ? 17
        : statement.statement === INSERT_MESSAGE_NAVIGATION_SQL
          ? 4
          : 0
    if (width === 0 || statement.values.length !== width) {
      flush()
      result.push(statement)
      continue
    }
    const group = groups.get(statement.statement)
    if (group) group.push(statement)
    else groups.set(statement.statement, [statement])
  }
  flush()
  // Keep the original batch boundary if a statement cannot be coalesced safely.
  return utf8Size(result) <= BRIDGE_BATCH_TARGET ? result : batch
}

function stageJsonColumns(
  params: SessionRowSqlBindValue[],
  indexes: Array<{ index: number; column: string }>,
  append: (column: string, chunk: string) => void
): SessionRowSqlBindValue[] {
  const staged = [...params]
  for (const { index, column } of indexes) {
    const value = staged[index]
    if (typeof value !== 'string' || utf8Size(value) <= 32 * 1024) continue
    staged[index] = ''
    for (const chunk of splitText(value)) append(column, chunk)
  }
  return staged
}

class CapacitorSessionRowSqlDatabase implements SessionRowSqlDatabase {
  readonly maxStatementBytes = BRIDGE_CALL_LIMIT - 1024
  private operationTail: Promise<void> = Promise.resolve()

  constructor(private readonly connect: () => Promise<SQLiteDBConnection>) {}

  execute(sql: string): Promise<void> {
    return this.enqueue(async () => {
      const database = await this.connect()
      // Flatten schema statements for iOS token boundaries; Android splits batches on ';\n'.
      const statements = sql
        .split(/;\s*(?:\n|$)/)
        .map((statement) => statement.replaceAll('\n', ' ').trim())
        .filter(Boolean)
      await database.execute(`${statements.join(';\n')};\n`)
    })
  }

  query<T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> {
    return this.enqueue(async () => {
      const database = await this.connect()
      const result = await database.query(sql, params)
      return (result.values ?? []) as T[]
    })
  }

  executeBatch(statements: Iterable<SessionRowSqlStatement>, options?: SessionRowSqlBatchOptions): Promise<void> {
    if (Array.isArray(statements) && statements.length === 0) return Promise.resolve()
    return this.enqueue(async () => {
      const database = await this.connect()
      if (!options) {
        for (const batch of splitNativeBatches(statements)) {
          await database.executeSet(batch, true)
        }
        return
      }
      await this.executeStagedBatch(database, statements, options)
    })
  }

  private async executeStagedBatch(
    database: SQLiteDBConnection,
    statements: Iterable<SessionRowSqlStatement>,
    options: SessionRowSqlBatchOptions
  ): Promise<void> {
    if (options.mode === 'delete') {
      await this.executeDeleteBatch(database, Array.from(statements), options)
      return
    }
    const mutationId = createMutationId()
    if (options.mode === 'local-diff') {
      const direct: SessionRowSqlStatement[] = []
      if (options.expectedRevision !== undefined) {
        direct.push(revisionGuardStatement(options.sessionId, options.expectedRevision))
      }
      direct.push(...statements)
      if (options.resultRevision !== undefined) {
        direct.push({
          sql: 'INSERT OR REPLACE INTO session_row_heads (session_id, revision, mutation_id) VALUES (?, ?, ?)',
          params: [options.sessionId, options.resultRevision, mutationId],
        })
      }
      if (utf8Size(direct.map(toNative)) <= BRIDGE_BATCH_TARGET) {
        await this.executeRevisionedPublish(database, direct, options, mutationId)
        return
      }
      throw new Error('Local row publication exceeds the native bridge budget')
    }
    const prepare: SessionRowSqlStatement[] = [
      {
        sql: 'INSERT INTO session_row_staging_mutations (mutation_id, created_at) VALUES (?, ?)',
        params: [mutationId, Date.now()],
      },
      { sql: 'DELETE FROM session_threads_staging WHERE mutation_id = ?', params: [mutationId] },
      { sql: 'DELETE FROM session_messages_staging WHERE mutation_id = ?', params: [mutationId] },
    ]
    const staged = this.toStagingStatements(statements, mutationId, options)
    const tokenCleanup = textTokenCleanupStatement(options.sessionId)
    const cleanup: SessionRowSqlStatement[] = [
      { sql: 'DELETE FROM session_row_local_metadata WHERE mutation_id=?', params: [mutationId] },
      { sql: 'DELETE FROM session_threads_staging WHERE mutation_id = ?', params: [mutationId] },
      { sql: 'DELETE FROM session_messages_staging WHERE mutation_id = ?', params: [mutationId] },
      {
        sql: 'DELETE FROM session_message_navigation WHERE NOT EXISTS (SELECT 1 FROM session_messages WHERE session_messages.payload_id = session_message_navigation.payload_id) AND NOT EXISTS (SELECT 1 FROM session_messages_staging WHERE session_messages_staging.payload_id = session_message_navigation.payload_id)',
        params: [],
      },
      { sql: 'DELETE FROM session_row_staging_mutations WHERE mutation_id = ?', params: [mutationId] },
    ]

    try {
      await this.executeBounded(database, prepare)
      await this.executeBounded(database, staged, true)

      const publish: SessionRowSqlStatement[] = []
      if (options.expectedRevision !== undefined) {
        publish.push(revisionGuardStatement(options.sessionId, options.expectedRevision))
      }
      publish.push(
        { sql: 'DELETE FROM session_threads WHERE session_id = ?', params: [options.sessionId] },
        { sql: 'DELETE FROM session_messages WHERE session_id = ?', params: [options.sessionId] },
        {
          sql: `INSERT INTO session_threads (${THREAD_COLUMNS}) SELECT ${THREAD_COLUMNS} FROM session_threads_staging WHERE mutation_id = ?`,
          params: [mutationId],
        },
        {
          sql: `INSERT INTO session_messages (${MESSAGE_COLUMNS}) SELECT ${MESSAGE_COLUMNS} FROM session_messages_staging WHERE mutation_id = ?`,
          params: [mutationId],
        },
        tokenCleanup,
        ...cleanup
      )
      if (options.resultRevision !== undefined) {
        publish.splice(publish.length - cleanup.length, 0, {
          sql: 'INSERT OR REPLACE INTO session_row_heads (session_id, revision, mutation_id) VALUES (?, ?, ?)',
          params: [options.sessionId, options.resultRevision, mutationId],
        })
      }

      await this.executeRevisionedPublish(database, publish, options, mutationId)
    } catch (error) {
      try {
        await this.executeBounded(database, cleanup)
      } catch {
        // Staging rows are invisible and can be reclaimed by the next initialization.
      }
      throw error
    }
  }

  private async executeRevisionedPublish(
    database: SQLiteDBConnection,
    statements: SessionRowSqlStatement[],
    options: SessionRowSqlBatchOptions,
    mutationId: string
  ): Promise<void> {
    try {
      await database.executeSet(statements.map(toNative), true)
    } catch (error) {
      const head = await database.query('SELECT revision, mutation_id FROM session_row_heads WHERE session_id = ?', [
        options.sessionId,
      ])
      const current = head.values?.[0] as { revision?: number | null; mutation_id?: string } | undefined
      if (current?.mutation_id === mutationId) return
      if (options.expectedRevision !== undefined && (current?.revision ?? null) !== options.expectedRevision) {
        throw new SessionRowConflictError(options.sessionId, options.expectedRevision, current?.revision ?? null)
      }
      throw error
    }
  }

  private async executeDeleteBatch(
    database: SQLiteDBConnection,
    statements: SessionRowSqlStatement[],
    options: SessionRowSqlBatchOptions
  ): Promise<void> {
    const mutationId = createMutationId()
    const publish: SessionRowSqlStatement[] = []
    if (options.expectedRevision !== undefined) {
      publish.push(revisionGuardStatement(options.sessionId, options.expectedRevision))
    }
    publish.push(...statements, {
      sql: 'INSERT OR REPLACE INTO session_row_delete_receipts (session_id, mutation_id, deleted_at) VALUES (?, ?, ?)',
      params: [options.sessionId, mutationId, Date.now()],
    })
    try {
      await database.executeSet(publish.map(toNative), true)
    } catch (error) {
      const receipt = await database.query(
        'SELECT mutation_id FROM session_row_delete_receipts WHERE session_id = ? AND mutation_id = ? LIMIT 1',
        [options.sessionId, mutationId]
      )
      if ((receipt.values?.[0] as { mutation_id?: string } | undefined)?.mutation_id === mutationId) return
      const active = await database.query(
        'SELECT revision AS commit_revision FROM session_row_heads WHERE session_id = ? LIMIT 1',
        [options.sessionId]
      )
      const actualRevision = (active.values?.[0] as { commit_revision?: number | null } | undefined)?.commit_revision
      if (options.expectedRevision !== undefined && (actualRevision ?? null) !== options.expectedRevision) {
        throw new SessionRowConflictError(options.sessionId, options.expectedRevision, actualRevision ?? null)
      }
      throw error
    }
  }

  private *toStagingStatements(
    statements: Iterable<SessionRowSqlStatement>,
    mutationId: string,
    options: SessionRowSqlBatchOptions
  ): Generator<SessionRowSqlStatement> {
    for (const statement of statements) {
      switch (statement.kind) {
        case 'delete-session-threads':
        case 'delete-session-messages':
          if (options.mode !== 'replace') throw new Error('session-wide delete is invalid in a row diff')
          break
        case 'upsert-thread': {
          const sessionId = String(statement.params[0])
          const threadId = String(statement.params[1])
          const appends: SessionRowSqlStatement[] = []
          const params = stageJsonColumns(
            statement.params,
            [
              { index: 3, column: 'name' },
              { index: 7, column: 'compaction_points_json' },
              { index: 8, column: 'session_prompt_context_snapshot_json' },
              { index: 9, column: 'session_record_json' },
              { index: 11, column: 'projection_json' },
            ],
            (column, chunk) => {
              appends.push({
                sql: `UPDATE session_threads_staging SET ${column} = ${column} || ? WHERE mutation_id = ? AND session_id = ? AND thread_id = ?`,
                params: [chunk, mutationId, sessionId, threadId],
              })
            }
          )
          yield {
            sql: `INSERT OR REPLACE INTO session_threads_staging (mutation_id, ${THREAD_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [mutationId, ...params],
          }
          yield* appends
          break
        }
        case 'upsert-message': {
          const appends: SessionRowSqlStatement[] = []
          const params = stageJsonColumns(statement.params, [{ index: 15, column: 'message_json' }], (column, part) =>
            appends.push({
              sql: `UPDATE session_messages_staging SET ${column}=${column}||? WHERE mutation_id=? AND session_id=? AND message_id=?`,
              params: [part, mutationId, statement.params[0], statement.params[1]],
            })
          )
          const metadata = params[13]
          const largeMetadata = typeof metadata === 'string' && utf8Size(metadata) > 32 * 1024
          if (largeMetadata) params[13] = null
          yield { sql: INSERT_STAGED_MESSAGE_SQL, params: [mutationId, ...params] }
          yield* appends
          if (largeMetadata) yield* stagedMetadataStatements(mutationId, String(params[0]), String(params[1]), metadata)
          break
        }
        case 'insert-message-navigation':
          yield statement
          break
        case 'delete-orphan-message-navigation':
        case 'delete-stale-text-tokens':
          break
        default:
          throw new Error('session row statement is missing staging metadata')
      }
    }
  }

  private async executeBounded(
    database: SQLiteDBConnection,
    statements: Iterable<SessionRowSqlStatement>,
    coalesce = false
  ): Promise<void> {
    for (const batch of splitNativeBatches(statements)) {
      await database.executeSet(coalesce ? coalesceStagingInserts(batch) : batch, true)
    }
  }

  private enqueue<Result>(action: () => Promise<Result>): Promise<Result> {
    const result = this.operationTail.catch(() => undefined).then(action)
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

/** Capacitor-backed thread and message row storage for the mobile clients. */
export class SQLiteSessionRowStore implements SessionRowStorePort {
  readTextTokenResults(sources: readonly SessionTextTokenSource[]): Promise<SessionTextTokenResult[]> {
    return this.store.readTextTokenResults(sources)
  }

  acceptTextTokenResults(results: readonly SessionTextTokenResult[]): Promise<SessionTextTokenResult[]> {
    return this.store.acceptTextTokenResults(results)
  }
  private readonly sqlite: SQLiteConnection
  private readonly store: SqlSessionRowStore
  private connectPromise: Promise<SQLiteDBConnection> | null = null

  constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite)
    this.store = new SqlSessionRowStore(new CapacitorSessionRowSqlDatabase(() => this.connect()))
  }

  initialize(): Promise<void> {
    return this.store.initialize()
  }

  readSnapshot(sessionId: string): Promise<SessionRowSnapshot | null> {
    return this.store.readSnapshot(sessionId)
  }

  repairNavigationProjections(request: SessionNavigationRepairRequest): Promise<void> {
    return this.store.repairNavigationProjections(request)
  }
  readMessageMetadata(request: SessionMessageMetadataRequest) {
    return this.store.readMessageMetadata(request)
  }
  readMessageRelationsPage(request: SessionMessageRelationsRequest) {
    return this.store.readMessageRelationsPage(request)
  }
  readThreadState(request: SessionThreadStateRequest) {
    return this.store.readThreadState(request)
  }
  readThreadSummariesPage(request: SessionThreadPageRequest) {
    return this.store.readThreadSummariesPage(request)
  }
  readBranchPreview(request: SessionBranchPreviewRequest) {
    return this.store.readBranchPreview(request)
  }
  readBranchMessagesPage(request: SessionBranchMessagesRequest) {
    return this.store.readBranchMessagesPage(request)
  }
  readCommit(sessionId: string): Promise<SessionRowCommit | null> {
    return this.store.readCommit(sessionId)
  }
  readThread(request: SessionThreadRequest): Promise<SessionThreadRead | null> {
    return this.store.readThread(request)
  }
  readTranscriptWindow(request: SessionTranscriptRequest): Promise<SessionTranscriptPage | null> {
    return this.store.readTranscriptWindow(request)
  }
  readNavigationPage(request: SessionTranscriptRequest): Promise<SessionNavigationPage | null> {
    return this.store.readNavigationPage(request)
  }

  readThreadsPage(request: SessionThreadPageRequest): Promise<SessionThreadPage | null> {
    return this.store.readThreadsPage(request)
  }

  readTokenCache(request: SessionTokenCacheRequest) {
    return this.store.readTokenCache(request)
  }
  acceptTokenCache(results: readonly SessionTokenCacheResult[]) {
    return this.store.acceptTokenCache(results)
  }

  readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSnapshot | null> {
    return this.store.readMessages(request)
  }

  writeRows(snapshot: SessionRowSnapshot, expectedRevision?: number | null): Promise<void> {
    return this.store.writeRows(snapshot, expectedRevision)
  }

  applyDiff(diff: SessionRowsDiff, commit: SessionRowCommit, expectedRevision?: number) {
    return this.store.applyDiff(diff, commit, expectedRevision)
  }

  deleteRows(sessionId: string, expectedRevision?: number | null): Promise<void> {
    return this.store.deleteRows(sessionId, expectedRevision)
  }

  hasRows(sessionId: string): Promise<boolean> {
    return this.store.hasRows(sessionId)
  }

  getRevision(sessionId: string): Promise<number | null> {
    return this.store.getRevision(sessionId)
  }

  iterateRows(request: SessionRowIterationRequest) {
    return this.store.iterateRows(request)
  }

  stageRows(commit: SessionRowCommit, expectedRevision: number | null) {
    return this.store.stageRows(commit, expectedRevision)
  }

  stageImportRows(commit: SessionRowCommit, expectedRevision: number | null, jobId: string) {
    return this.store.stageImportRows(commit, expectedRevision, jobId)
  }

  resumeImportRows(candidateId: string) {
    return this.store.resumeImportRows(candidateId)
  }

  collectImportGarbage(): Promise<void> {
    return this.store.collectImportGarbage()
  }

  listSessionIds(): Promise<string[]> {
    return this.store.listSessionIds()
  }

  findMessagesByStatus(status: MessageRowStatus): Promise<GeneratingMessageRef[]> {
    return this.store.findMessagesByStatus(status)
  }

  private connect(): Promise<SQLiteDBConnection> {
    if (!this.connectPromise) {
      this.connectPromise = this.openDatabase().catch((error: unknown) => {
        this.connectPromise = null
        throw error
      })
    }
    return this.connectPromise
  }

  private async openDatabase(): Promise<SQLiteDBConnection> {
    try {
      await this.sqlite.closeConnection(DB_NAME, false)
    } catch {
      // ignore - connection may not exist
    }

    const database = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
    await database.open()
    return database
  }
}
