import type { BackupPageLimits } from '@chatbox/core/backup'
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import {
  SessionRowConflictError,
  type SessionRowSqlBatchOptions,
  type SessionRowSqlBindValue,
  type SessionRowSqlDatabase,
  type SessionRowSqlStatement,
  SqlSessionRowStore,
} from '@chatbox/core'
import { textTokenCleanupStatement } from '@chatbox/core/persistence'
import type {
  GeneratingMessageRef,
  SessionContextRequest,
  SessionContextRows,
  SessionMessagesRequest,
  SessionMessagesSnapshot,
  SessionMessageWindow,
  SessionMessageWindowRequest,
  SessionThreadPage,
  SessionThreadPageRequest,
  SessionThreadSuffixRequest,
  SessionStructureSnapshot,
  SessionRowCommit,
  SessionRowSnapshot,
  SessionRowStorePort,
  SessionRowsDiff,
  SessionTextTokenResult,
  SessionTextTokenSource,
} from '@chatbox/core/ports'
import type { MessageRowStatus } from '@chatbox/core/session/session-tree'

const DB_NAME = 'chatbox-messages'

const BRIDGE_CALL_LIMIT = 512 * 1024
const BRIDGE_BATCH_TARGET = 480 * 1024
const TEXT_CHUNK_LIMIT = 128 * 1024
const STAGING_INSERT_BIND_LIMIT = 900
const encoder = new TextEncoder()
let mutationSequence = 0

const THREAD_COLUMNS =
  'session_id, thread_id, seq, name, created_at, root_message_id, active_leaf_message_id, compaction_points_json, session_prompt_context_snapshot_json, session_record_json, commit_revision'
const MESSAGE_COLUMNS =
  'session_id, message_id, thread_id, parent_message_id, active_child_id, seq, kind, status, created_at, updated_at, branch_id, payload_id, payload_chunk_count, payload_utf8_length'
