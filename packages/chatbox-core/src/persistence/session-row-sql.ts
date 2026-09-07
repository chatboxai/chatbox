import type { SessionContextMessage, SessionContextRequest, SessionContextRows } from '../ports/session-context-source'
import {
  type GeneratingMessageRef,
  type SessionMessagesRequest,
  type SessionMessagesSnapshot,
  type SessionMessageWindow,
  type SessionMessageWindowRequest,
  type SessionRowCommit,
  SessionRowConflictError,
  type SessionRowSnapshot,
  SessionRowStoreError,
  type SessionRowStoreOperation,
  type SessionRowStorePort,
  type SessionRows,
  type SessionRowsDiff,
} from '../ports/session-row-store'
import type { SessionTextTokenRead, SessionTextTokenResult, SessionTextTokenSource } from '../ports/session-text-tokens'
import type {
  MessageRow,
  MessageRowKind,
  MessageRowStatus,
  SessionRecordV2,
  ThreadRow,
} from '../session/session-tree/types'
import type { CompactionPoint, Message, SessionThread } from '../types/session'
import { CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL } from './capacitor-compatible-schema'
import {
  finishSessionContextRead,
  planSessionContextRead,
  SessionContextPathTraversal,
  type SessionContextReadPlan,
  validateSessionContextRequest,
} from './session-context-read'
import { assertSessionReadRevision, validateSessionMessagesRequest } from './session-message-selection'
import {
  assertMessageWindowRevision,
  SessionMessageWindowTraversal,
  validateMessageWindowRequest,
} from './session-message-window'
import {
  createTextTokenSource,
  SESSION_TEXT_TOKEN_SCHEMA_SQL,
  SessionTextTokenSqlCache,
  textTokenCleanupStatement,
} from './session-text-token-sql'

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
    | 'delete-stale-text-tokens'
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
  /** Consumes statements once and publishes atomically; iteration or execution failure leaves current rows unchanged. */
  executeBatch(statements: Iterable<SessionRowSqlStatement>, options?: SessionRowSqlBatchOptions): Promise<void>
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
  name_inline: string | null
  compaction_points_json_inline: string | null
  session_prompt_context_snapshot_json_inline: string | null
  session_record_json_inline: string | null
}

interface MessagePayloadRecord {
  message_id: string
  payload_id: string
  payload_chunk_count: number
  payload_utf8_length: number
}

interface ContextMessageRecord extends MessagePayloadRecord {
  parent_message_id: string | null
  seq: number
}

interface MessageRecord extends ContextMessageRecord {
  session_id: string
  thread_id: string
  active_child_id: string | null
  kind: string
  status: string
  created_at: number
  updated_at: number
  branch_id: string | null
}

interface PayloadChunkRecord {
  payload_id: string
  chunk_index: number
  value: string
}

interface PayloadChunkSliceRecord {
  value: string
  value_length: number
}

