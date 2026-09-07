import {
  type GeneratingMessageRef,
  SessionRowConflictError,
  type SessionRowCommit,
  type SessionRowSnapshot,
  SessionRowStoreError,
  type SessionRowStoreOperation,
  type SessionRowStorePort,
  type SessionRows,
  type SessionRowsDiff,
} from '../ports/session-row-store'
import type {
  MessageRow,
  MessageRowKind,
  MessageRowStatus,
  SessionRecordV2,
  ThreadRow,
} from '../session/session-tree/types'
import type { CompactionPoint, Message, SessionThread } from '../types/session'
import { CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL } from './capacitor-compatible-schema'

export type SessionRowSqlBindValue = string | number | null

export interface SessionRowSqlStatement {
  sql: string
  params: SessionRowSqlBindValue[]
  kind?:
    | 'delete-session-threads'
    | 'delete-session-messages'
    | 'guard-revision-exhaustion'
    | 'advance-session-revision'
    | 'update-session-commit'
    | 'upsert-thread'
    | 'upsert-message'
    | 'insert-message-payload-chunk'
    | 'delete-orphan-message-payloads'
    | 'delete-thread'
    | 'delete-message'
}

export interface SessionRowSqlBatchOptions {
  sessionId: string
  mode: 'replace' | 'diff' | 'delete'
  expectedRevision?: number | null
  resultRevision?: number
}

export interface SessionRowSqlDatabase {
  /** Runs DDL that may hold several statements. */
  execute(sql: string): Promise<void>
  query<T>(sql: string, params?: SessionRowSqlBindValue[]): Promise<T[]>
  /** Runs every statement in order inside one transaction; any failure rolls the whole batch back. */
  executeBatch(statements: SessionRowSqlStatement[], options?: SessionRowSqlBatchOptions): Promise<void>
}

interface ThreadRecord {
  session_id: string
  thread_id: string
  seq: number
  name: string | null
  created_at: number
  root_message_id: string | null
  active_leaf_message_id: string | null
  compaction_points_json: string
  session_prompt_context_snapshot_json: string | null
  session_record_json: string | null
  commit_revision: number | null
}

interface ThreadMetadataRecord {
  session_id: string
  thread_id: string
  seq: number
  name_length: number | null
  created_at: number
  root_message_id: string | null
  active_leaf_message_id: string | null
  compaction_points_json_length: number
  session_prompt_context_snapshot_json_length: number | null
  session_record_json_length: number | null
  commit_revision: number | null
}

interface MessageRecord {
  session_id: string
  message_id: string
  thread_id: string
  parent_message_id: string | null
  active_child_id: string | null
  seq: number
  kind: string
  status: string
  created_at: number
  updated_at: number
  branch_id: string | null
  payload_id: string
  payload_chunk_count: number
  payload_utf8_length: number
}

interface PayloadChunkRecord {
  payload_id: string
  chunk_index: number
  value: string
}

interface TextSliceRecord {
  value: string | null
}

interface MessagePagePlanRecord {
  page_count: number
  remaining_count: number
}

interface MessageRefRecord {
  session_id: string
  thread_id: string
  message_id: string
}

interface SessionIdRecord {
  session_id: string
}

const THREAD_COLUMNS =
  'session_id, thread_id, seq, name, created_at, root_message_id, active_leaf_message_id, compaction_points_json, session_prompt_context_snapshot_json, session_record_json, commit_revision'
const MESSAGE_COLUMNS =
  'session_id, message_id, thread_id, parent_message_id, active_child_id, seq, kind, status, created_at, updated_at, branch_id, payload_id, payload_chunk_count, payload_utf8_length'

