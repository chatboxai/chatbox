import { v4 as uuid } from 'uuid'
import type { SessionRowCommit, SessionRowsDiff } from '../ports/session-row-store'
import type { ThreadRow } from '../session/session-tree/types'
import {
  messageStatements,
  threadStatement,
  type SessionRowSqlDatabase,
  type SessionRowSqlStatement,
} from './session-row-sql'
import { prepareThreadLinksWriteSet } from './thread-links-write-set'
import { loadSqlThreadLinks, loadSqlMessageLink } from './session-row-relations-sql'
import { ThreadLinksCache } from './thread-links-cache'
import { rowExtra } from './session-row-projection-sql'

const MESSAGE_COLUMNS =
  'session_id,message_id,thread_id,parent_message_id,active_child_id,siblingOrder,kind,status,created_at,updated_at,branch_id,payload_id,payload_utf8_length,row_metadata_json,message_json'
const THREAD_COLUMNS =
  'session_id,thread_id,threadOrder,name,created_at,root_message_id,active_leaf_message_id,compaction_points_json,session_prompt_context_snapshot_json,session_record_json,commit_revision,projection_json'
function* slices(value: string) {
  for (let offset = 0; offset < value.length; ) {
    let end = Math.min(value.length, offset + 16384)
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--
    yield value.slice(offset, end)
    offset = end
  }
}

