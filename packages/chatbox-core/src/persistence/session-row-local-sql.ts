import { queryRowMetadata } from './session-row-metadata-sql'
import type { SessionRowCommit, SessionRowsDiff, SessionRowMutationResult } from '../ports/session-row-store'
import type { ThreadRow } from '../session/session-tree/types'
import { applyLocalRowMutation, type LocalRowMutationAccess, type ProjectedMessage } from './session-row-local-mutation'
import { parseRowExtra, rowExtra } from './session-row-projection-sql'
import {
  messageStatements,
  threadStatement,
  type SessionRowSqlDatabase,
  type SessionRowSqlBindValue,
  type SessionRowSqlStatement,
} from './session-row-sql'

const COLUMNS =
  'session_id,message_id,thread_id,parent_message_id,active_child_id,seq,kind,status,created_at,updated_at,branch_id,payload_id,payload_chunk_count,payload_utf8_length,row_metadata_json,selected_depth'
const THREAD_COLUMNS =
  'session_id,thread_id,seq,name,created_at,root_message_id,active_leaf_message_id,compaction_points_json,session_prompt_context_snapshot_json,session_record_json,commit_revision,projection_json'
interface Stored {
  session_id: string
  message_id: string
  thread_id: string
  parent_message_id: string | null
  active_child_id: string | null
  seq: number
  kind: ProjectedMessage['kind']
  status: ProjectedMessage['status']
  created_at: number
  updated_at: number
  branch_id: string | null
  payload_id: string
  payload_chunk_count: number
  payload_utf8_length: number
  row_metadata_json: string | null
  selected_depth: number | null
}
function row(record: Stored): ProjectedMessage {
  const extra = parseRowExtra(record.row_metadata_json)
  if (!extra.facts || extra.selected === undefined) throw new Error('Message projection is unavailable')
  return {
    sessionId: record.session_id,
    messageId: record.message_id,
    threadId: record.thread_id,
    parentMessageId: record.parent_message_id,
    activeChildId: record.active_child_id,
    seq: Number(record.seq),
    kind: record.kind,
    status: record.status,
    createdAt: Number(record.created_at),
    updatedAt: Number(record.updated_at),
    branchId: record.branch_id,
    ...extra,
    facts: extra.facts,
    selected: extra.selected,
    selectedDepth: record.selected_depth === null ? null : Number(record.selected_depth),
  }
}

function* textSlices(value: string): Generator<string> {
  for (let offset = 0; offset < value.length; ) {
    let end = Math.min(value.length, offset + 4096)
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--
    yield value.slice(offset, end)
    offset = end
  }
}

