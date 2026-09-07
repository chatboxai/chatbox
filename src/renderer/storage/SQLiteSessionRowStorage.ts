import {
  CapacitorSQLite,
  type capSQLiteSet,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import {
  SessionRowConflictError,
  type SessionRowSqlBatchOptions,
  type SessionRowSqlBindValue,
  type SessionRowSqlDatabase,
  type SessionRowSqlStatement,
  SqlSessionRowStore,
} from '@chatbox/core'
import type {
  GeneratingMessageRef,
  SessionRowCommit,
  SessionRowSnapshot,
  SessionRowStorePort,
  SessionRowsDiff,
} from '@chatbox/core/ports'
import type { MessageRow, MessageRowStatus } from '@chatbox/core/session/session-tree'

const DB_NAME = 'chatbox-messages'

const BRIDGE_CALL_LIMIT = 512 * 1024
const BRIDGE_BATCH_TARGET = 480 * 1024
const TEXT_CHUNK_LIMIT = 128 * 1024
const encoder = new TextEncoder()
let mutationSequence = 0

const THREAD_COLUMNS =
  'session_id, thread_id, seq, name, created_at, root_message_id, active_leaf_message_id, compaction_points_json, session_prompt_context_snapshot_json, session_record_json, commit_revision'
const MESSAGE_COLUMNS =
  'session_id, message_id, thread_id, parent_message_id, active_child_id, seq, kind, status, created_at, updated_at, branch_id, payload_id, payload_chunk_count, payload_utf8_length'

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

function toNative(statement: SessionRowSqlStatement): capSQLiteSet {
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

function splitNativeBatches(statements: SessionRowSqlStatement[]): capSQLiteSet[][] {
  const batches: capSQLiteSet[][] = []
  let current: capSQLiteSet[] = []
  for (const statement of statements) {
    const native = toNative(statement)
    if (utf8Size([native]) > BRIDGE_CALL_LIMIT) {
      throw new Error('session row statement exceeds the Capacitor bridge limit')
    }
    const candidate = [...current, native]
    if (current.length > 0 && utf8Size(candidate) > BRIDGE_BATCH_TARGET) {
      batches.push(current)
      current = [native]
    } else {
      current = candidate
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
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
      await database.execute(sql)
    })
  }

  query<T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> {
    return this.enqueue(async () => {
      const database = await this.connect()
      const result = await database.query(sql, params)
      return (result.values ?? []) as T[]
    })
  }

  executeBatch(statements: SessionRowSqlStatement[], options?: SessionRowSqlBatchOptions): Promise<void> {
    if (statements.length === 0) return Promise.resolve()
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
    statements: SessionRowSqlStatement[],
    options: SessionRowSqlBatchOptions
  ): Promise<void> {
    if (options.mode === 'delete') {
      await this.executeDeleteBatch(database, statements, options)
      return
    }
    const mutationId = createMutationId()
    if (options.mode === 'diff') {
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
    }
    const prepare: SessionRowSqlStatement[] = [
      {
        sql: 'INSERT INTO session_row_staging_mutations (mutation_id, created_at) VALUES (?, ?)',
        params: [mutationId, Date.now()],
      },
      { sql: 'DELETE FROM session_threads_staging WHERE mutation_id = ?', params: [mutationId] },
      { sql: 'DELETE FROM session_messages_staging WHERE mutation_id = ?', params: [mutationId] },
    ]
    if (options.mode === 'diff') {
      prepare.push(
        {
          sql: `INSERT INTO session_threads_staging (mutation_id, ${THREAD_COLUMNS}) SELECT ?, ${THREAD_COLUMNS} FROM session_threads WHERE session_id = ?`,
          params: [mutationId, options.sessionId],
        },
        {
          sql: `INSERT INTO session_messages_staging (mutation_id, ${MESSAGE_COLUMNS}) SELECT ?, ${MESSAGE_COLUMNS} FROM session_messages WHERE session_id = ?`,
          params: [mutationId, options.sessionId],
        }
      )
    }

    const staged = this.toStagingStatements(statements, mutationId, options)
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
      await this.executeBounded(database, staged)

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

  private toStagingStatements(
    statements: SessionRowSqlStatement[],
    mutationId: string,
    options: SessionRowSqlBatchOptions
  ): SessionRowSqlStatement[] {
    const staged: SessionRowSqlStatement[] = []
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
          staged.push({
            sql: `INSERT OR REPLACE INTO session_threads_staging (mutation_id, ${THREAD_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [mutationId, ...params],
          })
          staged.push(...appends)
          break
        }
        case 'upsert-message': {
          staged.push({
            sql: `INSERT OR REPLACE INTO session_messages_staging (mutation_id, ${MESSAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [mutationId, ...statement.params],
          })
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
          staged.push({
            sql: 'UPDATE session_threads_staging SET session_record_json = ?, commit_revision = ? WHERE mutation_id = ? AND session_id = ? AND thread_id = ?',
            params: [params[0], params[1], mutationId, params[2], params[3]],
          })
          staged.push(...appends)
          break
        }
        case 'insert-message-payload-chunk':
          staged.push(statement)
          break
        case 'delete-orphan-message-payloads':
          break
        case 'delete-thread':
          staged.push({
            sql: 'DELETE FROM session_threads_staging WHERE mutation_id = ? AND session_id = ? AND thread_id = ?',
            params: [mutationId, ...statement.params],
          })
          break
        case 'delete-message':
          staged.push({
            sql: 'DELETE FROM session_messages_staging WHERE mutation_id = ? AND session_id = ? AND message_id = ?',
            params: [mutationId, ...statement.params],
          })
          break
        default:
          throw new Error('session row statement is missing staging metadata')
      }
    }
    return staged
  }

  private async executeBounded(database: SQLiteDBConnection, statements: SessionRowSqlStatement[]): Promise<void> {
    for (const batch of splitNativeBatches(statements)) {
      await database.executeSet(batch, true)
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

  listSessionIds(): Promise<string[]> {
    return this.store.listSessionIds()
  }

  upsertMessage(row: MessageRow): Promise<void> {
    return this.store.upsertMessage(row)
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