const UPSERT_THREAD_SQL = `INSERT OR REPLACE INTO session_threads (${THREAD_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
const UPSERT_MESSAGE_SQL = `INSERT OR REPLACE INTO session_messages (${MESSAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
const INSERT_MESSAGE_PAYLOAD_CHUNK_SQL =
  'INSERT OR REPLACE INTO session_message_payload_chunks (session_id, payload_id, chunk_index, value) VALUES (?, ?, ?, ?)'
const DELETE_SESSION_THREADS_SQL = 'DELETE FROM session_threads WHERE session_id = ?'
const DELETE_SESSION_MESSAGES_SQL = 'DELETE FROM session_messages WHERE session_id = ?'
const GUARD_REVISION_EXHAUSTION_SQL =
  'INSERT INTO session_row_revision_guard (value) SELECT 1 FROM session_row_heads WHERE session_id = ? AND revision >= ?'
const ADVANCE_SESSION_REVISION_SQL =
  'UPDATE session_row_heads SET revision = revision + 1, mutation_id = ? WHERE session_id = ?'
const DELETE_THREAD_SQL = 'DELETE FROM session_threads WHERE session_id = ? AND thread_id = ?'
const DELETE_MESSAGE_SQL = 'DELETE FROM session_messages WHERE session_id = ? AND message_id = ?'
const UPDATE_SESSION_COMMIT_SQL =
  'UPDATE session_threads SET session_record_json = ?, commit_revision = ? WHERE session_id = ? AND thread_id = ?'
const SELECT_THREADS_PAGE_SQL =
  'SELECT session_id, thread_id, seq, length(name) AS name_length, created_at, root_message_id, active_leaf_message_id, length(compaction_points_json) AS compaction_points_json_length, length(session_prompt_context_snapshot_json) AS session_prompt_context_snapshot_json_length, length(session_record_json) AS session_record_json_length, commit_revision FROM session_threads WHERE session_id = ? ORDER BY seq, thread_id LIMIT ? OFFSET ?'
const SELECT_MESSAGES_PAGE_SQL = `SELECT ${MESSAGE_COLUMNS} FROM session_messages WHERE session_id = ? ORDER BY thread_id, seq, message_id LIMIT ? OFFSET ?`
const MESSAGE_RECORD_ESTIMATED_JSON_BYTES = `512
  + 6 * COALESCE(length(CAST(session_id AS BLOB)), 0)
  + 6 * COALESCE(length(CAST(message_id AS BLOB)), 0)
  + 6 * COALESCE(length(CAST(thread_id AS BLOB)), 0)
  + 6 * COALESCE(length(CAST(parent_message_id AS BLOB)), 0)
  + 6 * COALESCE(length(CAST(active_child_id AS BLOB)), 0)
  + 6 * COALESCE(length(CAST(kind AS BLOB)), 0)
  + 6 * COALESCE(length(CAST(status AS BLOB)), 0)
  + 6 * COALESCE(length(CAST(branch_id AS BLOB)), 0)
  + 6 * COALESCE(length(CAST(payload_id AS BLOB)), 0)`
const SELECT_MESSAGE_PAGE_PLAN_SQL = `
  WITH remaining AS (
    SELECT ${MESSAGE_COLUMNS}
    FROM session_messages
    WHERE session_id = ?
    ORDER BY thread_id, seq, message_id
    LIMIT -1 OFFSET ?
  ), sized AS (
    SELECT
      ROW_NUMBER() OVER (ORDER BY thread_id, seq, message_id) AS row_number,
      SUM(${MESSAGE_RECORD_ESTIMATED_JSON_BYTES}) OVER (ORDER BY thread_id, seq, message_id) AS response_bytes
    FROM remaining
  )
  SELECT
    COALESCE(MAX(CASE WHEN response_bytes <= ? THEN row_number END), 1) AS page_count,
    COUNT(*) AS remaining_count
  FROM sized`
const SELECT_SESSION_PRESENCE_SQL =
  'SELECT session_id FROM session_threads WHERE session_id = ? UNION SELECT session_id FROM session_messages WHERE session_id = ? LIMIT 1'
const SELECT_SESSION_IDS_SQL =
  'SELECT session_id FROM session_threads UNION SELECT session_id FROM session_messages ORDER BY session_id'
const SELECT_MESSAGE_REFS_BY_STATUS_SQL =
  'SELECT session_id, thread_id, message_id FROM session_messages WHERE status = ? ORDER BY session_id, thread_id, message_id'
const SELECT_SESSION_REVISION_SQL =
  'SELECT revision AS commit_revision FROM session_row_heads WHERE session_id = ? LIMIT 1'
const SELECT_MESSAGE_PAYLOAD_CHUNK_SQL =
  'SELECT payload_id, chunk_index, value FROM session_message_payload_chunks WHERE payload_id = ? AND chunk_index = ? LIMIT 1'
const DELETE_ORPHAN_MESSAGE_PAYLOADS_SQL =
  'DELETE FROM session_message_payload_chunks WHERE session_id = ? AND NOT EXISTS (SELECT 1 FROM session_messages WHERE session_messages.payload_id = session_message_payload_chunks.payload_id)'

const PAYLOAD_CHUNK_BYTES = 128 * 1024
const PAYLOAD_READ_BATCH_BYTES = 128 * 1024
const PAYLOAD_READ_BATCH_MESSAGES = 100
const THREAD_PAGE_SIZE = 8
// Keep a metadata response safely below Capacitor's 512 KiB bridge limit. The
// SQL planner applies a six-times JSON-escaping allowance to every text field
// plus fixed object/numeric overhead, then chooses the largest fitting page.
const MESSAGE_PAGE_RESPONSE_BUDGET = 384 * 1024
const THREAD_TEXT_SLICE_CHARACTERS = 32 * 1024
const STRUCTURAL_ID_BYTES = 1024
const textEncoder = new TextEncoder()
let payloadSequence = 0

interface RevisionRecord {
  commit_revision: number | null
}

function serializeJson(value: unknown, description: string): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new Error(`${description} is not JSON serializable`)
  }
  return serialized
}

