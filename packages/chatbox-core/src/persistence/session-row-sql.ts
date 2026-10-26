import type { SessionBranchMessagesRequest, SessionBranchPreviewRequest } from '../ports/session-branch-source'
import type {
  SessionMessageMetadataRequest,
  SessionMessageRelationsRequest,
  SessionThreadStateRequest,
} from '../ports/session-row-relations'
import {
  type GeneratingMessageRef,
  type SessionMessagesRequest,
  type SessionMessagesSnapshot,
  type SessionRowCommit,
  SessionRowConflictError,
  type SessionRowMutationResult,
  type SessionRowSnapshot,
  SessionRowStoreError,
  type SessionRowStoreOperation,
  type SessionRowStorePort,
  type SessionRows,
  type SessionRowsDiff,
  type SessionThreadPage,
  type SessionThreadPageRequest,
} from '../ports/session-row-store'
import type { SessionRowIterationRequest, SessionStoredRow } from '../ports/session-row-transfer'
import type { SessionTextTokenRead, SessionTextTokenResult, SessionTextTokenSource } from '../ports/session-text-tokens'
import {
  type SessionTokenCacheRequest,
  type SessionTokenCacheResult,
  validateTokenCacheRequest,
} from '../ports/session-token-cache'
import type {
  SessionNavigationRepairRequest,
  SessionThreadRequest,
  SessionTranscriptRequest,
} from '../ports/session-transcript-source'
import type {
  MessageRow,
  MessageRowKind,
  MessageRowMetadata,
  MessageRowStatus,
  SessionRecordV2,
  ThreadRow,
} from '../session/session-tree/types'
import type { CompactionPoint, Message, SessionThread } from '../types/session'
import { throwIfAborted } from '../utils/abort'
import { CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL } from './capacitor-compatible-schema'
import { validateBranchPreviewRequest } from './session-branch-preview'
import { readSqlBranchPreview } from './session-branch-preview-sql'
import { readBranchMessagesPage, validateBranchMessagesRequest } from './session-branch-reader'
import { assertSessionReadRevision, validateSessionMessagesRequest } from './session-message-selection'
import { applySqlLocalMutation } from './session-row-local-sql'
import { queryRowMetadata, sqlMetadataStringBytes } from './session-row-metadata-sql'
import {
  parseRowExtra,
  rowExtra,
  selectedDepths,
  SESSION_ROW_PROJECTION_SCHEMA_SQL,
} from './session-row-projection-sql'
import { readMetadataSelection, readRelationsPage } from './session-row-relations-read'
import { sqlRelationReader } from './session-row-relations-sql'
import { createSqlRowWriter } from './session-row-transfer-sql'
import { createSqlImportWriter, resumeSqlImportWriter } from './session-row-import-sql'
import {
  createTextTokenSource,
  SESSION_TEXT_TOKEN_SCHEMA_SQL,
  SessionTextTokenSqlCache,
  textTokenCleanupStatement,
} from './session-text-token-sql'
import { assertSessionThreadPageRevision, validateSessionThreadPageRequest } from './session-thread-page'
import { acceptSqlTokenCache, readSqlTokenCache, SESSION_TOKEN_CACHE_SQL } from './session-token-cache-sql'
import { navigationProjection, validateNavigationRepair, validateTranscriptRequest } from './session-transcript-read'
import {
  INSERT_MESSAGE_NAVIGATION_SQL,
  readNavigationPage,
  readSqlTranscriptThread,
  readTranscriptPage,
  SESSION_TRANSCRIPT_SCHEMA_SQL,
  sqlTranscriptReader,
  withSqlTranscriptCommit,
} from './session-transcript-sql'

export type SessionRowSqlBindValue = string | number | null

export interface SessionRowSqlStatement {
  sql: string
  params: SessionRowSqlBindValue[]
  kind?:
    | 'delete-session-threads'
    | 'delete-session-messages'
    | 'guard-revision-exhaustion'
    | 'advance-session-revision'
    | 'upsert-thread'
    | 'upsert-message'
    | 'insert-message-navigation'
    | 'delete-orphan-message-navigation'
    | 'delete-stale-text-tokens'
}

export interface SessionRowSqlBatchOptions {
  sessionId: string
  mode: 'replace' | 'delete' | 'local-diff'
  expectedRevision?: number | null
  resultRevision?: number
}

export interface SessionRowSqlDatabase {
  /** Only JSON bridge transports need a per-statement envelope limit. */
  readonly maxStatementBytes?: number
  /** Runs DDL that may hold several statements. */
  execute(sql: string): Promise<void>
  query<T>(sql: string, params?: SessionRowSqlBindValue[]): Promise<T[]>
  /** Consumes statements once and publishes atomically; iteration or execution failure leaves current rows unchanged. */
  executeBatch(statements: Iterable<SessionRowSqlStatement>, options?: SessionRowSqlBatchOptions): Promise<void>
}

export interface SessionRowSqlReadOptions {
  /** JSON bridge budgets are optional for structured native transports. Row and bind limits still apply. */
  readByteBudget?: 'bounded' | 'none'
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
  projection_json: string | null
}

interface ThreadMetadataRecord {
  projection_json: string | null
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
  name_nul_encoded?: number
  compaction_points_json_nul_encoded?: number
  session_prompt_context_snapshot_json_nul_encoded?: number
  session_record_json_nul_encoded?: number
}

interface MessagePayloadRecord {
  message_id: string
  payload_id: string
  payload_utf8_length: number
}

interface ContextMessageRecord extends MessagePayloadRecord {
  parent_message_id: string | null
  seq: number
}

interface MessageRecord extends ContextMessageRecord {
  row_metadata_json: string | null
  selected_depth: number | null
  session_id: string
  thread_id: string
  active_child_id: string | null
  kind: string
  status: string
  created_at: number
  updated_at: number
  branch_id: string | null
}

