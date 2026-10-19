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
  seq: number
  kind: MessageRowMetadata['kind']
  status: MessageRowMetadata['status']
  created_at: number
  updated_at: number
  branch_id: string | null
  row_metadata_json: string | null
}
const COLUMNS =
  'session_id,message_id,thread_id,parent_message_id,active_child_id,seq,kind,status,created_at,updated_at,branch_id,row_metadata_json'
function metadata(row: RelationRecord): MessageRowMetadata {
  return {
    sessionId: row.session_id,
    messageId: row.message_id,
    threadId: row.thread_id,
    parentMessageId: row.parent_message_id,
    activeChildId: row.active_child_id,
    seq: Number(row.seq),
    kind: row.kind,
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    branchId: row.branch_id,
    ...parseRowExtra(row.row_metadata_json),
  }
}
export function sqlRelationReader(
  database: SessionRowSqlDatabase,
  sessionId: string,
  bounded = true
): SessionRelationReader {
  return {
    path: async (threadId, messageId, direction, limit) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 201) throw new Error('Invalid relationship path budget')
      const edge = direction === 'ancestors' ? 'parent_message_id' : 'active_child_id'
      const records = await queryRowMetadata<RelationRecord>(
        database,
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
        [sessionId, threadId, messageId, sessionId, threadId, limit, sessionId, threadId],
        COLUMNS.split(','),
        bounded
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
      const records = await queryRowMetadata<RelationRecord>(
        database,
        `SELECT ${COLUMNS} FROM session_messages WHERE status=? AND session_id=? AND thread_id=? AND message_id>? ORDER BY message_id LIMIT ?`,
        [options.status, sessionId, threadId, options.afterId ?? '', options.limit],
        COLUMNS.split(','),
        bounded
      )
      return records.map(metadata)
    },
    selectedFacts: async (threadId, options) => {
      const result: Array<{ row: MessageRowMetadata; depth: number }> = []
      let depth = options.afterDepth ?? -1
      while (result.length < options.limit) {
        const take = Math.min(201, options.limit - result.length)
        const page = await queryRowMetadata<RelationRecord & { selected_depth: number }>(
          database,
          `SELECT ${COLUMNS},selected_depth FROM session_messages WHERE session_id=? AND thread_id=? AND selected_depth>? AND json_extract(row_metadata_json,'$.facts.paused')=1 ORDER BY selected_depth LIMIT ?`,
          [sessionId, threadId, depth, take],
          [...COLUMNS.split(','), 'selected_depth'],
          bounded
        )
        result.push(...page.map((record) => ({ row: metadata(record), depth: Number(record.selected_depth) })))
        if (page.length < take) break
        depth = Number(page.at(-1)!.selected_depth)
      }
      return result
    },
    message: async (id) => {
      const [row] = await queryRowMetadata<RelationRecord>(
        database,
        `SELECT ${COLUMNS} FROM session_messages WHERE session_id=? AND message_id=?`,
        [sessionId, id],
        COLUMNS.split(','),
        bounded
      )
      return row ? metadata(row) : null
    },
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
          conditions.push(`(seq,message_id) ${selector.reverse ? '<' : '>'} (?,?)`)
          params.push(boundary.seq, boundary.messageId)
        }
        const take = Math.min(201, limit - result.length)
        params.push(take)
        const page = (
          await queryRowMetadata<RelationRecord>(
            database,
            `SELECT ${COLUMNS} FROM session_messages WHERE ${conditions.join(' AND ')} ORDER BY seq ${selector.reverse ? 'DESC' : 'ASC'},message_id ${selector.reverse ? 'DESC' : 'ASC'} LIMIT ?`,
            params,
            COLUMNS.split(','),
            bounded
          )
        ).map(metadata)
        result.push(...page)
        if (page.length < take) break
        const last = page.at(-1)!
        boundary = { seq: last.seq, messageId: last.messageId }
      }
      return result
    },
  }
}
