import type { SessionRowCommit } from '../ports/session-row-store'
import type {
  SessionThreadRequest,
  SessionTranscriptRequest,
  SessionTranscriptThread,
} from '../ports/session-transcript-source'
import type { MessageRow, MessageRowMetadata, SessionRecordV2 } from '../session/session-tree/types'
import { queryRowMetadata } from './session-row-metadata-sql'
import { parseRowExtra } from './session-row-projection-sql'
import type { SessionRowSqlDatabase } from './session-row-sql'
import {
  assertTranscriptRevision,
  readTranscriptPage,
  type SessionTranscriptReader,
  type TranscriptMessageMetadata,
} from './session-transcript-read'

export const SESSION_TRANSCRIPT_SCHEMA_SQL = `
CREATE INDEX IF NOT EXISTS idx_session_threads_transcript ON session_threads(session_id, threadOrder, thread_id);
CREATE INDEX IF NOT EXISTS idx_session_threads_nonempty ON session_threads(session_id, threadOrder, thread_id) WHERE root_message_id IS NOT NULL;
`
const THREAD_NAME_SQL = 'CASE WHEN instr(name,char(0))>0 THEN json_quote(name) ELSE name END'
const THREAD_COLUMNS = `projection_json, session_id, thread_id, threadOrder, created_at, root_message_id, active_leaf_message_id,
  instr(name,char(0))>0 AS name_encoded, length(${THREAD_NAME_SQL}) AS name_length, substr(${THREAD_NAME_SQL}, 1, 4096) AS name_inline`
interface ThreadRecord {
  projection_json: string | null
  session_id: string
  thread_id: string
  threadOrder: number
  created_at: number
  root_message_id: string | null
  active_leaf_message_id: string | null
  name_encoded: number
  name_length: number | null
  name_inline: string | null
}
interface MessageRecord {
  row_metadata_json: string | null
  session_id: string
  thread_id: string
  message_id: string
  parent_message_id: string | null
  active_child_id: string | null
  siblingOrder: number
  kind: MessageRowMetadata['kind']
  status: MessageRowMetadata['status']
  created_at: number
  updated_at: number
  branch_id: string | null
  payload_utf8_length: number
}

const MESSAGE_COLUMNS = [
  'row_metadata_json',
  'session_id',
  'thread_id',
  'message_id',
  'parent_message_id',
  'active_child_id',
  'siblingOrder',
  'kind',
  'status',
  'created_at',
  'updated_at',
  'branch_id',
  'payload_utf8_length',
] as const
const MESSAGE_SELECTION = MESSAGE_COLUMNS.map((column) => `m.${column}`).join(', ')
function transcriptMetadata(row: MessageRecord): TranscriptMessageMetadata {
  const metadata: TranscriptMessageMetadata = {
    sessionId: row.session_id,
    threadId: row.thread_id,
    messageId: row.message_id,
    parentMessageId: row.parent_message_id,
    activeChildId: row.active_child_id,
    siblingOrder: Number(row.siblingOrder),
    kind: row.kind,
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    branchId: row.branch_id,
    payloadBytes: Number(row.payload_utf8_length),
    ...parseRowExtra(row.row_metadata_json),
  }
  return metadata
}

/** Reads only header text. Thread compactions, topology, and payloads are separate queries. */
export async function readSqlTranscriptCommit(
  database: SessionRowSqlDatabase,
  sessionId: string,
  revision: number | null,
  bounded = true
): Promise<SessionRowCommit | null> {
  return readSqlCommitHeader(database, sessionId, revision, bounded)
}

export async function readSqlExportCommit(
  database: SessionRowSqlDatabase,
  sessionId: string,
  bounded = true
): Promise<SessionRowCommit | null> {
  const commit = await readSqlCommitHeader(database, sessionId, undefined, bounded)
  if (commit && (commit.record.rowAuthority !== 1 || commit.record.rowFormatVersion !== 3))
    throw new Error('Export commit row format is unsupported')
  return commit
}