export async function applySqlLocalMutation(
  database: SessionRowSqlDatabase,
  diff: SessionRowsDiff,
  commit: SessionRowCommit,
  expectedRevision: number,
  readThread: (id: string) => Promise<ThreadRow | null>,
  bounded = true
): Promise<SessionRowMutationResult> {
  const mutationId =
    (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
    `local:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const sessionId = diff.sessionId
  const paramsBase: [string, string] = [mutationId, sessionId]
  const pending: SessionRowSqlStatement[] = []
  const currentCache = new Map<string, Stored | null>()
  const oldCache = new Map<string, Stored | null>()
  let flushing: Promise<void> | undefined
  async function flush() {
    if (flushing) await flushing
    if (!pending.length) return
    const batch = pending.splice(0)
    flushing = database.executeBatch(batch)
    try {
      await flushing
    } finally {
      flushing = undefined
    }
  }
  async function enqueue(statement: SessionRowSqlStatement) {
    pending.push(statement)
    if (pending.length >= 32) await flush()
  }
  const run = (sql: string, params: SessionRowSqlBindValue[] = []) => enqueue({ sql, params })
  function remember(cache: Map<string, Stored | null>, id: string, value: Stored | null) {
    cache.delete(id)
    cache.set(id, value)
    if (cache.size > 200) cache.delete(cache.keys().next().value!)
  }
  async function stage(params: SessionRowSqlBindValue[]) {
    const metadata = params[14]
    const stored = Object.fromEntries(
      COLUMNS.split(',').map((name, index) => [name, params[index]])
    ) as unknown as Stored
    remember(currentCache, stored.message_id, stored)
    const initial = [...params]
    if (typeof metadata === 'string' && metadata.length > 4096) initial[14] = null
    await run(
      `INSERT OR REPLACE INTO session_messages_staging(mutation_id,${COLUMNS}) VALUES (${Array(17).fill('?').join(',')})`,
      [mutationId, ...initial]
    )
    if (initial[14] !== metadata && typeof metadata === 'string') {
      await run('INSERT OR REPLACE INTO session_row_local_metadata(mutation_id,message_id,value) VALUES (?,?,?)', [
        mutationId,
        stored.message_id,
        '',
      ])
      for (const chunk of textSlices(metadata))
        await run('UPDATE session_row_local_metadata SET value=value||? WHERE mutation_id=? AND message_id=?', [
          chunk,
          mutationId,
          stored.message_id,
        ])
      await run(
        'UPDATE session_messages_staging SET row_metadata_json=(SELECT value FROM session_row_local_metadata WHERE mutation_id=? AND message_id=?) WHERE mutation_id=? AND session_id=? AND message_id=?',
        [mutationId, stored.message_id, mutationId, sessionId, stored.message_id]
      )
      await run('DELETE FROM session_row_local_metadata WHERE mutation_id=? AND message_id=?', [
        mutationId,
        stored.message_id,
      ])
    }
  }
  const live = `SELECT ${COLUMNS} FROM session_messages m WHERE m.session_id=? AND NOT EXISTS(SELECT 1 FROM session_messages_staging s WHERE s.mutation_id=? AND s.session_id=m.session_id AND s.message_id=m.message_id) AND NOT EXISTS(SELECT 1 FROM session_row_local_deletes d WHERE d.mutation_id=? AND d.session_id=m.session_id AND d.message_id=m.message_id)`
  const staged = `SELECT ${COLUMNS} FROM session_messages_staging WHERE mutation_id=? AND session_id=?`
  async function records(where: string, params: SessionRowSqlBindValue[], order = '', limit = 1, old = false) {
    const sql = old
      ? `SELECT ${COLUMNS} FROM session_messages WHERE session_id=? AND ${where} ${order} LIMIT ?`
      : `SELECT * FROM (${live} AND ${where} UNION ALL ${staged} AND ${where}) ${order} LIMIT ?`
    const result = await queryRowMetadata<Stored>(
      database,
      sql,
      old
        ? [sessionId, ...params, limit]
        : [sessionId, mutationId, mutationId, ...params, ...paramsBase, ...params, limit],
      COLUMNS.split(','),
      bounded
    )
    for (const item of result) remember(old ? oldCache : currentCache, item.message_id, item)
    return result
  }
  async function current(id: string, old = false) {
    const cache = old ? oldCache : currentCache
    if (cache.has(id)) return cache.get(id) ?? undefined
    return (await records('message_id=?', [id], '', 1, old))[0]
  }
  async function putMetadata(value: ProjectedMessage) {
    const old = await current(value.messageId)
    if (!old) throw new Error('Metadata payload is missing')
    await stage([
      sessionId,
      value.messageId,
      value.threadId,
      value.parentMessageId,
      value.activeChildId,
      value.seq,
      value.kind,
      value.status,
      value.createdAt,
      value.updatedAt,
      value.branchId,
      old.payload_id,
      old.payload_chunk_count,
      old.payload_utf8_length,
      rowExtra(value),
      value.selectedDepth,
    ])
  }
  const access: LocalRowMutationAccess = {
    oldMessage: async (id) => {
      const found = await current(id, true)
      return found ? row(found) : null
    },
    message: async (id) => {
      const found = await current(id)
      return found ? row(found) : null
    },
    oldThread: readThread,
    children: async (threadId, parentId, after, limit, old = false) => {
      if (!old) await flush()
      const where = ['thread_id=?', 'parent_message_id IS ?']
      const params: SessionRowSqlBindValue[] = [threadId, parentId]
      if (after) {
        where.push('(seq,message_id)>(?,?)')
        params.push(after.seq, after.messageId)
      }
      return (
        await records(where.join(' AND '), params, 'ORDER BY seq,message_id', Math.min(limit, bounded ? 4 : 50), old)
      ).map(row)
    },
    selected: async (threadId, options) => {
      if (!options.old) await flush()
      const where = ['thread_id=?', 'selected_depth IS NOT NULL']
      const params: SessionRowSqlBindValue[] = [threadId]
      if (options.afterDepth !== undefined) {
        where.push('selected_depth>?')
        params.push(options.afterDepth)
      }
      if (options.beforeDepth !== undefined) {
        where.push('selected_depth<?')
        params.push(options.beforeDepth)
      }
      if (options.role) {
        where.push("json_extract(row_metadata_json,'$.facts.role')=?")
        params.push(options.role)
      }
      if (options.namingRole) {
        where.push(
          "json_extract(row_metadata_json,'$.facts.autoTitleEligible')=1 AND json_extract(row_metadata_json,'$.facts.role')=?"
        )
        params.push(options.namingRole)
      }
      if (options.conversation)
        where.push(
          "(kind<>'summary' AND json_extract(row_metadata_json,'$.facts.role')<>'system' AND COALESCE(json_extract(row_metadata_json,'$.facts.isForkMarker'),0)=0)"
        )
      if (options.kind) {
        where.push('kind=?')
        params.push(options.kind)
      }
      return (
        await records(
          where.join(' AND '),
          params,
          `ORDER BY selected_depth ${options.reverse ? 'DESC' : 'ASC'}`,
          Math.min(options.limit, bounded ? 4 : 50),
          options.old
        )
      ).map(row)
    },
    childStats: async (threadId, parentId, boundary) => {
      await flush()
      const where = 'thread_id=? AND parent_message_id=?'
      const [result] = await database.query<{ count: number; before: number }>(
        `SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN (seq,message_id)<(?,?) THEN 1 ELSE 0 END),0) AS before FROM (${live} AND ${where} UNION ALL ${staged} AND ${where})`,
        [
          boundary?.seq ?? -1,
          boundary?.messageId ?? '',
          sessionId,
          mutationId,
          mutationId,
          threadId,
          parentId,
          ...paramsBase,
          threadId,
          parentId,
        ]
      )
      return { count: Number(result.count), before: Number(result.before) }
    },
    put: async (value, body) => {
      await run('DELETE FROM session_row_local_deletes WHERE mutation_id=? AND session_id=? AND message_id=?', [
        ...paramsBase,
        value.messageId,
      ])
      if (!body) {
        await putMetadata(value)
        return
      }
      let registered = false
      for (const statement of messageStatements({ ...value, message: body }, value.selectedDepth ?? undefined)) {
        if (!registered && statement.kind === 'insert-message-payload-chunk') {
          await run('INSERT INTO session_row_local_payloads(mutation_id,payload_id) VALUES (?,?)', [
            mutationId,
            statement.params[1],
          ])
          registered = true
        }
        if (statement.kind === 'upsert-message') await stage([...statement.params])
        else await enqueue(statement)
      }
    },
    remove: async (id) => {
      remember(currentCache, id, null)
      await run('INSERT OR IGNORE INTO session_row_local_deletes(mutation_id,session_id,message_id) VALUES (?,?,?)', [
        ...paramsBase,
        id,
      ])
      await run('DELETE FROM session_messages_staging WHERE mutation_id=? AND session_id=? AND message_id=?', [
        ...paramsBase,
        id,
      ])
    },
    putThread: async (thread) => {
      const statement = threadStatement(thread, commit)
      const params = [...statement.params]
      const columns = [
        [3, 'name'],
        [7, 'compaction_points_json'],
        [8, 'session_prompt_context_snapshot_json'],
        [9, 'session_record_json'],
        [11, 'projection_json'],
      ] as const
      for (const [index] of columns) if (typeof params[index] === 'string') params[index] = ''
      await run(
        `INSERT OR REPLACE INTO session_threads_staging(mutation_id,${THREAD_COLUMNS}) VALUES (${Array(13).fill('?').join(',')})`,
        [mutationId, ...params]
      )
      for (const [index, column] of columns) {
        const value = statement.params[index]
        if (typeof value !== 'string') continue
        for (const chunk of textSlices(value))
          await run(
            `UPDATE session_threads_staging SET ${column}=${column}||? WHERE mutation_id=? AND session_id=? AND thread_id=?`,
            [chunk, mutationId, sessionId, thread.threadId]
          )
      }
    },
    clearMessages: async (threadId) => {
      await flush()
      currentCache.clear()
      await run(
        `INSERT OR IGNORE INTO session_row_local_deletes(mutation_id,session_id,message_id) SELECT ?,session_id,message_id FROM session_messages WHERE session_id=?${threadId === undefined ? '' : ' AND thread_id=?'}`,
        threadId === undefined ? paramsBase : [...paramsBase, threadId]
      )
      await run(
        `DELETE FROM session_messages_staging WHERE mutation_id=? AND session_id=?${threadId === undefined ? '' : ' AND thread_id=?'}`,
        threadId === undefined ? paramsBase : [...paramsBase, threadId]
      )
      await flush()
    },
  }
  await run('INSERT INTO session_row_staging_mutations(mutation_id,created_at) VALUES (?,?)', [mutationId, Date.now()])
  const cleanup: SessionRowSqlStatement[] = [
    {
      sql: 'DELETE FROM session_message_payload_chunks WHERE payload_id IN(SELECT payload_id FROM session_row_local_payloads WHERE mutation_id=?) AND NOT EXISTS(SELECT 1 FROM session_messages m WHERE m.payload_id=session_message_payload_chunks.payload_id) AND NOT EXISTS(SELECT 1 FROM session_messages_staging s WHERE s.mutation_id<>? AND s.payload_id=session_message_payload_chunks.payload_id)',
      params: [mutationId, mutationId],
    },
    { sql: 'DELETE FROM session_row_local_metadata WHERE mutation_id=?', params: [mutationId] },
    { sql: 'DELETE FROM session_row_local_payloads WHERE mutation_id=?', params: [mutationId] },
    { sql: 'DELETE FROM session_row_local_deletes WHERE mutation_id=?', params: [mutationId] },
    { sql: 'DELETE FROM session_messages_staging WHERE mutation_id=?', params: [mutationId] },
    { sql: 'DELETE FROM session_threads_staging WHERE mutation_id=?', params: [mutationId] },
    { sql: 'DELETE FROM session_row_staging_mutations WHERE mutation_id=?', params: [mutationId] },
  ]
  try {
    const result = await applyLocalRowMutation(access, diff, commit)
    await flush()
    const publish: SessionRowSqlStatement[] = [
      {
        sql: `DELETE FROM session_text_tokens WHERE session_id=? AND message_id IN(SELECT message_id FROM session_row_local_deletes WHERE mutation_id=? AND session_id=? UNION SELECT s.message_id FROM session_messages_staging s JOIN session_messages m ON m.session_id=s.session_id AND m.message_id=s.message_id WHERE s.mutation_id=? AND s.session_id=? AND s.payload_id<>m.payload_id)`,
        params: [sessionId, ...paramsBase, ...paramsBase],
      },
      {
        sql: `DELETE FROM session_message_payload_chunks WHERE payload_id IN(SELECT m.payload_id FROM session_messages m WHERE m.session_id=? AND m.message_id IN(SELECT message_id FROM session_row_local_deletes WHERE mutation_id=? AND session_id=? UNION SELECT s.message_id FROM session_messages_staging s JOIN session_messages previous ON previous.session_id=s.session_id AND previous.message_id=s.message_id WHERE s.mutation_id=? AND s.session_id=? AND s.payload_id<>previous.payload_id)) AND NOT EXISTS(SELECT 1 FROM session_messages_staging other WHERE other.mutation_id<>? AND other.payload_id=session_message_payload_chunks.payload_id)`,
        params: [sessionId, ...paramsBase, ...paramsBase, mutationId],
      },
      {
        sql: 'DELETE FROM session_messages WHERE session_id=? AND message_id IN(SELECT message_id FROM session_row_local_deletes WHERE mutation_id=? AND session_id=?)',
        params: [sessionId, ...paramsBase],
      },
      {
        sql: `INSERT OR REPLACE INTO session_messages(${COLUMNS}) SELECT ${COLUMNS} FROM session_messages_staging WHERE mutation_id=? AND session_id=?`,
        params: paramsBase,
      },
      {
        sql: `INSERT OR REPLACE INTO session_threads(${THREAD_COLUMNS}) SELECT ${THREAD_COLUMNS} FROM session_threads_staging WHERE mutation_id=? AND session_id=?`,
        params: paramsBase,
      },
      ...diff.threads.delete.map((id) => ({
        sql: 'DELETE FROM session_threads WHERE session_id=? AND thread_id=?',
        params: [sessionId, id],
      })),
      ...(diff.deleteArchivedThreads
        ? [
            {
              sql: 'DELETE FROM session_threads WHERE session_id=? AND thread_id<>?',
              params: [sessionId, commit.record.activeThreadId],
            },
          ]
        : []),
      ...cleanup,
    ]
    await database.executeBatch(publish, {
      sessionId,
      mode: 'local-diff',
      expectedRevision,
      resultRevision: commit.revision,
    })
    return result
  } catch (error) {
    pending.length = 0
    try {
      await database.executeBatch(cleanup)
    } catch {}
    throw error
  }
}