interface TextSliceRecord {
  value: string | null
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
const CONTEXT_MESSAGE_COLUMNS =
  'message_id, parent_message_id, seq, payload_id, payload_chunk_count, payload_utf8_length'
const CONTEXT_MESSAGE_WIRE_ALIASES = ['i', 'p', 's', 'v', 'c', 'l'] as const

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
// Four inline fields across eight threads leave room for escaped structural IDs
// within the metadata response budget. Larger text stays on the sliced path.
const THREAD_INLINE_TEXT_BYTES = 512
const THREAD_METADATA_COLUMNS =
  'session_id, thread_id, seq, length(name) AS name_length, created_at, root_message_id, active_leaf_message_id, length(compaction_points_json) AS compaction_points_json_length, length(session_prompt_context_snapshot_json) AS session_prompt_context_snapshot_json_length, length(session_record_json) AS session_record_json_length, commit_revision, ' +
  ['name', 'compaction_points_json', 'session_prompt_context_snapshot_json', 'session_record_json']
    .map(
      (column) =>
        `CASE WHEN length(CAST(${column} AS BLOB)) <= ${THREAD_INLINE_TEXT_BYTES} AND instr(${column}, char(0)) = 0 THEN ${column} ELSE NULL END AS ${column}_inline`
    )
    .join(', ')
const SELECT_THREADS_PAGE_SQL = `SELECT ${THREAD_METADATA_COLUMNS} FROM session_threads WHERE session_id = ? ORDER BY seq, thread_id LIMIT ? OFFSET ?`
const SELECT_WINDOW_THREADS_SQL = `SELECT ${THREAD_METADATA_COLUMNS} FROM session_threads WHERE session_id = ? AND (seq = -1 OR thread_id = ?)`
function sqlJsonStringBytes(column: string): string {
  // GLOB stops at NUL; checking it separately keeps suffixes in the escaped path.
  return `(CASE WHEN instr(${column}, char(0)) = 0 AND ${column} NOT GLOB '*[^A-Za-z0-9._:-]*'
    THEN COALESCE(length(CAST(${column} AS BLOB)), 0)
    ELSE 6 * COALESCE(length(CAST(${column} AS BLOB)), 0) END)`
}
function messageRecordEstimatedJsonBytes(prefix = ''): string {
  return `512 + ${[
    'session_id',
    'message_id',
    'thread_id',
    'parent_message_id',
    'active_child_id',
    'kind',
    'status',
    'branch_id',
    'payload_id',
  ]
    .map((column) => sqlJsonStringBytes(prefix + column))
    .join(' + ')}`
}
const MESSAGE_RECORD_ESTIMATED_JSON_BYTES = messageRecordEstimatedJsonBytes()
// Carry the cumulative budget through recursion so a wide row stops lookahead
// before traversing the remainder of the requested window.
function selectWindowMessagePathSql(forward: boolean): string {
  return `WITH RECURSIVE path AS (
  SELECT m.*, 0 AS depth, ${messageRecordEstimatedJsonBytes('m.')} AS response_bytes
  FROM session_messages m
  WHERE m.session_id = ? AND m.thread_id = ? AND m.message_id = ?
  UNION ALL
  SELECT m.*, path.depth + 1, path.response_bytes + ${messageRecordEstimatedJsonBytes('m.')}
  FROM path JOIN session_messages m
    ON m.session_id = path.session_id AND m.thread_id = path.thread_id AND m.message_id = path.${forward ? 'active_child_id' : 'parent_message_id'}
  WHERE path.depth + 1 < ? AND m.seq ${forward ? '>' : '<'} path.seq AND path.response_bytes < ?
)
SELECT ${MESSAGE_COLUMNS} FROM path WHERE response_bytes <= ? OR depth = 0 ORDER BY depth`
}
const SELECT_WINDOW_MESSAGE_ANCESTORS_SQL = selectWindowMessagePathSql(false)
const SELECT_WINDOW_MESSAGE_DESCENDANTS_SQL = selectWindowMessagePathSql(true)
function selectMessagePageSql(hasCursor: boolean): string {
  return `WITH page AS (
    SELECT ${MESSAGE_COLUMNS}
    FROM session_messages
    WHERE session_id = ?${hasCursor ? ' AND (thread_id, seq, message_id) > (?, ?, ?)' : ''}
    ORDER BY thread_id, seq, message_id
    LIMIT ?
  ), sized AS (
    SELECT ${MESSAGE_COLUMNS},
      ROW_NUMBER() OVER (ORDER BY thread_id, seq, message_id) AS row_number,
      SUM(${MESSAGE_RECORD_ESTIMATED_JSON_BYTES}) OVER (ORDER BY thread_id, seq, message_id) AS response_bytes
    FROM page
  )
  SELECT ${MESSAGE_COLUMNS} FROM sized
  WHERE response_bytes <= ? OR row_number = 1
  ORDER BY thread_id, seq, message_id`
}
const SELECT_SESSION_PRESENCE_SQL =
  'SELECT session_id FROM session_threads WHERE session_id = ? UNION SELECT session_id FROM session_messages WHERE session_id = ? LIMIT 1'
const SELECT_SESSION_IDS_SQL =
  'SELECT session_id FROM session_threads UNION SELECT session_id FROM session_messages ORDER BY session_id'
const SELECT_MESSAGE_REFS_BY_STATUS_SQL =
  'SELECT session_id, thread_id, message_id FROM session_messages WHERE status = ? ORDER BY session_id, thread_id, message_id'
const SELECT_SESSION_REVISION_SQL =
  'SELECT revision AS commit_revision FROM session_row_heads WHERE session_id = ? LIMIT 1'
const SELECT_MESSAGE_PAYLOAD_CHUNK_SLICE_SQL = `WITH chunk AS (
  SELECT value FROM session_message_payload_chunks WHERE payload_id = ? AND chunk_index = ? LIMIT 1
)
SELECT length(value) AS value_length, substr(value, ?, ?) AS value FROM chunk`
const DELETE_ORPHAN_MESSAGE_PAYLOADS_SQL =
  'DELETE FROM session_message_payload_chunks WHERE session_id = ? AND NOT EXISTS (SELECT 1 FROM session_messages WHERE session_messages.payload_id = session_message_payload_chunks.payload_id)'

const PAYLOAD_CHUNK_BYTES = 128 * 1024
const PAYLOAD_READ_RESPONSE_BUDGET = 384 * 1024
const PAYLOAD_READ_REQUEST_BUDGET = 384 * 1024
const PAYLOAD_READ_BATCH_MESSAGES = 768
// Covers compact keys, safe integer fields, response envelope and iOS column names.
const PAYLOAD_CHUNK_RESPONSE_OVERHEAD = 96
// One SQLite character can become a 12-byte escaped surrogate pair. Reserve
// the response envelope within the payload's soft bridge budget.
const PAYLOAD_CHUNK_SLICE_CHARACTERS = Math.floor((PAYLOAD_READ_RESPONSE_BUDGET - 1024) / 12)
const THREAD_PAGE_SIZE = 8
// Keep a metadata response safely below Capacitor's 512 KiB bridge limit. The
// Safe identifier characters need no JSON escaping. Other text keeps a six-times
// allowance, plus fixed object/numeric overhead, before choosing a fitting page.
const MESSAGE_PAGE_RESPONSE_BUDGET = 384 * 1024
// Every metadata row contributes at least 512 estimated bytes. Rows beyond
// this bounded lookahead cannot fit in the current response budget.
const MESSAGE_PAGE_MAX_ROWS = Math.floor(MESSAGE_PAGE_RESPONSE_BUDGET / 512)
const MESSAGE_ID_REQUEST_BUDGET = 384 * 1024
const THREAD_TEXT_SLICE_CHARACTERS = 32 * 1024
const STRUCTURAL_ID_BYTES = 1024
// At most eight metadata rows, even with 1 KiB ids and six-times JSON escaping,
// fit within MESSAGE_PAGE_RESPONSE_BUDGET. Payloads use their own chunk budget.
const MESSAGE_ANCESTOR_BATCH_SIZE = 8
// Short keys, safe integers, the response envelope and iOS column-name prelude.
const CONTEXT_MESSAGE_FIXED_JSON_BYTES = 160
const CONTEXT_MESSAGE_MAX_ROWS = Math.floor(MESSAGE_PAGE_RESPONSE_BUDGET / CONTEXT_MESSAGE_FIXED_JSON_BYTES)
const CONTEXT_MESSAGE_INITIAL_ROWS = Math.min(1536, CONTEXT_MESSAGE_MAX_ROWS)
const CONTEXT_MESSAGE_VALID_TYPES = [
  "typeof(message_id) = 'text'",
  "typeof(parent_message_id) IN ('text', 'null')",
  "typeof(payload_id) = 'text'",
  ...(
    [
      ['seq', 0],
      ['payload_chunk_count', 1],
      ['payload_utf8_length', 0],
    ] as const
  ).map(
    ([column, minimum]) =>
      `(typeof(${column}) IN ('integer', 'real') AND ${column} BETWEEN ${minimum} AND ${Number.MAX_SAFE_INTEGER}
        AND ${column} = CAST(${column} AS INTEGER))`
  ),
].join(' AND ')
const CONTEXT_MESSAGE_ESTIMATED_JSON_BYTES = `CASE WHEN ${CONTEXT_MESSAGE_VALID_TYPES}
  THEN ${CONTEXT_MESSAGE_FIXED_JSON_BYTES} + ${['message_id', 'parent_message_id', 'payload_id']
    .map(sqlJsonStringBytes)
    .join(' + ')} ELSE ${MESSAGE_PAGE_RESPONSE_BUDGET + 1} END`
const CONTEXT_PATH_COLUMNS = ['session_id', 'thread_id', ...CONTEXT_MESSAGE_COLUMNS.split(', ')]
  .map((column) => `m.${column}`)
  .join(', ')
const SELECT_CONTEXT_ANCESTORS_SQL = `WITH RECURSIVE path AS (
  SELECT ${CONTEXT_PATH_COLUMNS}, 0 AS depth FROM session_messages m
  WHERE m.session_id = ? AND m.thread_id = ? AND m.message_id = ?
  UNION ALL
  SELECT ${CONTEXT_PATH_COLUMNS}, path.depth + 1 FROM path JOIN session_messages m
    ON m.session_id = path.session_id AND m.thread_id = path.thread_id AND m.message_id = path.parent_message_id
  WHERE path.depth + 1 < ? AND m.seq < path.seq
), sized AS (
  SELECT ${CONTEXT_MESSAGE_COLUMNS}, depth,
    SUM(${CONTEXT_MESSAGE_ESTIMATED_JSON_BYTES}) OVER (ORDER BY depth) AS response_bytes
  FROM path
)
SELECT ${CONTEXT_MESSAGE_COLUMNS.split(', ')
  .map(
    (column, index) =>
      `CASE WHEN response_bytes <= ${MESSAGE_PAGE_RESPONSE_BUDGET} THEN ${column} END AS ${CONTEXT_MESSAGE_WIRE_ALIASES[index]}`
  )
  .join(', ')},
  (response_bytes > ${MESSAGE_PAGE_RESPONSE_BUDGET}) AS x
FROM sized WHERE response_bytes <= ${MESSAGE_PAGE_RESPONSE_BUDGET} OR depth = 0
ORDER BY depth`
const textEncoder = new TextEncoder()
let payloadSequence = 0

function selectMessageIdsSql(count: number): string {
  const requested = Array.from({ length: count }, (_, index) => `(?, ${index})`).join(', ')
  // An integer input cursor preserves caller order even when IDs are missing or
  // SQLite and JavaScript order Unicode strings differently.
  return `WITH requested(requested_id, request_index) AS (VALUES ${requested}), sized AS (
    SELECT ${MESSAGE_COLUMNS}, request_index,
      MIN(request_index) OVER () AS first_request_index,
      MAX(request_index) OVER () AS last_request_index,
      SUM(${MESSAGE_RECORD_ESTIMATED_JSON_BYTES})
        OVER (ORDER BY request_index) AS response_bytes
    FROM requested JOIN session_messages m ON m.message_id = requested.requested_id
    WHERE m.session_id = ? AND request_index >= ?
  )
  SELECT ${MESSAGE_COLUMNS.split(', ')
    .map((column) => `CASE WHEN response_bytes <= ${MESSAGE_PAGE_RESPONSE_BUDGET} THEN ${column} END AS ${column}`)
    .join(', ')},
    request_index, last_request_index, (response_bytes > ${MESSAGE_PAGE_RESPONSE_BUDGET}) AS metadata_oversized
  FROM sized
  WHERE response_bytes <= ${MESSAGE_PAGE_RESPONSE_BUDGET} OR request_index = first_request_index
  ORDER BY request_index`
}

function sqlPayloadJsonStringBytes(column: string): string {
  return `(CASE WHEN instr(${column}, char(0)) = 0 AND ${column} NOT GLOB '*[^ -~]*'
    AND instr(${column}, '<') = 0 AND instr(${column}, '>') = 0 AND instr(${column}, '&') = 0
    AND instr(${column}, '/') = 0 AND instr(${column}, '=') = 0 AND instr(${column}, char(39)) = 0
    AND instr(${column}, char(96)) = 0
    THEN length(CAST(${column} AS BLOB))
      + length(${column}) - length(replace(${column}, char(34), ''))
      + length(${column}) - length(replace(${column}, char(92), ''))
    ELSE 6 * length(CAST(${column} AS BLOB)) END)`
}

function isSafeAsciiPayload(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value) && !/[<>&/='`]/.test(value)
}

function selectMessagePayloadChunksSql(count: number, ascii = false): string {
  return `WITH requested(payload_id, request_index) AS (VALUES ${Array.from({ length: count }, (_, index) => `(?, ${index})`).join(', ')}), chunks AS (
    SELECT request_index, chunk_index, value,
      SUM(CASE WHEN typeof(value) = 'text' AND typeof(chunk_index) = 'integer'
        AND chunk_index >= 0 AND chunk_index <= 9007199254740991
        THEN ${ascii ? sqlPayloadJsonStringBytes('value') : '6 * length(CAST(value AS BLOB))'} + ${PAYLOAD_CHUNK_RESPONSE_OVERHEAD}
        ELSE ${PAYLOAD_READ_RESPONSE_BUDGET + 1} END) OVER () AS response_bytes,
      ROW_NUMBER() OVER (ORDER BY request_index, chunk_index) AS row_number
    FROM session_message_payload_chunks JOIN requested USING(payload_id)
  )
  SELECT CASE WHEN response_bytes <= ${PAYLOAD_READ_RESPONSE_BUDGET} THEN request_index END AS i,
    CASE WHEN response_bytes <= ${PAYLOAD_READ_RESPONSE_BUDGET} THEN chunk_index END AS c,
    CASE WHEN response_bytes <= ${PAYLOAD_READ_RESPONSE_BUDGET} THEN value END AS v,
    (response_bytes > ${PAYLOAD_READ_RESPONSE_BUDGET}) AS x
  FROM chunks WHERE response_bytes <= ${PAYLOAD_READ_RESPONSE_BUDGET} OR row_number = 1
  ORDER BY request_index, chunk_index`
}

// Reserve the largest SQL shape and cursor plus envelope headroom. Each ID's
// JSON-encoded UTF-8 bytes are added separately, including escaping and commas.
const MESSAGE_ID_REQUEST_OVERHEAD =
  textEncoder.encode(
    JSON.stringify({ statement: selectMessageIdsSql(MESSAGE_PAGE_MAX_ROWS), values: [Number.MAX_SAFE_INTEGER] })
  ).byteLength + 1024
const PAYLOAD_ID_REQUEST_OVERHEAD =
  textEncoder.encode(
    JSON.stringify({ statement: selectMessagePayloadChunksSql(PAYLOAD_READ_BATCH_MESSAGES), values: [] })
  ).byteLength + 1024
const ASCII_PAYLOAD_ID_REQUEST_OVERHEAD =
  textEncoder.encode(
    JSON.stringify({ statement: selectMessagePayloadChunksSql(PAYLOAD_READ_BATCH_MESSAGES, true), values: [] })
  ).byteLength + 1024

function jsonStringResponseBytes(value: string): number {
  return /[^A-Za-z0-9._:-]/.test(value) ? 6 * textEncoder.encode(value).byteLength : value.length
}

type SelectedPayloadWireRecord = { i: number; c: number; v: string; x: 0 } | { x: 1 }
type SelectedContextMessageRecord =
  | {
      i: string
      p: string | null
      s: number
      v: string
      c: number
      l: number
      x: 0
    }
  | { x: 1 }

type SelectedMessageRecord = { request_index: number; last_request_index: number } & (
  | (MessageRecord & { metadata_oversized: 0 })
  | { metadata_oversized: 1 }
)

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

function* splitPayload(value: string): Generator<string> {
  if (value.length <= PAYLOAD_CHUNK_BYTES && textEncoder.encode(value).byteLength <= PAYLOAD_CHUNK_BYTES) {
    yield value
    return
  }
  let current = ''
  let size = 0
  for (const codePoint of value) {
    const code = codePoint.codePointAt(0)!
    const pointSize = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (current && size + pointSize > PAYLOAD_CHUNK_BYTES) {
      yield current
      current = ''
      size = 0
    }
    current += codePoint
    size += pointSize
  }
  if (current || value.length === 0) yield current
}

function* messageStatements(message: MessageRow): Generator<SessionRowSqlStatement> {
  const serialized = serializeJson(message.message, `message ${message.messageId}`)
  const payloadId = createPayloadId(message)
  let chunkCount = 0
  let utf8Length = 0
  for (const chunk of splitPayload(serialized)) {
    utf8Length += textEncoder.encode(chunk).byteLength
    yield {
      kind: 'insert-message-payload-chunk',
      sql: INSERT_MESSAGE_PAYLOAD_CHUNK_SQL,
      params: [message.sessionId, payloadId, chunkCount++, chunk],
    }
  }
  yield {
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
      chunkCount,
      utf8Length,
    ],
  }
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
 * `SessionRowSqlDatabase`. Replacement payloads are serialized on demand while
 * the driver consumes the statement stream. Drivers publish each mutation
 * atomically, including when serialization fails partway through a stream.
 * Bridge-backed drivers prepare invisible staging rows in bounded transactions.
 */
export class SqlSessionRowStore implements SessionRowStorePort {
  private initializePromise: Promise<void> | null = null

