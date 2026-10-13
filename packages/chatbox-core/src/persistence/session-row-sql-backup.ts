import { v4 as uuid } from 'uuid'
import { throwIfAborted } from '../backup/abort'
import type { BackupRow, BackupSessionCandidate } from '../backup/session-port'
import { type SessionRowCommit, SessionRowConflictError } from '../ports/session-row-store'
import type { MessageRow, ThreadRow } from '../session/session-tree/types'
import type { SessionRowSqlDatabase, SessionRowSqlStatement } from './session-row-sql'

const STAGING_BATCH_STATEMENTS = 128
const STAGING_BATCH_BYTES = 384 * 1024
const encoder = new TextEncoder()

const columns = {
  threads:
    'session_id, thread_id, seq, name, created_at, root_message_id, active_leaf_message_id, compaction_points_json, session_prompt_context_snapshot_json, session_record_json, commit_revision',
  messages:
    'session_id, message_id, thread_id, parent_message_id, active_child_id, seq, kind, status, created_at, updated_at, branch_id, payload_id, payload_chunk_count, payload_utf8_length',
}

/** Candidates share the native staging tables; only the final small SQL batch publishes rows. */
export async function createSqlBackupCandidate(
  database: SessionRowSqlDatabase,
  sessionId: string,
  codec: {
    thread(row: ThreadRow, commit?: SessionRowCommit): SessionRowSqlStatement
    message(row: MessageRow): Iterable<SessionRowSqlStatement>
  },
  createId: () => string = uuid
): Promise<BackupSessionCandidate> {
  const mutation = createId()
  const previous = createId()
  const heads = await database.query<{ revision: number | null }>(
    'SELECT revision FROM session_row_heads WHERE session_id = ?',
    [sessionId]
  )
  const expected = heads[0]?.revision ?? null
  const revision = (expected ?? 0) + 1
  if (!Number.isSafeInteger(revision)) throw new Error('Session revision exhausted')
  let commit: SessionRowCommit | undefined
  let published = false
  let disposed = false
  let buffered: SessionRowSqlStatement[] = []
  let bufferedBytes = 2
  let failure: { error: unknown } | undefined
  const discardBuffered = () => {
    buffered = []
    bufferedBytes = 2
  }
  const flush = async () => {
    if (failure) throw failure.error
    if (!buffered.length) return
    const statements = buffered
    discardBuffered()
    try {
      await database.executeBatch(statements)
    } catch (error) {
      failure = { error }
      throw error
    }
  }
  const stage = async (statements: Iterable<SessionRowSqlStatement>) => {
    if (failure) throw failure.error
    try {
      for (const statement of statements) {
        const bytes =
          encoder.encode(JSON.stringify({ statement: statement.sql, values: statement.params })).byteLength + 1
        if (
          buffered.length &&
          (buffered.length >= STAGING_BATCH_STATEMENTS || bufferedBytes + bytes > STAGING_BATCH_BYTES)
        )
          await flush()
        buffered.push(statement)
        bufferedBytes += bytes
        if (bufferedBytes >= STAGING_BATCH_BYTES || buffered.length >= STAGING_BATCH_STATEMENTS) await flush()
      }
    } catch (error) {
      discardBuffered()
      failure = { error }
      throw error
    }
  }
  let pending:
    | {
        id: string
        decoder: { decode(input?: Uint8Array, options?: { stream?: boolean }): string }
        count: number
        bytes: number
      }
    | undefined
  const payloadPrefix = `backup:${mutation}:`
  const guard = (value: number | null): SessionRowSqlStatement => ({
    sql:
      value === null
        ? 'INSERT INTO session_row_revision_guard (value) SELECT 1 WHERE EXISTS (SELECT 1 FROM session_row_heads WHERE session_id = ?)'
        : 'INSERT INTO session_row_revision_guard (value) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM session_row_heads WHERE session_id = ? AND revision = ?)',
    params: value === null ? [sessionId] : [sessionId, value],
  })
  const removeStaging = (id: string): SessionRowSqlStatement[] => [
    ...(['threads', 'messages'] as const).map((table) => ({
      sql: `DELETE FROM session_${table}_staging WHERE mutation_id = ? AND session_id = ?`,
      params: [id, sessionId],
    })),
    { sql: 'DELETE FROM session_row_staging_mutations WHERE mutation_id = ?', params: [id] },
  ]
  const replace = (id: string): SessionRowSqlStatement[] =>
    (['threads', 'messages'] as const).flatMap((table) => [
      { sql: `DELETE FROM session_${table} WHERE session_id = ?`, params: [sessionId] },
      {
        sql: `INSERT INTO session_${table} (${columns[table]}) SELECT ${columns[table]} FROM session_${table}_staging WHERE mutation_id = ? AND session_id = ?`,
        params: [id, sessionId],
      },
    ])
  await database.executeBatch(
    [mutation, previous].map((id) => ({
      sql: 'INSERT INTO session_row_staging_mutations (mutation_id, created_at) VALUES (?, ?)',
      params: [id, Date.now()],
    }))
  )
  return {
    flush,
    async appendPayload(bytes) {
      if (published || disposed || !commit) throw new Error('Backup candidate is closed')
      if (!bytes.length || bytes.length > 128 * 1024) throw new Error('Backup payload block exceeds budget')
      pending ??= {
        id: payloadPrefix + createId(),
        decoder: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }),
        count: 0,
        bytes: 0,
      }
      pending.bytes += bytes.length
      const text = pending.decoder.decode(bytes, { stream: true })
      const statements: SessionRowSqlStatement[] = []
      for (let offset = 0; offset < text.length; ) {
        let end = Math.min(offset + 16 * 1024, text.length)
        if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--
        statements.push({
          sql: 'INSERT INTO session_message_payload_chunks (session_id, payload_id, chunk_index, value) VALUES (?, ?, ?, ?)',
          params: [sessionId, pending.id, pending.count++, text.slice(offset, end)],
        })
        offset = end
      }
      await stage(statements)
    },
    async append(row: BackupRow) {
      if (published || disposed) throw new Error('Backup candidate is closed')
      if (row.kind === 'header') {
        if (commit || row.record.id !== sessionId) throw new Error('Invalid backup header')
        commit = { record: row.record, revision }
        return
      }
      if (!commit) throw new Error('Backup header must precede rows')
      if ((row.kind === 'thread' ? row.thread : row.message).sessionId !== sessionId)
        throw new Error('Backup row belongs to another session')
      if (row.kind === 'message' && row.payload) {
        if (!pending || pending.bytes !== row.payload.size || pending.decoder.decode())
          throw new Error('Backup payload is incomplete')
        const m = row.message
        await stage([
          {
            sql: `INSERT INTO session_messages_staging (mutation_id, ${columns.messages}) VALUES (${Array(15).fill('?').join(', ')})`,
            params: [
              mutation,
              sessionId,
              m.messageId,
              m.threadId,
              m.parentMessageId,
              m.activeChildId,
              m.seq,
              m.kind,
              m.status,
              m.createdAt,
              m.updatedAt,
              m.branchId,
              pending.id,
              pending.count,
              pending.bytes,
            ],
          },
        ])
        pending = undefined
        return
      }
      if (pending) throw new Error('Backup payload has no owning message')
      const statements = row.kind === 'thread' ? [codec.thread(row.thread, commit)] : codec.message(row.message)
      const staged = function* (): Generator<SessionRowSqlStatement> {
        for (const statement of statements) {
          if (statement.kind === 'upsert-thread' || statement.kind === 'upsert-message') {
            const table = statement.kind === 'upsert-thread' ? 'threads' : 'messages'
            yield {
              sql: `INSERT INTO session_${table}_staging (mutation_id, ${columns[table]}) VALUES (${Array(
                statement.params.length + 1
              )
                .fill('?')
                .join(', ')})`,
              params: [mutation, ...statement.params],
            }
          } else yield statement
        }
      }
      await stage(staged())
    },
    async publish(signal) {
      throwIfAborted(signal)
      if (!commit || published || disposed || pending) throw new Error('Backup candidate is not publishable')
      await flush()
      throwIfAborted(signal)
      const actual =
        (
          await database.query<{ revision: number | null }>(
            'SELECT revision FROM session_row_heads WHERE session_id = ?',
            [sessionId]
          )
        )[0]?.revision ?? null
      if (actual !== expected) throw new SessionRowConflictError(sessionId, expected, actual)
      throwIfAborted(signal)
      await database.executeBatch([
        guard(expected),
        ...(['threads', 'messages'] as const).map((table) => ({
          sql: `INSERT INTO session_${table}_staging (mutation_id, ${columns[table]}) SELECT ?, ${columns[table]} FROM session_${table} WHERE session_id = ?`,
          params: [previous, sessionId],
        })),
        ...replace(mutation),
        {
          sql: 'INSERT OR REPLACE INTO session_row_heads (session_id, revision, mutation_id) VALUES (?, ?, ?)',
          params: [sessionId, revision, mutation],
        },
      ])
      published = true
    },
    async rollback() {
      discardBuffered()
      if (!published) return
      await database.executeBatch([
        guard(revision),
        ...replace(previous),
        expected === null
          ? { sql: 'DELETE FROM session_row_heads WHERE session_id = ?', params: [sessionId] }
          : {
              sql: 'UPDATE session_row_heads SET revision = ?, mutation_id = ? WHERE session_id = ?',
              params: [expected, previous, sessionId],
            },
      ])
      published = false
    },
    async dispose() {
      discardBuffered()
      await database.executeBatch([
        ...removeStaging(mutation),
        ...removeStaging(previous),
        {
          sql: `DELETE FROM session_message_payload_chunks WHERE session_id = ?
          AND NOT EXISTS (SELECT 1 FROM session_messages WHERE session_messages.payload_id = session_message_payload_chunks.payload_id)
          AND NOT EXISTS (SELECT 1 FROM session_messages_staging WHERE session_messages_staging.payload_id = session_message_payload_chunks.payload_id)
          AND NOT EXISTS (SELECT 1 FROM session_row_staging_mutations WHERE session_message_payload_chunks.payload_id LIKE 'backup:' || mutation_id || ':%')`,
          params: [sessionId],
        },
      ])
      disposed = true
    },
  }
}
