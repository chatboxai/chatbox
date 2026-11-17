import { v4 as uuid } from 'uuid'
import { type SessionRowCommit, SessionRowConflictError } from '../ports/session-row-store'
import type { SessionRowWriter } from '../ports/session-row-transfer'
import { deriveMessageFacts } from '../session/message-facts'
import type { MessageRow, ThreadRow } from '../session/session-tree/types'
import {
  messageStatements,
  type SessionRowSqlDatabase,
  type SessionRowSqlStatement,
  threadStatement,
  validateMessageRow,
  validateThreadRow,
} from './session-row-sql'
import { sqlTextSlices } from './session-row-sql-text'
import { textTokenCleanupStatement } from './session-text-token-sql'

export const transferColumns = {
  threads:
    'session_id,thread_id,threadOrder,name,created_at,root_message_id,active_leaf_message_id,compaction_points_json,session_prompt_context_snapshot_json,session_record_json,commit_revision,projection_json',
  messages:
    'session_id,message_id,thread_id,parent_message_id,active_child_id,siblingOrder,kind,status,created_at,updated_at,branch_id,payload_id,payload_utf8_length,row_metadata_json,message_json',
}
const columns = transferColumns
const encoder = new TextEncoder()

/** Indexed JSON columns only receive complete documents. */
export function* stagedMetadataStatements(
  mutation: string,
  sessionId: string,
  messageId: string,
  value: string
): Generator<SessionRowSqlStatement> {
  yield {
    sql: 'INSERT OR REPLACE INTO session_row_local_metadata(mutation_id,message_id,value) VALUES (?,?,?)',
    params: [mutation, messageId, ''],
  }
  for (const part of sqlTextSlices(value))
    yield {
      sql: 'UPDATE session_row_local_metadata SET value=value||? WHERE mutation_id=? AND message_id=?',
      params: [part, mutation, messageId],
    }
  yield {
    sql: 'UPDATE session_messages_staging SET row_metadata_json=(SELECT value FROM session_row_local_metadata WHERE mutation_id=? AND message_id=?) WHERE mutation_id=? AND session_id=? AND message_id=?',
    params: [mutation, messageId, mutation, sessionId, messageId],
  }
  yield {
    sql: 'DELETE FROM session_row_local_metadata WHERE mutation_id=? AND message_id=?',
    params: [mutation, messageId],
  }
}

/** A transport-sized stream of writes into one hidden complete-message row. */
export function* stageSqlRow(
  mutation: string,
  table: 'threads' | 'messages',
  statement: SessionRowSqlStatement
): Generator<SessionRowSqlStatement> {
  const values = [...statement.params]
  const fields = columns[table].split(',')
  const large = values.flatMap((value, index) =>
    typeof value === 'string' && encoder.encode(JSON.stringify(value)).byteLength > 32 * 1024 ? [{ index, value }] : []
  )
  for (const { index } of large) values[index] = fields[index] === 'row_metadata_json' ? null : ''
  yield {
    sql: `INSERT INTO session_${table}_staging(mutation_id,${columns[table]}) VALUES (${Array(values.length + 1)
      .fill('?')
      .join(',')})`,
    params: [mutation, ...values],
  }
  for (const { index, value } of large) {
    if (fields[index] === 'row_metadata_json') {
      yield* stagedMetadataStatements(mutation, String(values[0]), String(values[1]), value)
      continue
    }
    for (const part of sqlTextSlices(value))
      yield {
        sql: `UPDATE session_${table}_staging SET ${fields[index]}=${fields[index]}||? WHERE mutation_id=? AND session_id=? AND ${table === 'threads' ? 'thread_id' : 'message_id'}=?`,
        params: [part, mutation, values[0], values[1]],
      }
  }
}

/** Validate staged edges with a bounded recursive question; no path projection is written. */
export async function projectSelectedPaths(
  database: SessionRowSqlDatabase,
  mutation: string,
  commit: SessionRowCommit,
  messageCount: number,
  deriveLeaf = false
): Promise<void> {
  const args = [mutation, commit.record.id]
  const threads = 'session_threads_staging',
    messages = 'session_messages_staging'
  const active = await database.query<{ thread_id: string }>(
    `SELECT thread_id FROM ${threads} WHERE mutation_id=? AND session_id=? AND threadOrder=-1 LIMIT 2`,
    args
  )
  if (active.length !== 1 || active[0].thread_id !== commit.record.activeThreadId)
    throw new Error('Invalid candidate thread identity')
  const roots = await database.query(
    `SELECT 1 FROM ${threads} t LEFT JOIN ${messages} m ON m.mutation_id=t.mutation_id AND m.session_id=t.session_id AND m.message_id=t.root_message_id WHERE t.mutation_id=? AND t.session_id=? AND ((t.root_message_id IS NULL AND t.active_leaf_message_id IS NOT NULL) OR (t.root_message_id IS NOT NULL AND (m.message_id IS NULL OR m.thread_id<>t.thread_id OR m.parent_message_id IS NOT NULL))) LIMIT 1`,
    args
  )
  if (roots.length) throw new Error('Invalid selected row root')
  const path = `WITH RECURSIVE path(message_id,thread_id,expected_parent,depth) AS (
    SELECT t.root_message_id,t.thread_id,NULL,0 FROM ${threads} t WHERE t.mutation_id=? AND t.session_id=? AND t.root_message_id IS NOT NULL
    UNION ALL SELECT m.active_child_id,p.thread_id,m.message_id,p.depth+1 FROM path p JOIN ${messages} m ON m.mutation_id=? AND m.session_id=? AND m.message_id=p.message_id WHERE m.active_child_id IS NOT NULL LIMIT ?
  )`
  const pathArgs = [...args, ...args, messageCount + 1]
  const invalid = await database.query(
    `${path} SELECT 1 FROM path p LEFT JOIN ${messages} m ON m.mutation_id=? AND m.session_id=? AND m.message_id=p.message_id JOIN ${threads} t ON t.mutation_id=? AND t.session_id=? AND t.thread_id=p.thread_id WHERE m.message_id IS NULL OR m.thread_id<>p.thread_id OR m.parent_message_id IS NOT p.expected_parent ${deriveLeaf ? '' : 'OR (m.active_child_id IS NULL AND t.active_leaf_message_id IS NOT m.message_id)'} LIMIT 1`,
    [...pathArgs, ...args, ...args]
  )
  if (invalid.length) throw new Error('Invalid selected row path')
  if (deriveLeaf)
    await database.executeBatch([
      {
        sql: `${path} UPDATE ${threads} SET active_leaf_message_id=(SELECT m.message_id FROM path p JOIN ${messages} m ON m.mutation_id=? AND m.session_id=? AND m.message_id=p.message_id WHERE p.thread_id=${threads}.thread_id AND m.active_child_id IS NULL LIMIT 1) WHERE mutation_id=? AND session_id=?`,
        params: [...pathArgs, ...args, ...args],
      },
    ])
}

