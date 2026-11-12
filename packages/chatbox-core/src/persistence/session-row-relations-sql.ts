import { ThreadLinksBuilder, type ThreadLinks, type ThreadLink } from '../session/thread-links'
import { queryRowMetadata } from './session-row-metadata-sql'
import type { MessageRowMetadata } from '../session/session-tree/types'
import type { SessionRowSqlBindValue, SessionRowSqlDatabase } from './session-row-sql'
import type { SessionRelationReader } from './session-row-relations-read'
import { parseRowExtra } from './session-row-projection-sql'

interface RelationRecord {
  session_id: string
  message_id: string
  thread_id: string
  parent_message_id: string | null
  active_child_id: string | null
  siblingOrder: number
  kind: MessageRowMetadata['kind']
  status: MessageRowMetadata['status']
  created_at: number
  updated_at: number
  branch_id: string | null
  row_metadata_json: string | null
  on_path?: number
}
const COLUMNS =
  'session_id,message_id,thread_id,parent_message_id,active_child_id,siblingOrder,kind,status,created_at,updated_at,branch_id,row_metadata_json'
function metadata(row: RelationRecord): MessageRowMetadata {
  return {
    sessionId: row.session_id,
    messageId: row.message_id,
    threadId: row.thread_id,
    parentMessageId: row.parent_message_id,
    activeChildId: row.active_child_id,
    siblingOrder: Number(row.siblingOrder),
    kind: row.kind,
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    branchId: row.branch_id,
    ...parseRowExtra(row.row_metadata_json),
    selected: row.on_path === 1,
  }
}
export function sqlRelationReader(
  database: SessionRowSqlDatabase,
  sessionId: string,
  bounded = true,
  loadLinks?: (threadId: string) => Promise<ThreadLinks>
): SessionRelationReader {
  async function queryRelations(sql: string, params: SessionRowSqlBindValue[]): Promise<RelationRecord[]> {
    // Every row of a page shares one thread. Repeating its root on every row would shrink each byte-budgeted bridge response.
    const rows = await queryRowMetadata<RelationRecord & { active_root: string | null }>(
      database,
      `SELECT relation_page.*,CASE WHEN row_number() OVER()=1 THEN t.root_message_id END AS active_root FROM (${sql}) relation_page JOIN session_threads t ON t.session_id=? AND t.thread_id=relation_page.thread_id`,
      [...params, sessionId],
      [...COLUMNS.split(','), 'active_root'],
      bounded
    )
    if (!rows.length) return []
    if (!loadLinks) throw new Error('Thread links loader is required for relation pages')
    const graph = await loadLinks(rows[0].thread_id),
      selected = graph.membership(rows.find((row) => row.active_root !== null)?.active_root ?? null)
    return rows.map((row) => ({ ...row, on_path: Number(selected.has(row.message_id)) }))
  }

  async function selectedMessages(ids: readonly string[]): Promise<MessageRowMetadata[]> {
    if (!ids.length) return []
    const unique = [...new Set(ids)]
    const placeholders = unique.map(() => '?').join(',')
    const records = await queryRowMetadata<RelationRecord>(
      database,
      `WITH RECURSIVE path(message_id,thread_id) AS (
        SELECT root_message_id,thread_id FROM session_threads WHERE session_id=? AND root_message_id IS NOT NULL AND thread_id IN(SELECT thread_id FROM session_messages WHERE session_id=? AND message_id IN(${placeholders}))
        UNION SELECT m.active_child_id,m.thread_id FROM path p JOIN session_messages m ON m.session_id=? AND m.thread_id=p.thread_id AND m.message_id=p.message_id WHERE m.active_child_id IS NOT NULL
      ) SELECT ${COLUMNS.split(',')
        .map((column) => `m.${column}`)
        .join(
          ','
        )},(p.message_id IS NOT NULL) AS on_path FROM session_messages m LEFT JOIN path p ON p.thread_id=m.thread_id AND p.message_id=m.message_id WHERE m.session_id=? AND m.message_id IN(${placeholders})`,
      [sessionId, sessionId, ...unique, sessionId, sessionId, ...unique],
      [...COLUMNS.split(','), 'on_path'],
      bounded
    )
    return records.map(metadata)
  }
  return {
    path: async (threadId, messageId, direction, limit) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 201) throw new Error('Invalid relationship path budget')
      const edge = direction === 'ancestors' ? 'parent_message_id' : 'active_child_id'
      const records = await queryRelations(
        `WITH RECURSIVE path(message_id,depth) AS (
          SELECT message_id,0 FROM session_messages WHERE session_id=? AND thread_id=? AND message_id=?
          UNION ALL
          SELECT m.${edge},path.depth+1 FROM path CROSS JOIN session_messages m ON m.session_id=? AND m.thread_id=? AND m.message_id=path.message_id
          WHERE m.${edge} IS NOT NULL AND path.depth+1<?
        ) SELECT ${COLUMNS.split(',')
          .map((column) => `m.${column}`)
          .join(
            ','
          )} FROM path CROSS JOIN session_messages m ON m.session_id=? AND m.thread_id=? AND m.message_id=path.message_id ORDER BY path.depth`,
        [sessionId, threadId, messageId, sessionId, threadId, limit, sessionId, threadId]
      )
      const rows = records.map(metadata)
      const last = rows.at(-1)
      if (
        rows.length < limit &&
        last &&
        (direction === 'ancestors' ? last.parentMessageId : last.activeChildId) !== null
      )
        throw new Error('Relationship path contains a missing message')
      return rows
    },
    status: async (threadId, options) => {
      const records = await queryRelations(
        `SELECT ${COLUMNS} FROM session_messages WHERE status=? AND session_id=? AND thread_id=? AND message_id>? ORDER BY message_id LIMIT ?`,
        [options.status, sessionId, threadId, options.afterId ?? '', options.limit]
      )
      return records.map(metadata)
    },
    selectedFacts: async (threadId, options) => {
      const records = await queryRowMetadata<RelationRecord & { path_depth: number }>(
        database,
        `WITH RECURSIVE path(message_id,depth) AS (
          SELECT root_message_id,0 FROM session_threads WHERE session_id=? AND thread_id=? AND root_message_id IS NOT NULL
          UNION ALL SELECT m.active_child_id,p.depth+1 FROM path p JOIN session_messages m ON m.session_id=? AND m.thread_id=? AND m.message_id=p.message_id WHERE m.active_child_id IS NOT NULL LIMIT (SELECT COUNT(*)+1 FROM session_messages WHERE session_id=? AND thread_id=?)
        ) SELECT ${COLUMNS.split(',')
          .map((column) => `m.${column}`)
          .join(
            ','
          )},p.depth AS path_depth FROM path p JOIN session_messages m ON m.session_id=? AND m.thread_id=? AND m.message_id=p.message_id
        WHERE p.depth>? AND json_extract(m.row_metadata_json,'$.facts.paused')=1 ORDER BY p.depth LIMIT ?`,
        [
          sessionId,
          threadId,
          sessionId,
          threadId,
          sessionId,
          threadId,
          sessionId,
          threadId,
          options.afterDepth ?? -1,
          options.limit,
        ],
        [...COLUMNS.split(','), 'path_depth'],
        bounded
      )
      return records.map((record) => ({
        row: { ...metadata(record), selected: true },
        depth: Number(record.path_depth),
      }))
    },
    messages: selectedMessages,
    message: async (id) => (await selectedMessages([id]))[0] ?? null,
    children: async (threadId, selector, limit) => {
      const result: MessageRowMetadata[] = []
      let boundary = selector.boundary
      while (result.length < limit) {
        const params: SessionRowSqlBindValue[] = [sessionId, threadId, selector.parentMessageId]
        const conditions = ['session_id=?', 'thread_id=?', 'parent_message_id IS ?']
        if (selector.branchId !== undefined) {
          conditions.push('branch_id=?')
          params.push(selector.branchId)
        }
        if (boundary) {
          conditions.push(`(siblingOrder,message_id) ${selector.reverse ? '<' : '>'} (?,?)`)
          params.push(boundary.siblingOrder, boundary.messageId)
        }
        const take = Math.min(201, limit - result.length)
        params.push(take)
        const page = (
          await queryRelations(
            `SELECT ${COLUMNS} FROM session_messages WHERE ${conditions.join(' AND ')} ORDER BY siblingOrder ${selector.reverse ? 'DESC' : 'ASC'},message_id ${selector.reverse ? 'DESC' : 'ASC'} LIMIT ?`,
            params
          )
        ).map(metadata)
        result.push(...page)
        if (page.length < take) break
        const last = page.at(-1)!
        boundary = { siblingOrder: last.siblingOrder, messageId: last.messageId }
      }
      return result
    },
  }
}