async function readSqlCommitHeader(
  database: SessionRowSqlDatabase,
  sessionId: string,
  expectedRevision: number | null | undefined,
  bounded: boolean
): Promise<SessionRowCommit | null> {
  const rows = await database.query<{
    thread_id: string
    commit_revision: number | null
    size: number | null
    value: string | null
  }>(
    `SELECT thread_id, commit_revision, ${bounded ? 'length(session_record_json) AS size, substr(session_record_json, 1, 4096) AS value' : 'NULL AS size, session_record_json AS value'}
      FROM session_threads WHERE session_id = ? AND threadOrder = -1 LIMIT 2`,
    [sessionId]
  )
  if (rows.length === 0) return null
  const revision = expectedRevision === undefined ? Number(rows[0].commit_revision) : expectedRevision
  if (
    rows.length !== 1 ||
    revision === null ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    Number(rows[0].commit_revision) !== revision ||
    (bounded && rows[0].size === null)
  )
    throw new Error('Transcript commit metadata is inconsistent')
  const row = rows[0]
  const value = await readText(database, sessionId, row.thread_id, 'session_record_json', row.size, row.value, bounded)
  if (value === null) throw new Error('Transcript commit is missing')
  const record = JSON.parse(value) as SessionRecordV2
  if (record.id !== sessionId || record.activeThreadId !== row.thread_id)
    throw new Error('Transcript commit identity is invalid')
  return { record, revision }
}

async function readText(
  database: SessionRowSqlDatabase,
  sessionId: string,
  threadId: string,
  column: 'name' | 'session_record_json',
  size: number | null,
  initial: string | null,
  bounded = true
): Promise<string | null> {
  if (!bounded) return initial
  if (size === null) return null
  if (!Number.isSafeInteger(size) || size < 0 || typeof initial !== 'string')
    throw new Error('Invalid transcript text metadata')
  let value = initial
  for (let offset = 4097; offset <= size; offset += 4096) {
    const [slice] = await database.query<{ value: string }>(
      `SELECT substr(${column === 'name' ? THREAD_NAME_SQL : column}, ?, 4096) AS value FROM session_threads WHERE session_id = ? AND thread_id = ?`,
      [offset, sessionId, threadId]
    )
    if (!slice || typeof slice.value !== 'string') throw new Error('Transcript text changed during read')
    value += slice.value
  }
  if ([...value].length !== size) throw new Error('Transcript text length is inconsistent')
  return value
}