  constructor(private readonly database: SessionRowSqlDatabase) {}

  initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.database
        .execute(CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL + SESSION_TEXT_TOKEN_SCHEMA_SQL)
        .catch((error: unknown) => {
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
        const sources: Record<string, SessionTextTokenSource> = Object.create(null)
        let textTokens: SessionTextTokenRead
        try {
          const threadMetadata = await this.readPages<ThreadMetadataRecord>(
            SELECT_THREADS_PAGE_SQL,
            sessionId,
            THREAD_PAGE_SIZE
          )
          threadRecords = await this.readThreadRecords(threadMetadata)
          messageRecords = await this.readMessageRecords(sessionId)
          messages = await this.readMessageRows(messageRecords, sources)
          textTokens = await this.readTokenSnapshot(sources)
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
        return { rows: { sessionId, threads: threadRecords.map(toThreadRow), messages }, ...commit, textTokens }
      }
      throw new Error(`session ${sessionId} changed repeatedly while it was being read`)
    })
  }

  async readMessageWindow(request: SessionMessageWindowRequest): Promise<SessionMessageWindow | null> {
    const { sessionId } = request
    return this.run('read-message-window', sessionId, async () => {
      validateMessageWindowRequest(request)
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const before = await this.readRevision(sessionId)
        assertMessageWindowRevision(request, before)
        let window: SessionMessageWindow | null
        try {
          const metadata = await this.database.query<ThreadMetadataRecord>(SELECT_WINDOW_THREADS_SQL, [
            sessionId,
            request.threadId ?? request.cursor?.threadId ?? null,
          ])
          if (metadata.length === 0) {
            window = null
          } else {
            const records = await this.readThreadRecords(metadata)
            const commit = readCommitMetadata(sessionId, records, before)
            const threadId = request.threadId ?? request.cursor?.threadId ?? commit.record.activeThreadId
            const thread = records.find((row) => row.thread_id === threadId)
            if (!thread) throw new Error('Message window thread is missing')
            const traversal = new SessionMessageWindowTraversal(request, commit, toThreadRow(thread))
            const selected: MessageRecord[] = []
            while (traversal.nextMessageId !== null && traversal.remaining > 0) {
              const ancestors = await this.database.query<MessageRecord>(
                traversal.forward ? SELECT_WINDOW_MESSAGE_DESCENDANTS_SQL : SELECT_WINDOW_MESSAGE_ANCESTORS_SQL,
                [
                  sessionId,
                  threadId,
                  traversal.nextMessageId,
                  Math.min(traversal.remaining, MESSAGE_PAGE_MAX_ROWS),
                  MESSAGE_PAGE_RESPONSE_BUDGET,
                  MESSAGE_PAGE_RESPONSE_BUDGET,
                ]
              )
              if (ancestors.length === 0) traversal.accept(undefined)
              for (const row of ancestors) {
                if (
                  traversal.accept({
                    sessionId: row.session_id,
                    threadId: row.thread_id,
                    messageId: row.message_id,
                    parentMessageId: row.parent_message_id,
                    activeChildId: row.active_child_id,
                    seq: Number(row.seq),
                  })
                )
                  selected.push(row)
              }
            }
            const sources: Record<string, SessionTextTokenSource> = Object.create(null)
            window = {
              ...traversal.finish(await this.readMessageRows(selected, sources)),
              textTokens: await this.readTokenSnapshot(sources),
            }
          }
        } catch (error) {
          const afterFailure = await this.readRevision(sessionId)
          assertMessageWindowRevision(request, afterFailure)
          if (before !== afterFailure) continue
          throw error
        }
        const after = await this.readRevision(sessionId)
        assertMessageWindowRevision(request, after)
        if (before !== after) continue
        return window
      }
      throw new Error(`session ${sessionId} changed repeatedly while its message window was being read`)
    })
  }

  async readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSnapshot | null> {
    return this.run('read-messages', request.sessionId, async () => {
      validateSessionMessagesRequest(request)
      return this.readSelectedSnapshot(request, async (commit) => {
        const sources: Record<string, SessionTextTokenSource> = Object.create(null)
        const messages = await this.readMessageRows(
          await this.readMessageRecordsByIds(request.sessionId, request.messageIds),
          sources
        )
        return { ...commit, messages, textTokens: await this.readTokenSnapshot(sources) }
      })
    })
  }

  async readContext(request: SessionContextRequest): Promise<SessionContextRows | null> {
    return this.run('read-context', request.sessionId, async () => {
      validateSessionContextRequest(request)
      return this.readSelectedSnapshot(request, async (commit, threads) => {
        const sources: Record<string, SessionTextTokenSource> = Object.create(null)
        const selectedThread = threads.find(
          (thread) => thread.threadId === (request.threadId ?? commit.record.activeThreadId)
        )
        const targetId = request.targetMessageId ?? selectedThread?.activeLeafMessageId
        const targetRecords = targetId ? await this.readMessageRecordsByIds(request.sessionId, [targetId]) : []
        const target = (await this.readMessageRows(targetRecords, sources))[0]
        let plan = planSessionContextRead(request, commit, threads, target)
        const readPlan = async (current: SessionContextReadPlan) => {
          const traversal = new SessionContextPathTraversal(request.sessionId, current)
          const selected: ContextMessageRecord[] = []
          let contextPageSize = CONTEXT_MESSAGE_INITIAL_ROWS
          while (traversal.nextMessageId !== null) {
            const ancestors = await this.database.query<SelectedContextMessageRecord>(SELECT_CONTEXT_ANCESTORS_SQL, [
              request.sessionId,
              current.thread.threadId,
              traversal.nextMessageId,
              current.checkpoint ? MESSAGE_ANCESTOR_BATCH_SIZE : contextPageSize,
            ])
            if (ancestors.length === 0) traversal.accept(undefined)
            for (const wireRow of ancestors) {
              if (traversal.nextMessageId === null) break
              if (wireRow.x === 1) throw new Error('Context metadata exceeds the native response budget')
              const row: ContextMessageRecord = {
                message_id: wireRow.i,
                parent_message_id: wireRow.p,
                seq: wireRow.s,
                payload_id: wireRow.v,
                payload_chunk_count: wireRow.c,
                payload_utf8_length: wireRow.l,
              }
              traversal.accept({
                sessionId: request.sessionId,
                threadId: current.thread.threadId,
                messageId: row.message_id,
                parentMessageId: row.parent_message_id,
                seq: Number(row.seq),
              })
              selected.push(row)
            }
            if (!current.checkpoint && ancestors.length > 0) {
              // Bound repeated recursive work while allowing denser pages to grow.
              contextPageSize = Math.max(
                MESSAGE_ANCESTOR_BATCH_SIZE,
                Math.min(CONTEXT_MESSAGE_MAX_ROWS, Math.ceil(ancestors.length * 1.1))
              )
            }
          }
          const path = (
            await this.readMessagePayloads(
              selected,
              (row, message): SessionContextMessage => ({
                sessionId: request.sessionId,
                threadId: current.thread.threadId,
                messageId: row.message_id,
                parentMessageId: row.parent_message_id,
                seq: Number(row.seq),
                message,
              }),
              sources,
              request.sessionId
            )
          ).reverse()
          const extras = current.checkpoint
            ? [current.checkpoint.point.summaryMessageId, current.checkpoint.systemMessageId].filter(
                (id): id is string => Boolean(id) && !selected.some((row) => row.message_id === id)
              )
            : []
          const result = finishSessionContextRead(
            request,
            commit,
            current,
            path,
            await this.readMessageRows(await this.readMessageRecordsByIds(request.sessionId, extras), sources)
          )
          return result ? { ...result, textTokens: await this.readTokenSnapshot(sources) } : result
        }
        const result = await readPlan(plan)
        if (result) return result
        plan = { ...plan, checkpoint: undefined }
        const fallback = await readPlan(plan)
        if (!fallback) throw new Error('Context fallback is incomplete')
        return fallback
      })
    })
  }

  private async readSelectedSnapshot<Result>(
    request: { sessionId: string; expectedRevision?: number },
    select: (commit: SessionRowCommit, threads: ThreadRow[]) => Promise<Result>
  ): Promise<Result | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.readRevision(request.sessionId)
      assertSessionReadRevision(request, before)
      let result: Result | null
      try {
        const metadata = await this.readPages<ThreadMetadataRecord>(
          SELECT_THREADS_PAGE_SQL,
          request.sessionId,
          THREAD_PAGE_SIZE
        )
        const records = await this.readThreadRecords(metadata)
        result =
          records.length === 0
            ? null
            : await select(readCommitMetadata(request.sessionId, records, before), records.map(toThreadRow))
      } catch (error) {
        const afterFailure = await this.readRevision(request.sessionId)
        assertSessionReadRevision(request, afterFailure)
        if (before !== afterFailure) continue
        throw error
      }
      const after = await this.readRevision(request.sessionId)
      assertSessionReadRevision(request, after)
      if (before !== after) continue
      return result
    }
    throw new Error(`session ${request.sessionId} changed repeatedly during its selected read`)
  }

  private async readMessageRecordsByIds(sessionId: string, ids: string[]): Promise<MessageRecord[]> {
    const unique = [...new Set(ids)]
    const found = new Map<string, MessageRecord>()
    const baseBytes = MESSAGE_ID_REQUEST_OVERHEAD + textEncoder.encode(JSON.stringify(sessionId)).byteLength + 1
    for (let offset = 0; offset < unique.length; ) {
      const batch: string[] = []
      let requestBytes = baseBytes
      while (offset < unique.length && batch.length < MESSAGE_PAGE_MAX_ROWS) {
        const id = unique[offset]
        const idBytes = textEncoder.encode(JSON.stringify(id)).byteLength + 1
        if (requestBytes + idBytes > MESSAGE_ID_REQUEST_BUDGET) {
          if (batch.length === 0) throw new Error('Message selection ID exceeds the native request budget')
          break
        }
        batch.push(id)
        requestBytes += idBytes
        offset++
      }
      const sql = selectMessageIdsSql(batch.length)
      let cursor = 0
      while (cursor < batch.length) {
        const records = await this.database.query<SelectedMessageRecord>(sql, [...batch, sessionId, cursor])
        if (records.length === 0) break
        for (const record of records) {
          // A corrupt oversized metadata row returns only its integer cursor,
          // so reporting the failure never sends that row over the bridge.
          if (record.metadata_oversized === 1) throw new Error('Message metadata exceeds the native response budget')
          found.set(record.message_id, record)
        }
        const last = records[records.length - 1]
        cursor = Number(last.request_index) + 1
        if (cursor > Number(last.last_request_index)) break
      }
    }
    return unique.flatMap((id) => {
      const record = found.get(id)
      return record ? [record] : []
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

  async readTextTokenResults(sources: readonly SessionTextTokenSource[]): Promise<SessionTextTokenResult[]> {
    await this.initialize()
    return new SessionTextTokenSqlCache(this.database).read(sources)
  }

  async acceptTextTokenResults(results: readonly SessionTextTokenResult[]): Promise<SessionTextTokenResult[]> {
    await this.initialize()
    return new SessionTextTokenSqlCache(this.database).accept(results)
  }

  private async readTokenSnapshot(sources: Record<string, SessionTextTokenSource>): Promise<SessionTextTokenRead> {
    return { sources, results: await this.readTextTokenResults(Object.values(sources)) }
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
          textTokenCleanupStatement(sessionId),
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

  private *buildWriteStatements(rows: SessionRows, commit: SessionRowCommit): Generator<SessionRowSqlStatement> {
    try {
      requireSessionId(rows.sessionId, 'rows')
      validateCommit(rows.sessionId, rows.threads, commit)
      yield { kind: 'delete-session-threads', sql: DELETE_SESSION_THREADS_SQL, params: [rows.sessionId] }
      yield { kind: 'delete-session-messages', sql: DELETE_SESSION_MESSAGES_SQL, params: [rows.sessionId] }
      for (const thread of rows.threads) {
        validateThreadRow(thread, rows.sessionId)
        yield threadStatement(thread, commit)
      }
      for (const message of rows.messages) {
        validateMessageRow(message, rows.sessionId)
        yield* messageStatements(message)
      }
      yield {
        kind: 'delete-orphan-message-payloads',
        sql: DELETE_ORPHAN_MESSAGE_PAYLOADS_SQL,
        params: [rows.sessionId],
      }
      yield textTokenCleanupStatement(rows.sessionId)
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
      const changedIds = new Set([...diff.messages.upsert.map((message) => message.messageId), ...diff.messages.delete])
      for (const messageId of changedIds) statements.push(textTokenCleanupStatement(diff.sessionId, messageId))
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
    let cursor: MessageRecord | undefined
    for (;;) {
      const params: SessionRowSqlBindValue[] = [sessionId]
      if (cursor) params.push(cursor.thread_id, cursor.seq, cursor.message_id)
      params.push(MESSAGE_PAGE_MAX_ROWS, MESSAGE_PAGE_RESPONSE_BUDGET)
      const page = await this.database.query<MessageRecord>(selectMessagePageSql(cursor !== undefined), params)
      if (page.length === 0) return records
      records.push(...page)
      cursor = page[page.length - 1]
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
    const inline = record[`${column}_inline`]
    if (typeof inline === 'string' && [...inline].length === length) return inline
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

  private validatePayloadManifest(record: MessagePayloadRecord): { chunkCount: number; expectedLength: number } {
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

  private parseMessagePayload(record: MessagePayloadRecord, chunks: PayloadChunkRecord[]): Message {
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

  private async readPayloadChunk(record: MessagePayloadRecord, index: number): Promise<PayloadChunkRecord> {
    const slices: string[] = []
    let length: number | undefined
    for (let offset = 1; length === undefined || offset <= length; offset += PAYLOAD_CHUNK_SLICE_CHARACTERS) {
      const rows = await this.database.query<PayloadChunkSliceRecord>(SELECT_MESSAGE_PAYLOAD_CHUNK_SLICE_SQL, [
        record.payload_id,
        index,
        offset,
        PAYLOAD_CHUNK_SLICE_CHARACTERS,
      ])
      const row = rows[0]
      if (rows.length !== 1 || !row) throw new Error(`message ${record.message_id} payload chunk ${index} is missing`)
      const nextLength = Number(row.value_length)
      if (!Number.isSafeInteger(nextLength) || nextLength < 0 || (length !== undefined && nextLength !== length)) {
        throw new Error(`message ${record.message_id} payload chunk ${index} length is invalid`)
      }
      length = nextLength
      slices.push(row.value)
    }
    return { payload_id: record.payload_id, chunk_index: index, value: slices.join('') }
  }

  private async readMessageRows(
    records: MessageRecord[],
    sources: Record<string, SessionTextTokenSource>
  ): Promise<MessageRow[]> {
    return this.readMessagePayloads(records, toMessageRow, sources, records[0]?.session_id ?? '')
  }

  private async readLargePayloadChunks(record: MessagePayloadRecord): Promise<PayloadChunkRecord[]> {
    const { chunkCount, expectedLength } = this.validatePayloadManifest(record)
    const [actual] = await this.database.query<{
      chunk_count: number
      utf8_length: number
      first_index: number | null
      last_index: number | null
    }>(
      `SELECT COUNT(*) AS chunk_count, COALESCE(SUM(length(CAST(value AS BLOB))), 0) AS utf8_length,
        MIN(chunk_index) AS first_index, MAX(chunk_index) AS last_index
      FROM session_message_payload_chunks WHERE payload_id = ?`,
      [record.payload_id]
    )
    if (
      !actual ||
      Number(actual.chunk_count) !== chunkCount ||
      Number(actual.utf8_length) !== expectedLength ||
      actual.first_index !== 0 ||
      actual.last_index !== chunkCount - 1
    ) {
      throw new Error(`message ${record.message_id} actual payload chunks do not match its manifest`)
    }
    const chunks: PayloadChunkRecord[] = []
    for (let index = 0; index < chunkCount; index += 1) chunks.push(await this.readPayloadChunk(record, index))
    return chunks
  }

  private async readMessagePayloads<Record extends MessagePayloadRecord, Result>(
    records: Record[],
    project: (record: Record, message: Message) => Result,
    sources: { [messageId: string]: SessionTextTokenSource },
    sessionId: string
  ): Promise<Result[]> {
    const payloads = new Map<string, PayloadChunkRecord[]>()
    let mode: 'sampling' | 'ascii-observed' | 'conservative' = 'sampling'
    let asciiExpansion = 2
    let cursor = 0

    while (cursor < records.length) {
      const firstIdBytes = textEncoder.encode(JSON.stringify(records[cursor].payload_id)).byteLength + 1
      const ascii: boolean =
        mode === 'ascii-observed' && ASCII_PAYLOAD_ID_REQUEST_OVERHEAD + firstIdBytes <= PAYLOAD_READ_REQUEST_BUDGET
      const batch: Record[] = []
      let batchBytes = 0
      let requestBytes = ascii ? ASCII_PAYLOAD_ID_REQUEST_OVERHEAD : PAYLOAD_ID_REQUEST_OVERHEAD

      for (let index = cursor; index < records.length && batch.length < PAYLOAD_READ_BATCH_MESSAGES; index += 1) {
        const record = records[index]
        const { chunkCount, expectedLength } = this.validatePayloadManifest(record)
        const idRequestBytes = textEncoder.encode(JSON.stringify(record.payload_id)).byteLength + 1
        if (PAYLOAD_ID_REQUEST_OVERHEAD + idRequestBytes > PAYLOAD_READ_REQUEST_BUDGET) {
          throw new Error('Message payload ID exceeds the native request budget')
        }
        const overhead = chunkCount * PAYLOAD_CHUNK_RESPONSE_OVERHEAD
        if (6 * expectedLength + overhead > PAYLOAD_READ_RESPONSE_BUDGET) break
        // Observed expansion is a packing hint. SQL verifies every actual chunk
        // before returning any body, including when later text expands further.
        const responseBytes = Math.ceil((ascii ? asciiExpansion : 6) * expectedLength) + overhead
        if (
          requestBytes + idRequestBytes > PAYLOAD_READ_REQUEST_BUDGET ||
          (batch.length > 0 && batchBytes + responseBytes > PAYLOAD_READ_RESPONSE_BUDGET)
        )
          break
        batch.push(record)
        batchBytes += responseBytes
        requestBytes += idRequestBytes
      }

      if (batch.length === 0) {
        const record = records[cursor]
        payloads.set(record.payload_id, await this.readLargePayloadChunks(record))
        cursor += 1
        continue
      }
      const wireChunks = await this.database.query<SelectedPayloadWireRecord>(
        selectMessagePayloadChunksSql(batch.length, ascii),
        batch.map((record) => record.payload_id)
      )
      if (wireChunks.some((chunk) => chunk.x === 1)) {
        if (ascii) {
          // Keep the unread batch intact. This read cannot promote again.
          mode = 'conservative'
          continue
        }
        throw new Error('Message payload exceeds the native response budget')
      }
      const chunks: PayloadChunkRecord[] = wireChunks.map((chunk) => {
        if (
          chunk.x !== 0 ||
          !Number.isSafeInteger(chunk.i) ||
          chunk.i < 0 ||
          chunk.i >= batch.length ||
          !Number.isSafeInteger(chunk.c) ||
          chunk.c < 0 ||
          typeof chunk.v !== 'string'
        ) {
          throw new Error('Invalid message payload wire record')
        }
        return { payload_id: batch[chunk.i].payload_id, chunk_index: chunk.c, value: chunk.v }
      })
      for (const chunk of chunks) {
        const list = payloads.get(chunk.payload_id)
        if (list) list.push(chunk)
        else payloads.set(chunk.payload_id, [chunk])
      }
      if (mode === 'sampling') {
        for (const record of batch) this.parseMessagePayload(record, payloads.get(record.payload_id) ?? [])
        mode = chunks.every((chunk) => isSafeAsciiPayload(chunk.value)) ? 'ascii-observed' : 'conservative'
        if (mode === 'ascii-observed') {
          asciiExpansion = chunks.reduce(
            (maximum, chunk) =>
              Math.max(maximum, (JSON.stringify(chunk.value).length - 2) / Math.max(1, chunk.value.length)),
            1
          )
        }
      }
      cursor += batch.length
    }

    return records.map((record) => {
      const message = this.parseMessagePayload(record, payloads.get(record.payload_id) ?? [])
      const source = createTextTokenSource(sessionId, message, record.payload_id)
      if (source) sources[record.message_id] = source
      return project(record, message)
    })
  }
}