export async function loadSqlThreadLinks(
  database: SessionRowSqlDatabase,
  sessionId: string,
  threadId: string,
  bounded = true,
  afterBatch?: () => Promise<void>
) {
  const builder = new ThreadLinksBuilder(threadId)
  // Bridge responses split each query by bytes, re-running it per split; short pages keep that linear.
  const page = bounded ? 200 : 2000
  let after = ''
  for (let read = 0; ; ) {
    const records = await queryRowMetadata<RelationRecord>(
      database,
      `SELECT ${COLUMNS} FROM session_messages WHERE session_id=? AND thread_id=? AND message_id>? ORDER BY message_id LIMIT ${page}`,
      [sessionId, threadId, after],
      COLUMNS.split(','),
      bounded
    )
    builder.append(records.map(toLink))
    read += records.length
    if (records.length < page) {
      await afterBatch?.()
      return builder.finish()
    }
    if (read % 2000 === 0) await afterBatch?.()
    after = records.at(-1)!.message_id
  }
}

/** Point reads for private mutation preparation need facts and edges only. */
export async function loadSqlMessageLink(
  database: SessionRowSqlDatabase,
  sessionId: string,
  messageId: string,
  bounded = true
) {
  const records = await queryRowMetadata<RelationRecord>(
    database,
    `SELECT ${COLUMNS} FROM session_messages WHERE session_id=? AND message_id=?`,
    [sessionId, messageId],
    COLUMNS.split(','),
    bounded
  )
  return records[0] ? toLink(records[0]) : null
}

function toLink(record: RelationRecord): ThreadLink {
  const { selected, ...row } = metadata(record)
  if (!row.facts) throw new Error('Message facts are unavailable')
  return { ...row, facts: row.facts }
}