const INSERT_STAGED_MESSAGE_SQL = `INSERT OR REPLACE INTO session_messages_staging (mutation_id, ${MESSAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
const INSERT_PAYLOAD_CHUNK_SQL =
  'INSERT OR REPLACE INTO session_message_payload_chunks (session_id, payload_id, chunk_index, value) VALUES (?, ?, ?, ?)'

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
  const chunks: string[] = []
  let current = ''
  let size = 0
  for (const codePoint of value) {
    const pointSize = encoder.encode(codePoint).byteLength
    if (current && size + pointSize > TEXT_CHUNK_LIMIT) {
      chunks.push(current)
      current = ''
      size = 0
    }
    current += codePoint
    size += pointSize
  }
  if (current || value.length === 0) chunks.push(current)
  return chunks
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

function canStageSelectedMessages(statements: SessionRowSqlStatement[], options: SessionRowSqlBatchOptions): boolean {
  const { expectedRevision, resultRevision } = options
  if (
    options.mode !== 'diff' ||
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    typeof resultRevision !== 'number' ||
    !Number.isSafeInteger(resultRevision) ||
    resultRevision <= expectedRevision ||
    statements.at(-2)?.kind !== 'update-session-commit' ||
    statements.at(-1)?.kind !== 'delete-orphan-message-payloads'
  )
    return false
  let messageCount = 0
  for (let index = 0; index < statements.length - 2; index += 1) {
    const statement = statements[index]
    if (statement.kind === 'upsert-message' || statement.kind === 'upsert-message-metadata') messageCount += 1
    else if (statement.kind === 'delete-stale-text-tokens' && statement.params.length === 2) continue
    else if (statement.kind !== 'insert-message-payload-chunk') return false
  }
  return messageCount > 0
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
  // These two tables have no foreign keys or triggers. Only reorder their
  // inserts inside one native transaction, retaining each table's row order.
  // Updates, deletes, thread writes and every transaction boundary are barriers.
  for (const statement of batch) {
    const width =
      statement.statement === INSERT_STAGED_MESSAGE_SQL ? 15 : statement.statement === INSERT_PAYLOAD_CHUNK_SQL ? 4 : 0
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
    if (typeof value !== 'string') continue
    staged[index] = ''
    for (const chunk of splitText(value)) append(column, chunk)
  }
  return staged
}

class CapacitorSessionRowSqlDatabase implements SessionRowSqlDatabase {
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
    const diffStatements = options.mode === 'diff' ? Array.from(statements) : null
    if (diffStatements) {
      const direct: SessionRowSqlStatement[] = []
      if (options.expectedRevision !== undefined) {
        direct.push(revisionGuardStatement(options.sessionId, options.expectedRevision))
      }
      direct.push(...diffStatements)
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
    }
    const selectedMessagesOnly = diffStatements !== null && canStageSelectedMessages(diffStatements, options)
    const prepare: SessionRowSqlStatement[] = [
      {
        sql: 'INSERT INTO session_row_staging_mutations (mutation_id, created_at) VALUES (?, ?)',
        params: [mutationId, Date.now()],
      },
      { sql: 'DELETE FROM session_threads_staging WHERE mutation_id = ?', params: [mutationId] },
      { sql: 'DELETE FROM session_messages_staging WHERE mutation_id = ?', params: [mutationId] },
    ]
    if (options.mode === 'diff') {
      prepare.push({
        sql: `INSERT INTO session_threads_staging (mutation_id, ${THREAD_COLUMNS}) SELECT ?, ${THREAD_COLUMNS} FROM session_threads WHERE session_id = ?`,
        params: [mutationId, options.sessionId],
      })
      // Upsert-only diffs publish only their selected rows. Other diffs stage a
      // complete metadata image so thread and message deletions retain their scope.
      if (!selectedMessagesOnly) {
        prepare.push({
          sql: `INSERT INTO session_messages_staging (mutation_id, ${MESSAGE_COLUMNS}) SELECT ?, ${MESSAGE_COLUMNS} FROM session_messages WHERE session_id = ?`,
          params: [mutationId, options.sessionId],
        })
      }
    }

    const stagingStatements = this.toStagingStatements(diffStatements ?? statements, mutationId, options)
    const staged = diffStatements ? Array.from(stagingStatements) : stagingStatements
    const tokenCleanup =
      options.mode === 'replace' || diffStatements?.some((statement) => statement.kind === 'delete-stale-text-tokens')
        ? textTokenCleanupStatement(options.sessionId)
        : undefined
    if (tokenCleanup && selectedMessagesOnly) {
      tokenCleanup.sql += ' AND message_id IN (SELECT message_id FROM session_messages_staging WHERE mutation_id = ?)'
      tokenCleanup.params.push(mutationId)
    }
    const cleanup: SessionRowSqlStatement[] = [
      { sql: 'DELETE FROM session_threads_staging WHERE mutation_id = ?', params: [mutationId] },
      { sql: 'DELETE FROM session_messages_staging WHERE mutation_id = ?', params: [mutationId] },
      {
        sql: 'DELETE FROM session_message_payload_chunks WHERE session_id = ? AND NOT EXISTS (SELECT 1 FROM session_messages WHERE session_messages.payload_id = session_message_payload_chunks.payload_id) AND NOT EXISTS (SELECT 1 FROM session_messages_staging WHERE session_messages_staging.payload_id = session_message_payload_chunks.payload_id)',
        params: [options.sessionId],
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
        ...(selectedMessagesOnly
          ? []
          : [{ sql: 'DELETE FROM session_messages WHERE session_id = ?', params: [options.sessionId] }]),
        {
          sql: `INSERT INTO session_threads (${THREAD_COLUMNS}) SELECT ${THREAD_COLUMNS} FROM session_threads_staging WHERE mutation_id = ?`,
          params: [mutationId],
        },
        {
          sql: `INSERT${selectedMessagesOnly ? ' OR REPLACE' : ''} INTO session_messages (${MESSAGE_COLUMNS}) SELECT ${MESSAGE_COLUMNS} FROM session_messages_staging WHERE mutation_id = ?`,
          params: [mutationId],
        },
        ...(tokenCleanup ? [tokenCleanup] : []),
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
            ],
            (column, chunk) => {
              appends.push({
                sql: `UPDATE session_threads_staging SET ${column} = ${column} || ? WHERE mutation_id = ? AND session_id = ? AND thread_id = ?`,
                params: [chunk, mutationId, sessionId, threadId],
              })
            }
          )
          yield {
            sql: `INSERT OR REPLACE INTO session_threads_staging (mutation_id, ${THREAD_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [mutationId, ...params],
          }
          yield* appends
          break
        }
        case 'upsert-message-metadata': {
          yield {
            sql: statement.sql
              .replace(
                'INSERT OR REPLACE INTO session_messages (',
                'INSERT OR REPLACE INTO session_messages_staging (mutation_id, '
              )
              .replace(') VALUES (', ') VALUES (?, '),
            params: [mutationId, ...statement.params],
          }
          break
        }
        case 'upsert-message': {
          yield {
            sql: INSERT_STAGED_MESSAGE_SQL,
            params: [mutationId, ...statement.params],
          }
          break
        }
        case 'update-session-commit': {
          const sessionId = String(statement.params[2])
          const threadId = String(statement.params[3])
          const appends: SessionRowSqlStatement[] = []
          const params = stageJsonColumns(
            statement.params,
            [{ index: 0, column: 'session_record_json' }],
            (column, chunk) => {
              appends.push({
                sql: `UPDATE session_threads_staging SET ${column} = ${column} || ? WHERE mutation_id = ? AND session_id = ? AND thread_id = ?`,
                params: [chunk, mutationId, sessionId, threadId],
              })
            }
          )
          yield {
            sql: 'UPDATE session_threads_staging SET session_record_json = ?, commit_revision = ? WHERE mutation_id = ? AND session_id = ? AND thread_id = ?',
            params: [params[0], params[1], mutationId, params[2], params[3]],
          }
          yield* appends
          break
        }
        case 'insert-message-payload-chunk':
          yield statement
          break
        case 'delete-orphan-message-payloads':
        case 'delete-stale-text-tokens':
          break
        case 'delete-thread':
          yield {
            sql: 'DELETE FROM session_threads_staging WHERE mutation_id = ? AND session_id = ? AND thread_id = ?',
            params: [mutationId, ...statement.params],
          }
          break
        case 'delete-message':
          yield {
            sql: 'DELETE FROM session_messages_staging WHERE mutation_id = ? AND session_id = ? AND message_id = ?',
            params: [mutationId, ...statement.params],
          }
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

  readThreadsPage(request: SessionThreadPageRequest): Promise<SessionThreadPage | null> {
    return this.store.readThreadsPage(request)
  }

  readMessageWindow(request: SessionMessageWindowRequest): Promise<SessionMessageWindow | null> {
    return this.store.readMessageWindow(request)
  }

  readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSnapshot | null> {
    return this.store.readMessages(request)
  }

  readStructure(request: { sessionId: string; expectedRevision?: number }): Promise<SessionStructureSnapshot | null> {
    return this.store.readStructure(request)
  }

  readThreadSuffix(request: SessionThreadSuffixRequest): Promise<SessionMessagesSnapshot | null> {
    return this.store.readThreadSuffix(request)
  }

  readContext(
    request: SessionContextRequest,
    knownSnapshot?: Pick<SessionRowSnapshot, 'rows' | 'revision'>
  ): Promise<SessionContextRows | null> {
    return this.store.readContext(request, knownSnapshot)
  }

  writeRows(snapshot: SessionRowSnapshot, expectedRevision?: number | null): Promise<void> {
    return this.store.writeRows(snapshot, expectedRevision)
  }

  applyDiff(diff: SessionRowsDiff, commit: SessionRowCommit, expectedRevision?: number): Promise<void> {
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

  iterateBackupRows(sessionId: string, limits: BackupPageLimits, signal?: AbortSignal) {
    return this.store.iterateBackupRows(sessionId, limits, signal)
  }

  beginBackupRestore(sessionId: string) {
    return this.store.beginBackupRestore(sessionId)
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