function requireSessionId(sessionId: string, description: string): void {
  if (!sessionId) {
    throw new Error(`${description} is missing a sessionId`)
  }
  if (textEncoder.encode(sessionId).byteLength > STRUCTURAL_ID_BYTES) {
    throw new Error(`${description} has an oversized sessionId`)
  }
}

function requireStructuralId(value: string | null, description: string): void {
  if (value !== null && textEncoder.encode(value).byteLength > STRUCTURAL_ID_BYTES) {
    throw new Error(`${description} is oversized`)
  }
}

function validateThreadRow(thread: ThreadRow, sessionId: string): void {
  requireSessionId(thread.sessionId, 'thread row')
  if (!thread.threadId) {
    throw new Error('thread row is missing a threadId')
  }
  requireStructuralId(thread.threadId, 'threadId')
  requireStructuralId(thread.rootMessageId, `thread ${thread.threadId} rootMessageId`)
  requireStructuralId(thread.activeLeafMessageId, `thread ${thread.threadId} activeLeafMessageId`)
  if (thread.sessionId !== sessionId) {
    throw new Error(`thread ${thread.threadId} belongs to session ${thread.sessionId}`)
  }
  if (thread.seq !== -1 && thread.name === null) {
    throw new Error(`archived thread ${thread.threadId} is missing a name`)
  }
}

function validateMessageRow(message: MessageRow, sessionId: string): void {
  requireSessionId(message.sessionId, 'message row')
  if (!message.threadId) {
    throw new Error('message row is missing a threadId')
  }
  if (!message.messageId) {
    throw new Error('message row is missing a messageId')
  }
  requireStructuralId(message.threadId, `message ${message.messageId} threadId`)
  requireStructuralId(message.messageId, 'messageId')
  requireStructuralId(message.parentMessageId, `message ${message.messageId} parentMessageId`)
  requireStructuralId(message.activeChildId, `message ${message.messageId} activeChildId`)
  requireStructuralId(message.branchId, `message ${message.messageId} branchId`)
  if (message.sessionId !== sessionId) {
    throw new Error(`message ${message.messageId} belongs to session ${message.sessionId}`)
  }
}

function threadStatement(thread: ThreadRow, commit?: SessionRowCommit): SessionRowSqlStatement {
  const activeCommit = thread.seq === -1 ? commit : undefined
  return {
    kind: 'upsert-thread',
    sql: UPSERT_THREAD_SQL,
    params: [
      thread.sessionId,
      thread.threadId,
      thread.seq,
      thread.name,
      thread.createdAt,
      thread.rootMessageId,
      thread.activeLeafMessageId,
      serializeJson(thread.compactionPoints, `thread ${thread.threadId} compaction points`),
      thread.sessionPromptContextSnapshot === undefined
        ? null
        : serializeJson(thread.sessionPromptContextSnapshot, `thread ${thread.threadId} prompt context snapshot`),
      activeCommit ? serializeJson(activeCommit.record, `thread ${thread.threadId} session record`) : null,
      activeCommit?.revision ?? null,
    ],
  }
}