/** Preparation stages metadata alone; publication never copies an unchanged message_json. */
export async function applySqlLocalMutation(
  database: SessionRowSqlDatabase,
  diff: SessionRowsDiff,
  commit: SessionRowCommit,
  expectedRevision: number,
  readThread: (id: string) => Promise<ThreadRow | null>,
  bounded = true,
  cache = new ThreadLinksCache()
) {
  const sessionId = diff.sessionId
  const mutationId = uuid()
  const plan = await prepareThreadLinksWriteSet(
    {
      thread: readThread,
      message: (id) => loadSqlMessageLink(database, sessionId, id, bounded),
      threadIds: async () =>
        (
          await database.query<{ thread_id: string }>('SELECT thread_id FROM session_threads WHERE session_id=?', [
            sessionId,
          ])
        ).map((row) => row.thread_id),
      loadThreadLinks: (id) =>
        cache.get(sessionId, id, expectedRevision, () => loadSqlThreadLinks(database, sessionId, id, bounded)),
    },
    diff,
    commit
  )
  const pending: SessionRowSqlStatement[] = []
  async function flush() {
    if (pending.length) await database.executeBatch(pending.splice(0))
  }
  async function stage(statement: SessionRowSqlStatement) {
    pending.push(statement)
    if (pending.length >= 32) await flush()
  }
  const cleanup = [
    'session_row_local_metadata',
    'session_row_local_deletes',
    'session_messages_staging',
    'session_threads_staging',
    'session_row_staging_mutations',
  ].map((table) => ({ sql: `DELETE FROM ${table} WHERE mutation_id=?`, params: [mutationId] }))
  async function stagedRow(
    table: string,
    columns: string,
    params: readonly (string | number | null)[],
    identityColumn: string,
    identity: string
  ) {
    const values = params.map((value) => (typeof value === 'string' && value.length > 4096 ? '' : value))
    await stage({
      sql: `INSERT OR REPLACE INTO ${table}(mutation_id,${columns}) VALUES (${Array(values.length + 1)
        .fill('?')
        .join(',')})`,
      params: [mutationId, ...values],
    })
    const names = columns.split(',')
    for (const [i, value] of params.entries())
      if (typeof value === 'string' && value.length > 4096)
        for (const part of slices(value))
          await stage({
            sql: `UPDATE ${table} SET ${names[i]}=${names[i]}||? WHERE mutation_id=? AND session_id=? AND ${identityColumn}=?`,
            params: [part, mutationId, sessionId, identity],
          })
  }
  try {
    await stage({
      sql: 'INSERT INTO session_row_staging_mutations(mutation_id,created_at) VALUES (?,?)',
      params: [mutationId, Date.now()],
    })
    for (const [id, body] of plan.bodies) {
      const row = plan.metadata.get(id)!
      for (const statement of messageStatements({ ...row, message: body }))
        if (statement.kind === 'upsert-message')
          await stagedRow('session_messages_staging', MESSAGE_COLUMNS, statement.params, 'message_id', id)
    }
    const columns = [
      'thread_id',
      'parent_message_id',
      'active_child_id',
      'siblingOrder',
      'kind',
      'status',
      'created_at',
      'updated_at',
      'branch_id',
      'row_metadata_json',
    ]
    for (const [id, row] of plan.metadata) {
      if (plan.bodies.has(id)) continue
      const value = JSON.stringify({
        thread_id: row.threadId,
        parent_message_id: row.parentMessageId,
        active_child_id: row.activeChildId,
        siblingOrder: row.siblingOrder,
        kind: row.kind,
        status: row.status,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        branch_id: row.branchId,
        row_metadata_json: rowExtra(row),
      })
      await stage({
        sql: 'INSERT INTO session_row_local_metadata(mutation_id,message_id,value) VALUES (?,?,?)',
        params: [mutationId, id, ''],
      })
      for (const part of slices(value))
        await stage({
          sql: 'UPDATE session_row_local_metadata SET value=value||? WHERE mutation_id=? AND message_id=?',
          params: [part, mutationId, id],
        })
    }
    for (const thread of plan.threads.values())
      await stagedRow(
        'session_threads_staging',
        THREAD_COLUMNS,
        threadStatement(thread, commit).params,
        'thread_id',
        thread.threadId
      )
    for (const id of plan.deleted)
      await stage({
        sql: 'INSERT INTO session_row_local_deletes(mutation_id,session_id,message_id) VALUES (?,?,?)',
        params: [mutationId, sessionId, id],
      })
    await flush()
    const publish: SessionRowSqlStatement[] = []
    publish.push(
      {
        sql: 'DELETE FROM session_text_tokens WHERE session_id=? AND message_id IN(SELECT message_id FROM session_row_local_deletes WHERE mutation_id=? AND session_id=? UNION SELECT s.message_id FROM session_messages_staging s JOIN session_messages m ON m.session_id=s.session_id AND m.message_id=s.message_id WHERE s.mutation_id=? AND s.session_id=? AND s.payload_id<>m.payload_id)',
        params: [sessionId, mutationId, sessionId, mutationId, sessionId],
      },
      {
        sql: 'DELETE FROM session_messages WHERE session_id=? AND message_id IN(SELECT message_id FROM session_row_local_deletes WHERE mutation_id=? AND session_id=?)',
        params: [sessionId, mutationId, sessionId],
      },
      {
        sql: `INSERT OR REPLACE INTO session_messages(${MESSAGE_COLUMNS}) SELECT ${MESSAGE_COLUMNS} FROM session_messages_staging WHERE mutation_id=? AND session_id=?`,
        params: [mutationId, sessionId],
      },
      {
        sql: `UPDATE session_messages SET (${columns.join(',')})=(SELECT ${columns.map((column) => `json_extract(value,'$.${column}')`).join(',')} FROM session_row_local_metadata WHERE mutation_id=? AND message_id=session_messages.message_id) WHERE session_id=? AND EXISTS(SELECT 1 FROM session_row_local_metadata WHERE mutation_id=? AND message_id=session_messages.message_id)`,
        params: [mutationId, sessionId, mutationId],
      },
      {
        sql: `INSERT OR REPLACE INTO session_threads(${THREAD_COLUMNS}) SELECT ${THREAD_COLUMNS} FROM session_threads_staging WHERE mutation_id=? AND session_id=?`,
        params: [mutationId, sessionId],
      }
    )
    for (const id of diff.threads.delete)
      publish.push({ sql: 'DELETE FROM session_threads WHERE session_id=? AND thread_id=?', params: [sessionId, id] })
    if (diff.deleteArchivedThreads)
      publish.push({
        sql: 'DELETE FROM session_threads WHERE session_id=? AND thread_id<>?',
        params: [sessionId, commit.record.activeThreadId],
      })
    publish.push(...cleanup)
    await database.executeBatch(publish, {
      sessionId,
      mode: 'local-diff',
      expectedRevision,
      resultRevision: commit.revision,
    })
    cache.committed(sessionId, expectedRevision, commit.revision, plan.graphs)
    return plan.result
  } catch (error) {
    pending.length = 0
    try {
      await database.executeBatch(cleanup)
    } catch {}
    throw error
  }
}