export async function createSqlRowWriter(
  database: SessionRowSqlDatabase,
  inputCommit: SessionRowCommit,
  expectedRevision: number | null,
  createId: () => string = uuid
): Promise<SessionRowWriter> {
  const commit = structuredClone(inputCommit)
  const sessionId = commit.record.id
  if (
    !sessionId ||
    commit.record.rowFormatVersion !== 3 ||
    !Number.isSafeInteger(commit.revision) ||
    commit.revision !== (expectedRevision ?? 0) + 1 ||
    (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1))
  )
    throw new Error('Invalid row candidate commit')
  const mutation = createId()
  let messageCount = 0
  let published = false
  let disposed = false
  let failed = false
  const check = () => {
    if (published || disposed || failed) throw new Error('Row candidate is not writable')
  }
  const append = async (statements: Iterable<SessionRowSqlStatement>) => {
    check()
    try {
      // A single message is the memory bound; each native request is independently bounded.
      let batch: SessionRowSqlStatement[] = [],
        bytes = 0
      for (const statement of statements) {
        const size = encoder.encode(JSON.stringify(statement)).byteLength
        if (batch.length && (bytes + size > 384 * 1024 || batch.length >= 128)) {
          await database.executeBatch(batch)
          batch = []
          bytes = 0
        }
        batch.push(statement)
        bytes += size
      }
      if (batch.length) await database.executeBatch(batch)
    } catch (error) {
      failed = true
      throw error
    }
  }
  const cleanup: SessionRowSqlStatement[] = [
    { sql: 'DELETE FROM session_row_local_metadata WHERE mutation_id=?', params: [mutation] },
    ...['messages', 'threads'].map((table) => ({
      sql: `DELETE FROM session_${table}_staging WHERE mutation_id=?`,
      params: [mutation],
    })),
    { sql: 'DELETE FROM session_row_staging_mutations WHERE mutation_id=?', params: [mutation] },
  ]
  await database.executeBatch([
    {
      sql: 'INSERT INTO session_row_staging_mutations(mutation_id,created_at) VALUES (?,?)',
      params: [mutation, Date.now()],
    },
  ])
  return {
    async appendThread(thread: ThreadRow) {
      check()
      validateThreadRow(thread, sessionId)
      await append(stageSqlRow(mutation, 'threads', threadStatement(thread, commit)))
    },
    async appendMessage(message: MessageRow) {
      check()
      validateMessageRow(message, sessionId)
      if (
        message.message.id !== message.messageId ||
        !Number.isSafeInteger(message.siblingOrder) ||
        message.siblingOrder < 0
      )
        throw new Error('Invalid candidate message identity or ordering')
      const statements = function* () {
        for (const statement of messageStatements({ ...message, facts: deriveMessageFacts(message.message) })) {
          if (statement.kind === 'upsert-message') yield* stageSqlRow(mutation, 'messages', statement)
          else yield statement
        }
      }
      await append(statements())
      messageCount += 1
    },
    async publish() {
      check()
      try {
        await projectSelectedPaths(database, mutation, commit, messageCount)
        await database.executeBatch(
          [
            { sql: 'DELETE FROM session_threads WHERE session_id=?', params: [sessionId] },
            { sql: 'DELETE FROM session_messages WHERE session_id=?', params: [sessionId] },
            ...(['threads', 'messages'] as const).map((table) => ({
              sql: `INSERT INTO session_${table}(${columns[table]}) SELECT ${columns[table]} FROM session_${table}_staging WHERE mutation_id=? AND session_id=?`,
              params: [mutation, sessionId],
            })),
            {
              sql: 'INSERT OR REPLACE INTO session_row_heads(session_id,revision,mutation_id) VALUES (?,?,?)',
              params: [sessionId, commit.revision, mutation],
            },
            textTokenCleanupStatement(sessionId),
            ...cleanup,
          ],
          { sessionId, mode: 'local-diff', expectedRevision }
        )
        published = true
      } catch (error) {
        const [head] = await database.query<{ mutation_id: string; revision: number }>(
          'SELECT mutation_id,revision FROM session_row_heads WHERE session_id=?',
          [sessionId]
        )
        if (head?.mutation_id === mutation && head.revision === commit.revision) {
          published = true
          return
        }
        failed = true
        if ((head?.revision ?? null) !== expectedRevision)
          throw new SessionRowConflictError(sessionId, expectedRevision, head?.revision ?? null)
        throw error
      }
    },
    async dispose() {
      if (disposed || published) return
      await database.executeBatch(cleanup)
      disposed = true
    },
  }
}