function createPayloadId(message: MessageRow): string {
  payloadSequence += 1
  const runtimeCrypto = (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto
  const nonce = runtimeCrypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${payloadSequence.toString(36)}`
  return `${message.sessionId}:${message.messageId}:${nonce}`
}

function splitPayload(value: string): string[] {
  const chunks: string[] = []
  let current = ''
  let size = 0
  for (const codePoint of value) {
    const pointSize = textEncoder.encode(codePoint).byteLength
    if (current && size + pointSize > PAYLOAD_CHUNK_BYTES) {
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

function messageStatements(message: MessageRow): SessionRowSqlStatement[] {
  const serialized = serializeJson(message.message, `message ${message.messageId}`)
  const payloadId = createPayloadId(message)
  const chunks = splitPayload(serialized)
  return [
    ...chunks.map(
      (chunk, index): SessionRowSqlStatement => ({
        kind: 'insert-message-payload-chunk',
        sql: INSERT_MESSAGE_PAYLOAD_CHUNK_SQL,
        params: [message.sessionId, payloadId, index, chunk],
      })
    ),
    {
      kind: 'upsert-message',
      sql: UPSERT_MESSAGE_SQL,
      params: [
        message.sessionId,
        message.messageId,
        message.threadId,
        message.parentMessageId,
        message.activeChildId,
        message.seq,
        message.kind,
        message.status,
        message.createdAt,
        message.updatedAt,
        message.branchId,
        payloadId,
        chunks.length,
        textEncoder.encode(serialized).byteLength,
      ],
    },
  ]
}

function toThreadRow(record: ThreadRecord): ThreadRow {
  const thread: ThreadRow = {
    sessionId: record.session_id,
    threadId: record.thread_id,
    seq: Number(record.seq),
    name: record.name,
    createdAt: Number(record.created_at),
    rootMessageId: record.root_message_id ?? null,
    activeLeafMessageId: record.active_leaf_message_id ?? null,
    compactionPoints: JSON.parse(record.compaction_points_json) as CompactionPoint[],
  }
  if (
    record.session_prompt_context_snapshot_json !== null &&
    record.session_prompt_context_snapshot_json !== undefined
  ) {
    thread.sessionPromptContextSnapshot = JSON.parse(
      record.session_prompt_context_snapshot_json
    ) as SessionThread['sessionPromptContextSnapshot']
  }
  return thread
}

function readCommitMetadata(sessionId: string, records: ThreadRecord[], revision: number | null): SessionRowCommit {
  const activeRows = records.filter((record) => Number(record.seq) === -1)
  if (activeRows.length !== 1) {
    throw new Error(`session ${sessionId} must have exactly one active thread row`)
  }
  const active = activeRows[0]
  if (active.session_record_json === null || active.commit_revision === null || revision === null) {
    throw new Error(`session ${sessionId} rows have no commit metadata`)
  }
  const commitRevision = Number(active.commit_revision)
  if (!Number.isSafeInteger(commitRevision) || commitRevision <= 0 || commitRevision !== revision) {
    throw new Error(`session ${sessionId} has inconsistent commit revisions`)
  }
  const record = JSON.parse(active.session_record_json) as SessionRecordV2
  if (record.id !== sessionId || record.activeThreadId !== active.thread_id) {
    throw new Error(`session ${sessionId} commit metadata does not match its active thread`)
  }
  return { record, revision: commitRevision }
}

function validateCommit(sessionId: string, threads: ThreadRow[], commit: SessionRowCommit): void {
  if (!Number.isSafeInteger(commit.revision) || commit.revision <= 0) {
    throw new Error(`session ${sessionId} has an invalid commit revision`)
  }
  const activeRows = threads.filter((thread) => thread.seq === -1)
  if (
    activeRows.length !== 1 ||
    commit.record.id !== sessionId ||
    commit.record.activeThreadId !== activeRows[0].threadId
  ) {
    throw new Error(`session ${sessionId} commit metadata does not match its active thread`)
  }
}

function updateCommitStatement(sessionId: string, commit: SessionRowCommit): SessionRowSqlStatement {
  return {
    kind: 'update-session-commit',
    sql: UPDATE_SESSION_COMMIT_SQL,
    params: [
      serializeJson(commit.record, `session ${sessionId} record`),
      commit.revision,
      sessionId,
      commit.record.activeThreadId,
    ],
  }
}

function toMessageRow(record: MessageRecord, message: Message): MessageRow {
  return {
    sessionId: record.session_id,
    threadId: record.thread_id,
    messageId: record.message_id,
    parentMessageId: record.parent_message_id ?? null,
    activeChildId: record.active_child_id ?? null,
    seq: Number(record.seq),
    kind: record.kind as MessageRowKind,
    status: record.status as MessageRowStatus,
    createdAt: Number(record.created_at),
    updatedAt: Number(record.updated_at),
    branchId: record.branch_id ?? null,
    message,
  }
}

/**
 * `SessionRowStorePort` over any SQLite driver reachable through
 * `SessionRowSqlDatabase`. Rows are validated and serialized before the first
 * database call, so a rejected write never reaches the driver. Drivers commit
 * each logical mutation atomically, with bridge-backed drivers free to prepare
 * invisible staging rows in bounded transactions first.
 */
export class SqlSessionRowStore implements SessionRowStorePort {
  private initializePromise: Promise<void> | null = null

  constructor(private readonly database: SessionRowSqlDatabase) {}

  initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.database.execute(CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL).catch((error: unknown) => {
        this.initializePromise = null
        throw new SessionRowStoreError('initialize', error)
      })
    }
    return this.initializePromise
  }

  async readSnapshot(sessionId: string): Promise<SessionRowSnapshot | null> {
    return await this.run('read-rows', sessionId, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const before = await this.readRevision(sessionId)
        let threadRecords: ThreadRecord[]
        let messageRecords: MessageRecord[]
        let messages: MessageRow[]
        try {
          const threadMetadata = await this.readPages<ThreadMetadataRecord>(
            SELECT_THREADS_PAGE_SQL,
            sessionId,
            THREAD_PAGE_SIZE
          )
          threadRecords = await this.readThreadRecords(threadMetadata)
          messageRecords = await this.readMessageRecords(sessionId)
          messages = await this.readMessageRows(messageRecords)
        } catch (error) {
          const afterFailure = await this.readRevision(sessionId)
          if (before !== afterFailure) continue
          throw error
        }
        const after = await this.readRevision(sessionId)
        if (before !== after) continue
        if (threadRecords.length === 0 && messageRecords.length === 0) {
          return null
        }
        const commit = readCommitMetadata(sessionId, threadRecords, after)
        return { rows: { sessionId, threads: threadRecords.map(toThreadRow), messages }, ...commit }
      }
      throw new Error(`session ${sessionId} changed repeatedly while it was being read`)
    })
  }

  async writeRows(snapshot: SessionRowSnapshot, expectedRevision?: number | null): Promise<void> {
    const { rows, record, revision } = snapshot
    const statements = this.buildWriteStatements(rows, { record, revision })
    await this.run('write-rows', rows.sessionId, () =>
      this.database.executeBatch(statements, {
        sessionId: rows.sessionId,
        mode: 'replace',
        expectedRevision,
        resultRevision: revision,
      })
    )
  }

  async applyDiff(diff: SessionRowsDiff, commit: SessionRowCommit, expectedRevision?: number): Promise<void> {
    const statements = this.buildDiffStatements(diff, commit)
    await this.run('apply-diff', diff.sessionId, () =>
      this.database.executeBatch(statements, {
        sessionId: diff.sessionId,
        mode: 'diff',
        expectedRevision,
        resultRevision: commit.revision,
      })
    )
  }

  async deleteRows(sessionId: string, expectedRevision?: number | null): Promise<void> {
    await this.run('delete-rows', sessionId, () =>
      this.database.executeBatch(
        [
          {
            kind: 'guard-revision-exhaustion',
            sql: GUARD_REVISION_EXHAUSTION_SQL,
            params: [sessionId, Number.MAX_SAFE_INTEGER],
          },
          {
            kind: 'advance-session-revision',
            sql: ADVANCE_SESSION_REVISION_SQL,
            params: ['deleted', sessionId],
          },
          { kind: 'delete-session-threads', sql: DELETE_SESSION_THREADS_SQL, params: [sessionId] },
          { kind: 'delete-session-messages', sql: DELETE_SESSION_MESSAGES_SQL, params: [sessionId] },
          { kind: 'delete-orphan-message-payloads', sql: DELETE_ORPHAN_MESSAGE_PAYLOADS_SQL, params: [sessionId] },
        ],
        { sessionId, mode: 'delete', expectedRevision }
      )
    )
  }

  async hasRows(sessionId: string): Promise<boolean> {
    return await this.run('has-rows', sessionId, async () => {
      const records = await this.database.query<SessionIdRecord>(SELECT_SESSION_PRESENCE_SQL, [sessionId, sessionId])
      return records.length > 0
    })
  }

  async getRevision(sessionId: string): Promise<number | null> {
    return await this.run('get-revision', sessionId, async () => {
      return await this.readRevision(sessionId)
    })
  }

  async listSessionIds(): Promise<string[]> {
    return await this.run('list-session-ids', undefined, async () => {
      const records = await this.database.query<SessionIdRecord>(SELECT_SESSION_IDS_SQL)
      return records.map((record) => record.session_id)
    })
  }

  async upsertMessage(row: MessageRow): Promise<void> {
    let statements: SessionRowSqlStatement[]
    try {
      validateMessageRow(row, row.sessionId)
      statements = [
        ...messageStatements(row),
        {
          kind: 'delete-orphan-message-payloads',
          sql: DELETE_ORPHAN_MESSAGE_PAYLOADS_SQL,
          params: [row.sessionId],
        },
      ]
    } catch (error) {
      throw new SessionRowStoreError('upsert-message', error, row.sessionId)
    }
    await this.run('upsert-message', row.sessionId, () =>
      this.database.executeBatch(statements, { sessionId: row.sessionId, mode: 'diff' })
    )
  }

  async findMessagesByStatus(status: MessageRowStatus): Promise<GeneratingMessageRef[]> {
    return await this.run('find-messages-by-status', undefined, async () => {
      const records = await this.database.query<MessageRefRecord>(SELECT_MESSAGE_REFS_BY_STATUS_SQL, [status])
      return records.map((record) => ({
        sessionId: record.session_id,
        threadId: record.thread_id,
        messageId: record.message_id,
      }))
    })
  }

  private buildWriteStatements(rows: SessionRows, commit: SessionRowCommit): SessionRowSqlStatement[] {
    try {
      requireSessionId(rows.sessionId, 'rows')
      validateCommit(rows.sessionId, rows.threads, commit)
      const statements: SessionRowSqlStatement[] = [
        { kind: 'delete-session-threads', sql: DELETE_SESSION_THREADS_SQL, params: [rows.sessionId] },
        { kind: 'delete-session-messages', sql: DELETE_SESSION_MESSAGES_SQL, params: [rows.sessionId] },
      ]
      for (const thread of rows.threads) {
        validateThreadRow(thread, rows.sessionId)
        statements.push(threadStatement(thread, commit))
      }
      for (const message of rows.messages) {
        validateMessageRow(message, rows.sessionId)
        statements.push(...messageStatements(message))
      }
      statements.push({
        kind: 'delete-orphan-message-payloads',
        sql: DELETE_ORPHAN_MESSAGE_PAYLOADS_SQL,
        params: [rows.sessionId],
      })
      return statements
    } catch (error) {
      throw new SessionRowStoreError('write-rows', error, rows.sessionId)
    }
  }

  private buildDiffStatements(diff: SessionRowsDiff, commit: SessionRowCommit): SessionRowSqlStatement[] {
    try {
      requireSessionId(diff.sessionId, 'diff')
      if (!Number.isSafeInteger(commit.revision) || commit.revision <= 0 || commit.record.id !== diff.sessionId) {
        throw new Error(`session ${diff.sessionId} has invalid commit metadata`)
      }
      const statements: SessionRowSqlStatement[] = []
      for (const thread of diff.threads.upsert) {
        validateThreadRow(thread, diff.sessionId)
        statements.push(threadStatement(thread, commit))
      }
      for (const message of diff.messages.upsert) {
        validateMessageRow(message, diff.sessionId)
        statements.push(...messageStatements(message))
      }
      for (const threadId of diff.threads.delete) {
        statements.push({ kind: 'delete-thread', sql: DELETE_THREAD_SQL, params: [diff.sessionId, threadId] })
      }
      for (const messageId of diff.messages.delete) {
        statements.push({ kind: 'delete-message', sql: DELETE_MESSAGE_SQL, params: [diff.sessionId, messageId] })
      }
      statements.push(updateCommitStatement(diff.sessionId, commit))
      statements.push({
        kind: 'delete-orphan-message-payloads',
        sql: DELETE_ORPHAN_MESSAGE_PAYLOADS_SQL,
        params: [diff.sessionId],
      })
      return statements
    } catch (error) {
      throw new SessionRowStoreError('apply-diff', error, diff.sessionId)
    }
  }

  private async run<T>(
    operation: SessionRowStoreOperation,
    sessionId: string | undefined,
    task: () => Promise<T>
  ): Promise<T> {
    await this.initialize()
    try {
      return await task()
    } catch (error) {
      if (error instanceof SessionRowConflictError) throw error
      throw new SessionRowStoreError(operation, error, sessionId)
    }
  }

  private async readRevision(sessionId: string): Promise<number | null> {
    const records = await this.database.query<RevisionRecord>(SELECT_SESSION_REVISION_SQL, [sessionId])
    return records[0]?.commit_revision === null || records[0]?.commit_revision === undefined
      ? null
      : Number(records[0].commit_revision)
  }

  private async readPages<Record>(sql: string, sessionId: string, pageSize: number): Promise<Record[]> {
    const records: Record[] = []
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.database.query<Record>(sql, [sessionId, pageSize, offset])
      records.push(...page)
      if (page.length < pageSize) return records
    }
  }

  private async readMessageRecords(sessionId: string): Promise<MessageRecord[]> {
    const records: MessageRecord[] = []
    for (let offset = 0; ; ) {
      const plans = await this.database.query<MessagePagePlanRecord>(SELECT_MESSAGE_PAGE_PLAN_SQL, [
        sessionId,
        offset,
        MESSAGE_PAGE_RESPONSE_BUDGET,
      ])
      const pageSize = Number(plans[0]?.page_count)
      const remainingCount = Number(plans[0]?.remaining_count)
      if (!Number.isSafeInteger(remainingCount) || remainingCount < 0) {
        throw new Error(`session ${sessionId} has an invalid message page plan`)
      }
      if (remainingCount === 0) return records
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > remainingCount) {
        throw new Error(`session ${sessionId} has an invalid message page size`)
      }

      const page = await this.database.query<MessageRecord>(SELECT_MESSAGES_PAGE_SQL, [sessionId, pageSize, offset])
      records.push(...page)
      if (page.length < pageSize || page.length >= remainingCount) return records
      offset += page.length
    }
  }

  private async readThreadText(
    record: ThreadMetadataRecord,
    column: 'name' | 'compaction_points_json' | 'session_prompt_context_snapshot_json' | 'session_record_json',
    length: number | null
  ): Promise<string | null> {
    if (length === null) return null
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`thread ${record.thread_id} has an invalid ${column} length`)
    }
    let value = ''
    for (let offset = 1; offset <= length; offset += THREAD_TEXT_SLICE_CHARACTERS) {
      const rows = await this.database.query<TextSliceRecord>(
        `SELECT substr(${column}, ?, ?) AS value FROM session_threads WHERE session_id = ? AND thread_id = ? LIMIT 1`,
        [offset, THREAD_TEXT_SLICE_CHARACTERS, record.session_id, record.thread_id]
      )
      if (rows.length !== 1 || typeof rows[0].value !== 'string') {
        throw new Error(`thread ${record.thread_id} ${column} slice is missing`)
      }
      value += rows[0].value
    }
    if ([...value].length !== length) {
      throw new Error(`thread ${record.thread_id} ${column} length changed while it was read`)
    }
    return value
  }

  private async readThreadRecords(records: ThreadMetadataRecord[]): Promise<ThreadRecord[]> {
    const hydrated: ThreadRecord[] = []
    for (const record of records) {
      const [name, compactionPoints, promptSnapshot, sessionRecord] = await Promise.all([
        this.readThreadText(record, 'name', record.name_length === null ? null : Number(record.name_length)),
        this.readThreadText(record, 'compaction_points_json', Number(record.compaction_points_json_length)),
        this.readThreadText(
          record,
          'session_prompt_context_snapshot_json',
          record.session_prompt_context_snapshot_json_length === null
            ? null
            : Number(record.session_prompt_context_snapshot_json_length)
        ),
        this.readThreadText(
          record,
          'session_record_json',
          record.session_record_json_length === null ? null : Number(record.session_record_json_length)
        ),
      ])
      if (compactionPoints === null) {
        throw new Error(`thread ${record.thread_id} compaction points are missing`)
      }
      hydrated.push({
        session_id: record.session_id,
        thread_id: record.thread_id,
        seq: record.seq,
        name,
        created_at: record.created_at,
        root_message_id: record.root_message_id,
        active_leaf_message_id: record.active_leaf_message_id,
        compaction_points_json: compactionPoints,
        session_prompt_context_snapshot_json: promptSnapshot,
        session_record_json: sessionRecord,
        commit_revision: record.commit_revision,
      })
    }
    return hydrated
  }

  private validatePayloadManifest(record: MessageRecord): { chunkCount: number; expectedLength: number } {
    const chunkCount = Number(record.payload_chunk_count)
    const expectedLength = Number(record.payload_utf8_length)
    if (
      !record.payload_id ||
      !Number.isSafeInteger(chunkCount) ||
      chunkCount < 1 ||
      !Number.isSafeInteger(expectedLength) ||
      expectedLength < 0
    ) {
      throw new Error(`message ${record.message_id} has an invalid payload manifest`)
    }
    return { chunkCount, expectedLength }
  }

  private parseMessagePayload(record: MessageRecord, chunks: PayloadChunkRecord[]): Message {
    const { chunkCount, expectedLength } = this.validatePayloadManifest(record)
    if (chunks.length !== chunkCount) {
      throw new Error(`message ${record.message_id} payload has ${chunks.length} chunks, expected ${chunkCount}`)
    }
    chunks.sort((left, right) => Number(left.chunk_index) - Number(right.chunk_index))
    for (let index = 0; index < chunks.length; index += 1) {
      if (Number(chunks[index].chunk_index) !== index) {
        throw new Error(`message ${record.message_id} payload chunk ${index} is missing`)
      }
    }
    const serialized = chunks.map((chunk) => chunk.value).join('')
    if (textEncoder.encode(serialized).byteLength !== expectedLength) {
      throw new Error(`message ${record.message_id} payload length does not match its manifest`)
    }
    return JSON.parse(serialized) as Message
  }

  private async readMessageRows(records: MessageRecord[]): Promise<MessageRow[]> {
    const payloads = new Map<string, PayloadChunkRecord[]>()
    let batch: MessageRecord[] = []
    let batchBytes = 0

    const flush = async () => {
      if (batch.length === 0) return
      const placeholders = batch.map(() => '?').join(', ')
      const chunks = await this.database.query<PayloadChunkRecord>(
        `SELECT payload_id, chunk_index, value FROM session_message_payload_chunks WHERE payload_id IN (${placeholders}) ORDER BY payload_id, chunk_index`,
        batch.map((record) => record.payload_id)
      )
      for (const chunk of chunks) {
        const list = payloads.get(chunk.payload_id)
        if (list) list.push(chunk)
        else payloads.set(chunk.payload_id, [chunk])
      }
      batch = []
      batchBytes = 0
    }

    for (const record of records) {
      const { chunkCount, expectedLength } = this.validatePayloadManifest(record)
      if (expectedLength > PAYLOAD_READ_BATCH_BYTES) {
        await flush()
        const chunks: PayloadChunkRecord[] = []
        for (let index = 0; index < chunkCount; index += 1) {
          const rows = await this.database.query<PayloadChunkRecord>(SELECT_MESSAGE_PAYLOAD_CHUNK_SQL, [
            record.payload_id,
            index,
          ])
          if (rows.length !== 1) {
            throw new Error(`message ${record.message_id} payload chunk ${index} is missing`)
          }
          chunks.push(rows[0])
        }
        payloads.set(record.payload_id, chunks)
        continue
      }
      if (
        batch.length >= PAYLOAD_READ_BATCH_MESSAGES ||
        (batch.length > 0 && batchBytes + expectedLength > PAYLOAD_READ_BATCH_BYTES)
      ) {
        await flush()
      }
      batch.push(record)
      batchBytes += expectedLength
    }
    await flush()

    return records.map((record) =>
      toMessageRow(record, this.parseMessagePayload(record, payloads.get(record.payload_id) ?? []))
    )
  }
}