export function sqlTranscriptReader(
  database: SessionRowSqlDatabase,
  sessionId: string,
  payloads: SessionTranscriptReader['payloads'],
  bounded = true
): SessionTranscriptReader {
  const columns = bounded
    ? THREAD_COLUMNS
    : THREAD_COLUMNS.replace(
        `length(${THREAD_NAME_SQL}) AS name_length, substr(${THREAD_NAME_SQL}, 1, 4096) AS name_inline`,
        `NULL AS name_length, ${THREAD_NAME_SQL} AS name_inline`
      )
  const convert = async (row: ThreadRecord | undefined): Promise<SessionTranscriptThread | null> =>
    row
      ? {
          ...(row.projection_json ? JSON.parse(row.projection_json) : {}),
          sessionId: row.session_id,
          threadId: row.thread_id,
          threadOrder: Number(row.threadOrder),
          createdAt: Number(row.created_at),
          rootMessageId: row.root_message_id,
          activeLeafMessageId: row.active_leaf_message_id,
          name: row.name_encoded
            ? (JSON.parse(
                (await readText(database, sessionId, row.thread_id, 'name', row.name_length, row.name_inline, bounded))!
              ) as string)
            : await readText(database, sessionId, row.thread_id, 'name', row.name_length, row.name_inline, bounded),
        }
      : null
  const active = async () =>
    convert(
      (
        await database.query<ThreadRecord>(
          `SELECT ${columns} FROM session_threads WHERE session_id = ? AND threadOrder = -1 AND root_message_id IS NOT NULL LIMIT 1`,
          [sessionId]
        )
      )[0]
    )
  return {
    thread: async (threadId) =>
      convert(
        (
          await database.query<ThreadRecord>(
            `SELECT ${columns} FROM session_threads WHERE session_id = ? AND thread_id = ?`,
            [sessionId, threadId]
          )
        )[0]
      ),
    adjacent: async (thread, direction) => {
      if (direction === 'after' && thread?.threadOrder === -1) return null
      if (direction === 'before' && !thread) {
        const row = await active()
        if (row) return row
      }
      const after = direction === 'after'
      const hasBoundary = thread !== null && thread.threadOrder !== -1
      const rows = await database.query<ThreadRecord>(
        `SELECT ${columns} FROM session_threads WHERE session_id = ? AND root_message_id IS NOT NULL AND threadOrder >= 0
        ${hasBoundary ? `AND threadOrder ${after ? '>' : '<'} ?` : ''} ORDER BY threadOrder ${after ? 'ASC' : 'DESC'}, thread_id ${after ? 'ASC' : 'DESC'} LIMIT 1`,
        hasBoundary ? [sessionId, thread.threadOrder] : [sessionId]
      )
      return (await convert(rows[0])) ?? (after ? active() : null)
    },
    isOnPath: async (row) => {
      const [result] = await database.query<{ on_path: number }>(
        `WITH RECURSIVE ancestors(message_id,parent_id) AS (
        SELECT message_id,parent_message_id FROM session_messages WHERE session_id=? AND thread_id=? AND message_id=?
        UNION SELECT p.message_id,p.parent_message_id FROM ancestors a JOIN session_messages p ON p.session_id=? AND p.thread_id=? AND p.message_id=a.parent_id AND p.active_child_id=a.message_id
      ) SELECT EXISTS(SELECT 1 FROM ancestors a JOIN session_threads t ON t.session_id=? AND t.thread_id=? AND t.root_message_id=a.message_id WHERE a.parent_id IS NULL) AS on_path`,
        [sessionId, row.threadId, row.messageId, sessionId, row.threadId, sessionId, row.threadId]
      )
      return result?.on_path === 1
    },
    message: async (messageId) => {
      const [row] = await queryRowMetadata<MessageRecord>(
        database,
        `SELECT ${MESSAGE_SELECTION} FROM session_messages m WHERE m.session_id = ? AND m.message_id = ?`,
        [sessionId, messageId],
        MESSAGE_COLUMNS,
        bounded
      )
      return row ? transcriptMetadata(row) : null
    },
    messagePath: async (threadId, messageId, direction, budget) => {
      if (!Number.isSafeInteger(budget.limit) || budget.limit < 1 || budget.limit > 201)
        throw new Error('Invalid transcript path budget')
      if (!Number.isSafeInteger(budget.remainingBytes)) throw new Error('Invalid transcript remaining byte budget')
      const edge = direction === 'before' ? 'parent_message_id' : 'active_child_id'
      const rows = await queryRowMetadata<MessageRecord>(
        database,
        `WITH RECURSIVE transcript_path(message_id,next_id,depth,payload_bytes,selected_count,current_bytes) AS (
          SELECT message_id,${edge},0,CASE WHEN ? THEN 0 ELSE payload_utf8_length END,
            CASE WHEN ? THEN 0 ELSE 1 END,payload_utf8_length
          FROM session_messages WHERE session_id=? AND thread_id=? AND message_id=?
          UNION ALL
          SELECT m.message_id,m.${edge},p.depth+1,p.payload_bytes+m.payload_utf8_length,
            p.selected_count+1,m.payload_utf8_length
          FROM transcript_path p CROSS JOIN session_messages m
            ON m.session_id=? AND m.thread_id=? AND m.message_id=p.next_id
          WHERE p.depth+1<? AND typeof(p.current_bytes)='integer' AND p.current_bytes>=0
            AND p.current_bytes<=9007199254740991
            AND ((p.depth=0 AND ?=1) OR (p.selected_count=1 AND ?=0) OR p.payload_bytes<=?)
        ) SELECT ${MESSAGE_SELECTION}
          FROM transcript_path p CROSS JOIN session_messages m
            ON m.session_id=? AND m.thread_id=? AND m.message_id=p.message_id
          ORDER BY p.depth`,
        [
          Number(budget.skipFirst),
          Number(budget.skipFirst),
          sessionId,
          threadId,
          messageId,
          sessionId,
          threadId,
          budget.limit,
          Number(budget.skipFirst),
          Number(budget.hasPrevious),
          budget.remainingBytes,
          sessionId,
          threadId,
        ],
        MESSAGE_COLUMNS,
        bounded
      )
      return rows.map(transcriptMetadata)
    },
    payloads,
  }
}

/** Every read is fenced, including absence and failures, so no mixed commit can escape. */
export async function withSqlTranscriptCommit<T>(
  database: SessionRowSqlDatabase,
  request: { sessionId: string; expectedRevision?: number; cursor?: SessionTranscriptRequest['cursor'] },
  revision: () => Promise<number | null>,
  read: (commit: SessionRowCommit) => Promise<T>,
  bounded = true
): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await revision()
    assertTranscriptRevision(request, before)
    let result: T | null
    try {
      const commit = await readSqlTranscriptCommit(database, request.sessionId, before, bounded)
      result = commit ? await read(commit) : null
    } catch (error) {
      const after = await revision()
      assertTranscriptRevision(request, after)
      if (before !== after) continue
      throw error
    }
    const after = await revision()
    assertTranscriptRevision(request, after)
    if (before === after) return result
  }
  throw new Error(`Session ${request.sessionId} changed repeatedly during its transcript read`)
}

export async function readSqlTranscriptThread(
  request: SessionThreadRequest,
  commit: SessionRowCommit,
  reader: SessionTranscriptReader
) {
  const thread = await reader.thread(request.threadId ?? commit.record.activeThreadId)
  return thread ? { ...commit, thread } : null
}
export { readTranscriptPage }