interface PayloadSliceRecord {
  value: string
  value_length: number
  value_type: string
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
  'session_id, thread_id, seq, name, created_at, root_message_id, active_leaf_message_id, compaction_points_json, session_prompt_context_snapshot_json, session_record_json, commit_revision, projection_json'
const MESSAGE_COLUMNS =
  'session_id, message_id, thread_id, parent_message_id, active_child_id, seq, kind, status, created_at, updated_at, branch_id, payload_id, payload_utf8_length, row_metadata_json, selected_depth'
const UPSERT_THREAD_SQL = `INSERT OR REPLACE INTO session_threads (${THREAD_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
const UPSERT_MESSAGE_SQL = `INSERT OR REPLACE INTO session_messages (${MESSAGE_COLUMNS}, message_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
const DELETE_SESSION_THREADS_SQL = 'DELETE FROM session_threads WHERE session_id = ?'
const DELETE_SESSION_MESSAGES_SQL = 'DELETE FROM session_messages WHERE session_id = ?'
const GUARD_REVISION_EXHAUSTION_SQL =
  'INSERT INTO session_row_revision_guard (value) SELECT 1 FROM session_row_heads WHERE session_id = ? AND revision >= ?'
const ADVANCE_SESSION_REVISION_SQL =
  'UPDATE session_row_heads SET revision = revision + 1, mutation_id = ? WHERE session_id = ?'
// Four inline fields across eight threads leave room for escaped structural IDs
// within the metadata response budget. Larger text stays on the sliced path.
const THREAD_INLINE_TEXT_BYTES = 512
function threadMetadataColumns(bounded = true): string {
  return (
    'session_id, thread_id, seq, length(name) AS name_length, created_at, root_message_id, active_leaf_message_id, length(compaction_points_json) AS compaction_points_json_length, length(session_prompt_context_snapshot_json) AS session_prompt_context_snapshot_json_length, length(session_record_json) AS session_record_json_length, commit_revision, projection_json, ' +
    ['name', 'compaction_points_json', 'session_prompt_context_snapshot_json', 'session_record_json']
      .map((column) =>
        bounded
          ? `CASE WHEN length(CAST(${column} AS BLOB)) <= ${THREAD_INLINE_TEXT_BYTES} AND instr(${column}, char(0)) = 0 THEN ${column} ELSE NULL END AS ${column}_inline`
          : `CASE WHEN instr(${column}, char(0)) > 0 THEN json_quote(${column}) ELSE ${column} END AS ${column}_inline,
              (instr(${column}, char(0)) > 0) AS ${column}_nul_encoded`
      )
      .join(', ')
  )
}
const THREAD_METADATA_COLUMNS = threadMetadataColumns()
const SELECT_THREADS_PAGE_SQL = `SELECT ${THREAD_METADATA_COLUMNS} FROM session_threads WHERE session_id = ? ORDER BY seq, thread_id LIMIT ? OFFSET ?`
const SELECT_WINDOW_THREADS_SQL = `SELECT ${THREAD_METADATA_COLUMNS} FROM session_threads WHERE session_id = ? AND (seq = -1 OR thread_id = ?)`
const SELECT_NATIVE_THREADS_PAGE_SQL = `SELECT ${threadMetadataColumns(false)} FROM session_threads WHERE session_id = ? ORDER BY seq, thread_id LIMIT ? OFFSET ?`
const SELECT_NATIVE_WINDOW_THREADS_SQL = `SELECT ${threadMetadataColumns(false)} FROM session_threads WHERE session_id = ? AND (seq = -1 OR thread_id = ?)`
function sqlJsonStringBytes(column: string): string {
  // GLOB stops at NUL; checking it separately keeps suffixes in the escaped path.
  return `(CASE WHEN instr(${column}, char(0)) = 0 AND ${column} NOT GLOB '*[^A-Za-z0-9._:-]*'
    THEN COALESCE(length(CAST(${column} AS BLOB)), 0)
    ELSE 6 * COALESCE(length(CAST(${column} AS BLOB)), 0) END)`
}
const SEARCH_THREAD_ORDER = 'CASE WHEN seq = -1 THEN 0 ELSE 1 END, seq DESC, thread_id DESC'
const SELECT_SEARCH_THREADS_PAGE_SQL = `WITH page AS (
  SELECT thread_id, seq FROM session_threads WHERE session_id = ?
  ORDER BY ${SEARCH_THREAD_ORDER} LIMIT ? OFFSET ?
), sized AS (
  SELECT thread_id, seq, COUNT(*) OVER () AS page_count,
    ROW_NUMBER() OVER (ORDER BY ${SEARCH_THREAD_ORDER}) AS row_number,
    SUM(128 + ${sqlJsonStringBytes('thread_id')}) OVER (ORDER BY ${SEARCH_THREAD_ORDER}) AS response_bytes
  FROM page
)
SELECT CASE WHEN response_bytes <= ? THEN thread_id END AS thread_id, page_count,
  (response_bytes > ?) AS oversized FROM sized
WHERE response_bytes <= ? OR row_number = 1 ORDER BY ${SEARCH_THREAD_ORDER}`
const SELECT_NATIVE_SEARCH_THREADS_PAGE_SQL = `SELECT thread_id, COUNT(*) OVER () AS page_count, 0 AS oversized FROM (
  SELECT thread_id, seq FROM session_threads WHERE session_id = ?
  ORDER BY ${SEARCH_THREAD_ORDER} LIMIT ? OFFSET ?
) ORDER BY ${SEARCH_THREAD_ORDER}`

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
    'row_metadata_json',
  ]
    .map((column) =>
      column === 'row_metadata_json' ? sqlMetadataStringBytes(prefix + column) : sqlJsonStringBytes(prefix + column)
    )
    .join(' + ')}`
}
const MESSAGE_RECORD_ESTIMATED_JSON_BYTES = messageRecordEstimatedJsonBytes()
// Carry the cumulative budget through recursion so a wide row stops lookahead
// before traversing the remainder of the requested window.
function selectMessagePageSql(hasCursor: boolean, bounded = true, threadOnly = false): string {
  if (!bounded) {
    return `SELECT ${MESSAGE_COLUMNS} FROM session_messages
      WHERE session_id = ?${threadOnly ? ' AND thread_id = ?' : ''}${hasCursor ? ' AND (thread_id, seq, message_id) > (?, ?, ?)' : ''}
      ORDER BY thread_id, seq, message_id LIMIT ?`
  }
  return `WITH page AS (
    SELECT ${MESSAGE_COLUMNS}
    FROM session_messages
    WHERE session_id = ?${threadOnly ? ' AND thread_id = ?' : ''}${hasCursor ? ' AND (thread_id, seq, message_id) > (?, ?, ?)' : ''}
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
const SELECT_MESSAGE_PAYLOAD_SLICE_SQL = `SELECT typeof(message_json) AS value_type,
  length(message_json) AS value_length, substr(message_json, ?, ?) AS value
  FROM session_messages WHERE payload_id = ? LIMIT 1`
const DELETE_ORPHAN_MESSAGE_NAVIGATION_SQL =
  'DELETE FROM session_message_navigation WHERE NOT EXISTS (SELECT 1 FROM session_messages WHERE session_messages.payload_id = session_message_navigation.payload_id) AND NOT EXISTS (SELECT 1 FROM session_messages_staging WHERE session_messages_staging.payload_id = session_message_navigation.payload_id)'

const PAYLOAD_READ_RESPONSE_BUDGET = 384 * 1024
const PAYLOAD_READ_REQUEST_BUDGET = 384 * 1024
const PAYLOAD_READ_BATCH_MESSAGES = 768
// Covers compact keys, safe integer fields, response envelope and iOS column names.
const PAYLOAD_RESPONSE_OVERHEAD = 96
// One SQLite character can become a 12-byte escaped surrogate pair. Reserve
// the response envelope within the payload's soft bridge budget.
const PAYLOAD_SLICE_CHARACTERS = Math.floor((PAYLOAD_READ_RESPONSE_BUDGET - 1024) / 12)
const THREAD_PAGE_SIZE = 8
// Reserve bridge headroom with a conservative metadata response budget.
// Safe identifier characters need no JSON escaping. Other text keeps a six-times
// allowance, plus fixed object/numeric overhead, before choosing a fitting page.
const MESSAGE_PAGE_RESPONSE_BUDGET = 384 * 1024
/** Complete message bodies materialized together during row iteration. */
const ROW_ITERATION_BATCH_BYTES = 384 * 1024
// Every metadata row contributes at least 512 estimated bytes. Rows beyond
// this bounded lookahead cannot fit in the current response budget.
const MESSAGE_PAGE_MAX_ROWS = Math.floor(MESSAGE_PAGE_RESPONSE_BUDGET / 512)
const MESSAGE_ID_REQUEST_BUDGET = 384 * 1024
const THREAD_TEXT_SLICE_CHARACTERS = 32 * 1024
const STRUCTURAL_ID_BYTES = 1024
const textEncoder = new TextEncoder()
let payloadSequence = 0

function selectMessageIdsSql(count: number, bounded = true): string {
  const requested = Array.from({ length: count }, (_, index) => `(?, ${index})`).join(', ')
  if (!bounded) {
    return `WITH requested(requested_id, request_index) AS (VALUES ${requested})
      SELECT ${MESSAGE_COLUMNS}, request_index, MAX(request_index) OVER () AS last_request_index,
        0 AS metadata_oversized
      FROM requested JOIN session_messages m ON m.message_id = requested.requested_id
      WHERE m.session_id = ? AND request_index >= ? ORDER BY request_index`
  }
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

function selectMessagePayloadsSql(count: number, ascii = false, bounded = true): string {
  const requested = `WITH requested(payload_id, request_index) AS (VALUES ${Array.from({ length: count }, (_, index) => `(?, ${index})`).join(', ')})`
  if (!bounded)
    return `${requested}
    SELECT request_index AS i, message_json AS v, 0 AS x
    FROM session_messages JOIN requested USING(payload_id) ORDER BY request_index`
  return `${requested}, bodies AS (
    SELECT request_index, message_json,
      SUM(CASE WHEN typeof(message_json) = 'text'
        THEN ${ascii ? sqlPayloadJsonStringBytes('message_json') : '6 * length(CAST(message_json AS BLOB))'} + ${PAYLOAD_RESPONSE_OVERHEAD}
        ELSE ${PAYLOAD_READ_RESPONSE_BUDGET + 1} END) OVER () AS response_bytes,
      ROW_NUMBER() OVER (ORDER BY request_index) AS row_number
    FROM session_messages JOIN requested USING(payload_id)
  )
  SELECT CASE WHEN response_bytes <= ${PAYLOAD_READ_RESPONSE_BUDGET} THEN request_index END AS i,
    CASE WHEN response_bytes <= ${PAYLOAD_READ_RESPONSE_BUDGET} THEN message_json END AS v,
    (response_bytes > ${PAYLOAD_READ_RESPONSE_BUDGET}) AS x
  FROM bodies WHERE response_bytes <= ${PAYLOAD_READ_RESPONSE_BUDGET} OR row_number = 1 ORDER BY request_index`
}

// Reserve the largest SQL shape and cursor plus envelope headroom. Each ID's
// JSON-encoded UTF-8 bytes are added separately, including escaping and commas.
const MESSAGE_ID_REQUEST_OVERHEAD =
  textEncoder.encode(
    JSON.stringify({ statement: selectMessageIdsSql(MESSAGE_PAGE_MAX_ROWS), values: [Number.MAX_SAFE_INTEGER] })
  ).byteLength + 1024
const PAYLOAD_ID_REQUEST_OVERHEAD =
  textEncoder.encode(JSON.stringify({ statement: selectMessagePayloadsSql(PAYLOAD_READ_BATCH_MESSAGES), values: [] }))
    .byteLength + 1024
const ASCII_PAYLOAD_ID_REQUEST_OVERHEAD =
  textEncoder.encode(
    JSON.stringify({ statement: selectMessagePayloadsSql(PAYLOAD_READ_BATCH_MESSAGES, true), values: [] })
  ).byteLength + 1024

function jsonStringResponseBytes(value: string): number {
  return /[^A-Za-z0-9._:-]/.test(value) ? 6 * textEncoder.encode(value).byteLength : value.length
}

type SelectedPayloadWireRecord = { i: number; v: string; x: 0 } | { x: 1 }
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

export function validateThreadRow(thread: ThreadRow, sessionId: string): void {
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

export function validateMessageRow(message: MessageRowMetadata, sessionId: string): void {
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
  requireStructuralId(message.pendingBranchId ?? null, `message ${message.messageId} pendingBranchId`)
  requireStructuralId(message.forkPivotId ?? null, `message ${message.messageId} forkPivotId`)
  if (message.fork) {
    requireStructuralId(message.fork.pivotId, 'fork pivotId')
    requireStructuralId(message.fork.branchPointId, 'fork branchPointId')
    requireStructuralId(message.fork.selectedBranchId, 'fork selectedBranchId')
  }
  requireStructuralId(message.branchId, `message ${message.messageId} branchId`)
  if (message.sessionId !== sessionId) {
    throw new Error(`message ${message.messageId} belongs to session ${message.sessionId}`)
  }
}

export function threadStatement(thread: ThreadRow, commit?: SessionRowCommit): SessionRowSqlStatement {
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
      thread.summary || thread.control ? JSON.stringify({ summary: thread.summary, control: thread.control }) : null,
    ],
  }
}

function createPayloadId(message: MessageRow): string {
  payloadSequence += 1
  const runtimeCrypto = (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto
  const nonce = runtimeCrypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${payloadSequence.toString(36)}`
  return `${message.sessionId}:${message.messageId}:${nonce}`
}

export function* messageStatements(message: MessageRow, selectedDepth?: number): Generator<SessionRowSqlStatement> {
  const payload = { ...message.message }
  const serialized = serializeJson(payload, `message ${message.messageId}`)
  const payloadId = createPayloadId(message)
  const utf8Length = textEncoder.encode(serialized).byteLength
  const projection = navigationProjection(payload)
  yield {
    kind: 'insert-message-navigation',
    sql: INSERT_MESSAGE_NAVIGATION_SQL,
    params: [payloadId, projection.role, Number(projection.eligible), projection.preview],
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
      utf8Length,
      rowExtra(message),
      selectedDepth ?? null,
      serialized,
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
  if (record.projection_json) Object.assign(thread, JSON.parse(record.projection_json))
  return thread
}

function readCommitMetadata(
  sessionId: string,
  records: Pick<ThreadRecord, 'seq' | 'thread_id' | 'session_record_json' | 'commit_revision'>[],
  revision: number | null
): SessionRowCommit {
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

function toMessageRow(record: MessageRecord, message: Message): MessageRow {
  return { ...toMessageMetadata(record), message }
}

function toMessageMetadata(record: MessageRecord): MessageRowMetadata {
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
    ...parseRowExtra(record.row_metadata_json),
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
  private readonly boundedReads: boolean

  constructor(
    private readonly database: SessionRowSqlDatabase,
    private readonly createRowId?: () => string,
    options: SessionRowSqlReadOptions = {}
  ) {
    this.boundedReads = options.readByteBudget !== 'none'
  }

  private get threadsPageSql(): string {
    return this.boundedReads ? SELECT_THREADS_PAGE_SQL : SELECT_NATIVE_THREADS_PAGE_SQL
  }

  private get windowThreadsSql(): string {
    return this.boundedReads ? SELECT_WINDOW_THREADS_SQL : SELECT_NATIVE_WINDOW_THREADS_SQL
  }

  initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = Promise.resolve()
        .then(() =>
          this.database.execute(
            CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL +
              SESSION_TEXT_TOKEN_SCHEMA_SQL +
              SESSION_TRANSCRIPT_SCHEMA_SQL +
              SESSION_TOKEN_CACHE_SQL +
              SESSION_ROW_PROJECTION_SCHEMA_SQL
          )
        )
        .catch((error: unknown) => {
          this.initializePromise = null
          throw new SessionRowStoreError('initialize', error)
        })
    }
    return this.initializePromise
  }

  private transcriptReader(sessionId: string) {
    return sqlTranscriptReader(
      this.database,
      sessionId,
      async (ids) => this.readMessageRows(await this.readMessageRecordsByIds(sessionId, ids), null),
      this.boundedReads
    )
  }

  async readMessageMetadata(request: SessionMessageMetadataRequest) {
    return this.run('read-message-metadata', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        request,
        () => this.readRevision(request.sessionId),
        (commit) =>
          readMetadataSelection(
            request,
            commit,
            sqlRelationReader(this.database, request.sessionId, this.boundedReads)
          ),
        this.boundedReads
      )
    )
  }

  async readMessageRelationsPage(request: SessionMessageRelationsRequest) {
    return this.run('read-message-relations', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        { sessionId: request.sessionId, expectedRevision: request.expectedRevision },
        () => this.readRevision(request.sessionId),
        (commit) =>
          readRelationsPage(request, commit, sqlRelationReader(this.database, request.sessionId, this.boundedReads)),
        this.boundedReads
      )
    )
  }

  async readThreadState(request: SessionThreadStateRequest) {
    return this.run('read-thread', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        request,
        () => this.readRevision(request.sessionId),
        async (commit) => {
          const threadId = request.threadId ?? commit.record.activeThreadId
          const metadata = await this.database.query<ThreadMetadataRecord>(
            `SELECT ${threadMetadataColumns(this.boundedReads)} FROM session_threads WHERE session_id=? AND thread_id=?`,
            [request.sessionId, threadId]
          )
          const [stored] = await this.readThreadRecords(metadata)
          if (!stored) return null
          const thread = toThreadRow(stored)
          return thread.summary
            ? { ...commit, status: 'ready' as const, thread: { ...thread, summary: thread.summary } }
            : { ...commit, status: 'projection-unavailable' as const, messageIds: [], threadIds: [threadId] }
        },
        this.boundedReads
      )
    )
  }

  async readThreadSummariesPage(request: SessionThreadPageRequest) {
    validateSessionThreadPageRequest(request)
    return this.run('read-thread-page', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        { sessionId: request.sessionId, expectedRevision: request.cursor?.revision },
        () => this.readRevision(request.sessionId),
        async (commit) => {
          const records = await this.database.query<{ thread_id: string }>(
            `SELECT thread_id FROM session_threads WHERE session_id=? ORDER BY ${SEARCH_THREAD_ORDER} LIMIT ? OFFSET ?`,
            [request.sessionId, request.limit + 1, request.cursor?.offset ?? 0]
          )
          const threads = []
          const reader = this.transcriptReader(request.sessionId)
          for (const record of records.slice(0, request.limit)) {
            const thread = await reader.thread(record.thread_id)
            if (!thread) throw new Error('Thread summary disappeared')
            threads.push(thread)
          }
          return {
            ...commit,
            threads,
            nextCursor:
              records.length > request.limit
                ? {
                    sessionId: request.sessionId,
                    revision: commit.revision,
                    offset: (request.cursor?.offset ?? 0) + request.limit,
                  }
                : null,
          }
        },
        this.boundedReads
      )
    )
  }

  async readCommit(sessionId: string) {
    return this.run('read-commit', sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        { sessionId },
        () => this.readRevision(sessionId),
        async (commit) => commit,
        this.boundedReads
      )
    )
  }

  async readThread(request: SessionThreadRequest) {
    return this.run('read-thread', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        request,
        () => this.readRevision(request.sessionId),
        (commit) => readSqlTranscriptThread(request, commit, this.transcriptReader(request.sessionId)),
        this.boundedReads
      )
    )
  }

  async readBranchPreview(request: SessionBranchPreviewRequest) {
    validateBranchPreviewRequest(request)
    return this.run('read-transcript', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        request,
        () => this.readRevision(request.sessionId),
        (commit) => readSqlBranchPreview(this.database, request, commit, this.boundedReads),
        this.boundedReads
      )
    )
  }

  async readBranchMessagesPage(request: SessionBranchMessagesRequest) {
    validateBranchMessagesRequest(request)
    return this.run('read-transcript', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        { sessionId: request.sessionId, expectedRevision: request.expectedRevision ?? request.cursor?.revision },
        () => this.readRevision(request.sessionId),
        (commit) => readBranchMessagesPage(request, commit, this.transcriptReader(request.sessionId)),
        this.boundedReads
      )
    )
  }

  async readTranscriptWindow(request: SessionTranscriptRequest) {
    validateTranscriptRequest(request)
    return this.run('read-transcript', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        request,
        () => this.readRevision(request.sessionId),
        (commit) => readTranscriptPage(request, commit, this.transcriptReader(request.sessionId)),
        this.boundedReads
      )
    )
  }

  async readNavigationPage(request: SessionTranscriptRequest) {
    validateTranscriptRequest(request)
    return this.run('read-navigation', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        request,
        () => this.readRevision(request.sessionId),
        (commit) => readNavigationPage(request, commit, this.transcriptReader(request.sessionId)),
        this.boundedReads
      )
    )
  }

  async repairNavigationProjections(request: SessionNavigationRepairRequest): Promise<void> {
    validateNavigationRepair(request)
    await this.run('read-navigation', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        request,
        () => this.readRevision(request.sessionId),
        async () => {
          const records = await this.readMessageRecordsByIds(request.sessionId, request.messageIds)
          const statements: SessionRowSqlStatement[] = []
          for (const record of records) {
            const [row] = await this.readMessageRows([record], null)
            const projection = navigationProjection(row.message)
            statements.push({
              kind: 'insert-message-navigation',
              sql: 'INSERT OR REPLACE INTO session_message_navigation (payload_id,role,eligible,preview) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM session_messages WHERE session_id = ? AND message_id = ? AND payload_id = ?)',
              params: [
                record.payload_id,
                projection.role,
                Number(projection.eligible),
                projection.preview,
                request.sessionId,
                row.messageId,
                record.payload_id,
              ],
            })
          }
          await this.database.executeBatch(statements)
        },
        this.boundedReads
      )
    )
  }

  async stageRows(commit: SessionRowCommit, expectedRevision: number | null) {
    await this.initialize()
    return createSqlRowWriter(this.database, commit, expectedRevision, this.createRowId)
  }

  async stageImportRows(commit: SessionRowCommit, expectedRevision: number | null, jobId: string) {
    const captured = { record: structuredClone(commit.record), revision: commit.revision }
    await this.initialize()
    return createSqlImportWriter(this.database, captured, expectedRevision, jobId)
  }

  async resumeImportRows(candidateId: string) {
    await this.initialize()
    return resumeSqlImportWriter(this.database, candidateId)
  }

  async collectImportGarbage(): Promise<void> {
    await this.initialize()
    await this.database.executeBatch([{ sql: DELETE_ORPHAN_MESSAGE_NAVIGATION_SQL, params: [] }])
  }

  async *iterateRows(request: SessionRowIterationRequest): AsyncGenerator<SessionStoredRow> {
    const { sessionId, threadId, signal, expectedRevision } = request
    await this.initialize()
    throwIfAborted(signal)
    const revision = await this.readRevision(sessionId)
    if (expectedRevision !== undefined && expectedRevision !== revision)
      throw new SessionRowConflictError(sessionId, expectedRevision, revision)
    if (revision === null) return
    const check = async () => {
      throwIfAborted(signal)
      const actual = await this.readRevision(sessionId)
      if (actual !== revision) throw new SessionRowConflictError(sessionId, revision, actual)
    }
    for (let offset = 0; ; offset += THREAD_PAGE_SIZE) {
      await check()
      const page = await this.database.query<ThreadMetadataRecord>(
        threadId
          ? this.threadsPageSql.replace('session_id = ?', 'session_id = ? AND thread_id = ?')
          : this.threadsPageSql,
        threadId ? [sessionId, threadId, THREAD_PAGE_SIZE, offset] : [sessionId, THREAD_PAGE_SIZE, offset]
      )
      if (!page.length) break
      const threads = await this.readThreadRecords(page)
      await check()
      for (const thread of threads) {
        throwIfAborted(signal)
        yield { kind: 'thread', thread: toThreadRow(thread) }
      }
    }
    let cursor: MessageRecord | undefined
    for (;;) {
      await check()
      const params: SessionRowSqlBindValue[] = [sessionId]
      if (threadId !== undefined) params.push(threadId)
      if (cursor) params.push(cursor.thread_id, cursor.seq, cursor.message_id)
      params.push(MESSAGE_PAGE_MAX_ROWS)
      if (this.boundedReads) params.push(MESSAGE_PAGE_RESPONSE_BUDGET)
      const page = await this.database.query<MessageRecord>(
        selectMessagePageSql(!!cursor, this.boundedReads, threadId !== undefined),
        params
      )
      if (!page.length) break
      for (let start = 0; start < page.length; ) {
        let end = start,
          bytes = 0
        do {
          bytes += page[end++].payload_utf8_length
        } while (end < page.length && bytes + page[end].payload_utf8_length <= ROW_ITERATION_BATCH_BYTES)
        const rows = await this.readMessageRows(page.slice(start, end), null)
        await check()
        for (const message of rows) {
          throwIfAborted(signal)
          yield { kind: 'message', message }
        }
        start = end
      }
      cursor = page[page.length - 1]
    }
    await check()
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
            this.threadsPageSql,
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

  async readThreadsPage(request: SessionThreadPageRequest): Promise<SessionThreadPage | null> {
    const { sessionId } = request
    return this.run('read-thread-page', sessionId, async () => {
      validateSessionThreadPageRequest(request)
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await this.readRevision(sessionId)
        assertSessionThreadPageRevision(request, before)
        let page: SessionThreadPage | null
        try {
          const metadata = await this.database.query<ThreadMetadataRecord>(this.windowThreadsSql, [sessionId, null])
          if (!metadata.length) {
            page = null
          } else {
            const active = metadata[0]
            const sessionRecord = await this.readThreadText(
              active,
              'session_record_json',
              active.session_record_json_length === null ? null : Number(active.session_record_json_length)
            )
            const commit = readCommitMetadata(sessionId, [{ ...active, session_record_json: sessionRecord }], before)
            const offset = request.cursor?.offset ?? 0
            const rows = await this.database.query<{ thread_id: string | null; page_count: number; oversized: number }>(
              this.boundedReads ? SELECT_SEARCH_THREADS_PAGE_SQL : SELECT_NATIVE_SEARCH_THREADS_PAGE_SQL,
              [
                sessionId,
                request.limit + 1,
                offset,
                ...(this.boundedReads
                  ? [MESSAGE_PAGE_RESPONSE_BUDGET, MESSAGE_PAGE_RESPONSE_BUDGET, MESSAGE_PAGE_RESPONSE_BUDGET]
                  : []),
              ]
            )
            if (rows.some((row) => row.oversized || row.thread_id === null)) {
              throw new Error('Thread identity exceeds the native response budget')
            }
            const threadIds = rows.slice(0, request.limit).map((row) => {
              if (row.thread_id === null) throw new Error('Thread identity is missing')
              return row.thread_id
            })
            page = {
              ...commit,
              threadIds,
              nextCursor:
                (rows[0]?.page_count ?? 0) > threadIds.length
                  ? { sessionId, revision: commit.revision, offset: offset + threadIds.length }
                  : null,
            }
          }
        } catch (error) {
          const afterFailure = await this.readRevision(sessionId)
          assertSessionThreadPageRevision(request, afterFailure)
          if (before !== afterFailure) continue
          throw error
        }
        const after = await this.readRevision(sessionId)
        assertSessionThreadPageRevision(request, after)
        if (before !== after) continue
        return page
      }
      throw new Error(`session ${sessionId} changed repeatedly while its thread page was being read`)
    })
  }

  async readTokenCache(request: SessionTokenCacheRequest) {
    validateTokenCacheRequest(request)
    return this.run('read-messages', request.sessionId, () =>
      withSqlTranscriptCommit(
        this.database,
        request,
        () => this.readRevision(request.sessionId),
        async (commit) => ({ ...commit, entries: await readSqlTokenCache(this.database, request) }),
        this.boundedReads
      )
    )
  }

  async acceptTokenCache(results: readonly SessionTokenCacheResult[]): Promise<void> {
    await this.initialize()
    await acceptSqlTokenCache(this.database, results)
  }

  async readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSnapshot | null> {
    return this.run('read-messages', request.sessionId, async () => {
      validateSessionMessagesRequest(request)
      return withSqlTranscriptCommit(
        this.database,
        request,
        () => this.readRevision(request.sessionId),
        async (commit) => {
          const sources: Record<string, SessionTextTokenSource> = Object.create(null)
          const messages = await this.readMessageRows(
            await this.readMessageRecordsByIds(request.sessionId, request.messageIds),
            sources
          )
          return { ...commit, messages, textTokens: await this.readTokenSnapshot(sources) }
        },
        this.boundedReads
      )
    })
  }

  private async readMessageRecordsByIds(sessionId: string, ids: string[]): Promise<MessageRecord[]> {
    const unique = [...new Set(ids)]
    const found = new Map<string, MessageRecord>()
    const baseBytes = this.boundedReads
      ? MESSAGE_ID_REQUEST_OVERHEAD + textEncoder.encode(JSON.stringify(sessionId)).byteLength + 1
      : 0
    for (let offset = 0; offset < unique.length; ) {
      const batch: string[] = []
      let requestBytes = baseBytes
      while (offset < unique.length && batch.length < MESSAGE_PAGE_MAX_ROWS) {
        const id = unique[offset]
        const idBytes = this.boundedReads ? textEncoder.encode(JSON.stringify(id)).byteLength + 1 : 0
        if (this.boundedReads && requestBytes + idBytes > MESSAGE_ID_REQUEST_BUDGET) {
          if (batch.length === 0) throw new Error('Message selection ID exceeds the native request budget')
          break
        }
        batch.push(id)
        requestBytes += idBytes
        offset++
      }
      const sql = selectMessageIdsSql(batch.length, this.boundedReads)
      let cursor = 0
      while (cursor < batch.length) {
        const records = await this.database.query<SelectedMessageRecord>(sql, [...batch, sessionId, cursor])
        if (records.length === 0) break
        for (const record of records) {
          if (record.metadata_oversized === 1) {
            const [sliced] = await queryRowMetadata<MessageRecord>(
              this.database,
              `SELECT ${MESSAGE_COLUMNS} FROM session_messages WHERE session_id=? AND message_id=?`,
              [sessionId, batch[Number(record.request_index)]],
              MESSAGE_COLUMNS.split(', '),
              true
            )
            if (!sliced) throw new Error('Message metadata changed during a read')
            validateMessageRow(toMessageMetadata(sliced), sessionId)
            found.set(sliced.message_id, sliced)
          } else found.set(record.message_id, record)
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
    return new SessionTextTokenSqlCache(this.database, this.boundedReads).read(sources)
  }

  async acceptTextTokenResults(results: readonly SessionTextTokenResult[]): Promise<SessionTextTokenResult[]> {
    await this.initialize()
    return new SessionTextTokenSqlCache(this.database, this.boundedReads).accept(results)
  }

  private async readTokenSnapshot(sources: Record<string, SessionTextTokenSource>): Promise<SessionTextTokenRead> {
    return { sources, results: await this.readTextTokenResults(Object.values(sources)) }
  }

  async applyDiff(
    diff: SessionRowsDiff,
    commit: SessionRowCommit,
    expectedRevision?: number
  ): Promise<SessionRowMutationResult> {
    if (commit.record.rowFormatVersion === 3) {
      requireSessionId(diff.sessionId, 'diff')
      if (commit.record.id !== diff.sessionId || !Number.isSafeInteger(commit.revision) || commit.revision < 1)
        throw new SessionRowStoreError('apply-diff', new Error('Invalid commit metadata'), diff.sessionId)
      if (expectedRevision === undefined)
        throw new SessionRowStoreError(
          'apply-diff',
          new Error('Local row edits require an expected revision'),
          diff.sessionId
        )
      return this.run('apply-diff', diff.sessionId, async () => {
        assertSessionReadRevision(
          { sessionId: diff.sessionId, expectedRevision },
          await this.readRevision(diff.sessionId)
        )
        try {
          return await applySqlLocalMutation(
            this.database,
            diff,
            commit,
            expectedRevision,
            async (threadId) => {
              const result = await this.readThreadState({ sessionId: diff.sessionId, threadId, expectedRevision })
              if (result?.status === 'projection-unavailable') throw new Error('Thread projection is unavailable')
              return result?.thread ?? null
            },
            this.boundedReads
          )
        } catch (error) {
          assertSessionReadRevision(
            { sessionId: diff.sessionId, expectedRevision },
            await this.readRevision(diff.sessionId)
          )
          throw error
        }
      })
    }
    throw new SessionRowStoreError(
      'apply-diff',
      new Error('Session rows require a format upgrade before editing'),
      diff.sessionId
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
          { kind: 'delete-orphan-message-navigation', sql: DELETE_ORPHAN_MESSAGE_NAVIGATION_SQL, params: [] },
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
      const depths = selectedDepths(rows)
      for (const message of rows.messages) {
        validateMessageRow(message, rows.sessionId)
        yield* messageStatements(message, depths.get(message.messageId))
      }
      yield {
        kind: 'delete-orphan-message-navigation',
        sql: DELETE_ORPHAN_MESSAGE_NAVIGATION_SQL,
        params: [],
      }
      yield textTokenCleanupStatement(rows.sessionId)
    } catch (error) {
      throw new SessionRowStoreError('write-rows', error, rows.sessionId)
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
      params.push(MESSAGE_PAGE_MAX_ROWS)
      if (this.boundedReads) params.push(MESSAGE_PAGE_RESPONSE_BUDGET)
      const page = await this.database.query<MessageRecord>(
        selectMessagePageSql(cursor !== undefined, this.boundedReads),
        params
      )
      if (page.length === 0) return records
      records.push(...page)
      cursor = page[page.length - 1]
    }
  }

  private async readThreadText(
    record: ThreadMetadataRecord,
    column: 'name' | 'compaction_points_json' | 'session_prompt_context_snapshot_json' | 'session_record_json',
    length: number | null,
    bounded = this.boundedReads
  ): Promise<string | null> {
    const inline = record[`${column}_inline`]
    if (!bounded) {
      if (inline !== null && typeof inline !== 'string') {
        throw new Error(`thread ${record.thread_id} has invalid ${column} text`)
      }
      // Some SQLite drivers truncate returned strings at NUL. SQL quotes just
      // those values so the complete stored text survives native conversion.
      if (record[`${column}_nul_encoded`] === 1 && typeof inline === 'string') {
        const decoded: unknown = JSON.parse(inline)
        if (typeof decoded !== 'string') throw new Error(`thread ${record.thread_id} has invalid ${column} text`)
        return decoded
      }
      return inline
    }
    if (length === null) return null
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`thread ${record.thread_id} has an invalid ${column} length`)
    }
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

  private async readThreadRecords(
    records: ThreadMetadataRecord[],
    bounded = this.boundedReads
  ): Promise<ThreadRecord[]> {
    const hydrated: ThreadRecord[] = []
    for (const record of records) {
      const [name, compactionPoints, promptSnapshot, sessionRecord] = await Promise.all([
        this.readThreadText(record, 'name', record.name_length === null ? null : Number(record.name_length), bounded),
        this.readThreadText(record, 'compaction_points_json', Number(record.compaction_points_json_length), bounded),
        this.readThreadText(
          record,
          'session_prompt_context_snapshot_json',
          record.session_prompt_context_snapshot_json_length === null
            ? null
            : Number(record.session_prompt_context_snapshot_json_length),
          bounded
        ),
        this.readThreadText(
          record,
          'session_record_json',
          record.session_record_json_length === null ? null : Number(record.session_record_json_length),
          bounded
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
        projection_json: record.projection_json,
      })
    }
    return hydrated
  }

  private validatePayloadManifest(record: MessagePayloadRecord): { expectedLength: number } {
    const expectedLength = Number(record.payload_utf8_length)
    if (
      typeof record.payload_id !== 'string' ||
      !record.payload_id ||
      !Number.isSafeInteger(expectedLength) ||
      expectedLength < 0
    )
      throw new Error('Invalid message payload metadata')
    return { expectedLength }
  }

  private parseMessagePayload(record: MessagePayloadRecord, serialized: string | undefined): Message {
    const { expectedLength } = this.validatePayloadManifest(record)
    if (typeof serialized !== 'string' || textEncoder.encode(serialized).byteLength !== expectedLength)
      throw new Error('Message payload length does not match its metadata')
    const message: unknown = JSON.parse(serialized)
    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      (message as Message).id !== record.message_id
    )
      throw new Error('Message payload identity does not match its row')
    return message as Message
  }

  private async readLargePayload(record: MessagePayloadRecord): Promise<string> {
    const parts: string[] = []
    let length: number | undefined
    for (let offset = 1; length === undefined || offset <= length; offset += PAYLOAD_SLICE_CHARACTERS) {
      const rows = await this.database.query<PayloadSliceRecord>(SELECT_MESSAGE_PAYLOAD_SLICE_SQL, [
        offset,
        PAYLOAD_SLICE_CHARACTERS,
        record.payload_id,
      ])
      const row = rows[0]
      if (
        rows.length !== 1 ||
        row.value_type !== 'text' ||
        typeof row.value !== 'string' ||
        !Number.isSafeInteger(row.value_length) ||
        row.value_length < 0 ||
        (length !== undefined && length !== row.value_length)
      )
        throw new Error('Invalid whole message payload slice')
      length = row.value_length
      parts.push(row.value)
    }
    return parts.join('')
  }

  private async readMessageRows(
    records: MessageRecord[],
    sources: Record<string, SessionTextTokenSource> | null,
    knownMessages?: ReadonlyMap<string, Message>
  ): Promise<MessageRow[]> {
    return this.readMessagePayloads(records, toMessageRow, sources, records[0]?.session_id ?? '', knownMessages)
  }

  private async readMessagePayloads<Record extends MessagePayloadRecord, Result>(
    records: Record[],
    project: (record: Record, message: Message) => Result,
    sources: { [messageId: string]: SessionTextTokenSource } | null,
    sessionId: string,
    knownMessages?: ReadonlyMap<string, Message>
  ): Promise<Result[]> {
    const missing = knownMessages ? records.filter((record) => !knownMessages.has(record.message_id)) : records
    const payloads = new Map<string, string>()
    let mode: 'sampling' | 'sampled' | 'conservative' = 'sampling'
    let observedExpansion = 2
    let cursor = 0

    while (cursor < missing.length) {
      const firstIdBytes = this.boundedReads
        ? textEncoder.encode(JSON.stringify(missing[cursor].payload_id)).byteLength + 1
        : 0
      const ascii: boolean =
        this.boundedReads &&
        mode === 'sampled' &&
        ASCII_PAYLOAD_ID_REQUEST_OVERHEAD + firstIdBytes <= PAYLOAD_READ_REQUEST_BUDGET
      const batch: Record[] = []
      let batchBytes = 0
      let requestBytes = ascii ? ASCII_PAYLOAD_ID_REQUEST_OVERHEAD : PAYLOAD_ID_REQUEST_OVERHEAD

      for (let index = cursor; index < missing.length && batch.length < PAYLOAD_READ_BATCH_MESSAGES; index += 1) {
        const record = missing[index]
        const { expectedLength } = this.validatePayloadManifest(record)
        if (!this.boundedReads) {
          batch.push(record)
          continue
        }
        const idRequestBytes = textEncoder.encode(JSON.stringify(record.payload_id)).byteLength + 1
        if (PAYLOAD_ID_REQUEST_OVERHEAD + idRequestBytes > PAYLOAD_READ_REQUEST_BUDGET) {
          throw new Error('Message payload ID exceeds the native request budget')
        }
        const overhead = PAYLOAD_RESPONSE_OVERHEAD
        if (6 * expectedLength + overhead > PAYLOAD_READ_RESPONSE_BUDGET) break
        // Observed expansion is a packing hint. SQL verifies every actual chunk
        // before returning any body, including when later text expands further.
        const responseBytes = Math.ceil((ascii ? observedExpansion : 6) * expectedLength) + overhead
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
        const record = missing[cursor]
        payloads.set(record.payload_id, await this.readLargePayload(record))
        cursor += 1
        continue
      }
      const wireChunks = await this.database.query<SelectedPayloadWireRecord>(
        selectMessagePayloadsSql(batch.length, ascii, this.boundedReads),
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
      const chunks = wireChunks.map((chunk) => {
        if (
          chunk.x !== 0 ||
          !Number.isSafeInteger(chunk.i) ||
          chunk.i < 0 ||
          chunk.i >= batch.length ||
          typeof chunk.v !== 'string'
        )
          throw new Error('Invalid message payload wire record')
        const payloadId = batch[chunk.i].payload_id
        if (payloads.has(payloadId)) throw new Error('Duplicate message payload wire record')
        payloads.set(payloadId, chunk.v)
        return { value: chunk.v }
      })
      if (this.boundedReads && mode === 'sampling') {
        for (const record of batch) this.parseMessagePayload(record, payloads.get(record.payload_id))
        if (chunks.every((chunk) => isSafeAsciiPayload(chunk.value))) {
          observedExpansion = chunks.reduce(
            (maximum, chunk) =>
              Math.max(maximum, (JSON.stringify(chunk.value).length - 2) / Math.max(1, chunk.value.length)),
            1
          )
        } else {
          let payloadBytes = 0
          let responseBytes = 0
          for (const chunk of chunks) {
            const bytes = textEncoder.encode(chunk.value).byteLength
            payloadBytes += bytes
            responseBytes += isSafeAsciiPayload(chunk.value) ? JSON.stringify(chunk.value).length - 2 : 6 * bytes
          }
          // Mixed-language conversations can still have predominantly ASCII bodies.
          // Limit their sampling-based increase to twice the conservative page size;
          // SQL checks the actual expansion and rejects a page that exceeds the budget.
          observedExpansion = Math.max(3, Math.ceil(responseBytes / Math.max(1, payloadBytes)))
        }
        mode = observedExpansion < 6 ? 'sampled' : 'conservative'
      }
      cursor += batch.length
    }

    return records.map((record) => {
      const known = knownMessages?.get(record.message_id)
      const message = known ? structuredClone(known) : this.parseMessagePayload(record, payloads.get(record.payload_id))
      if (sources) {
        const source = createTextTokenSource(sessionId, message, record.payload_id)
        if (source) sources[record.message_id] = source
      }
      return project(record, message)
    })
  }
}
