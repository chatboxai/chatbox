import type { SessionRowCommit } from '../ports/session-row-store'
import {
  sessionImportCandidateId,
  type SessionRowImportWriter,
  type SessionRowImportIssueHandler,
  type SessionRowImportPreparation,
  type SessionStoredRow,
} from '../ports/session-row-transfer'
import { deriveMessageFacts } from '../session/message-facts'
import type { MessageRow, MessageRowMetadata, SessionRecordV2, ThreadRow } from '../session/session-tree/types'
import { prepareImportIndex, type SessionImportIndex } from './session-row-import-plan'
import { rowExtra } from './session-row-projection-sql'
import {
  messageStatements,
  type SessionRowSqlDatabase,
  type SessionRowSqlStatement,
  type SessionRowSqlBindValue,
  threadStatement,
  validateMessageRow,
  validateThreadRow,
} from './session-row-sql'
import { stageSqlRow, transferColumns } from './session-row-transfer-sql'
import { sqlTextSlices } from './session-row-sql-text'

type Phase = 'collecting' | 'ready' | 'published' | 'failed' | 'disposed'
type ImportIndex = SessionImportIndex
const encoder = new TextEncoder()
const sizeOf = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength
const stageInsert = (
  id: string,
  table: 'threads' | 'messages',
  statement: SessionRowSqlStatement
): SessionRowSqlStatement => ({
  sql: `INSERT INTO session_${table}_staging(mutation_id,${transferColumns[table]}) VALUES (${Array(
    statement.params.length + 1
  )
    .fill('?')
    .join(',')})`,
  params: [id, ...statement.params],
})
function candidateRows(id: string): SessionRowSqlStatement[] {
  return [
    ...(['threads', 'messages'] as const).map((table) => ({
      sql: `DELETE FROM session_${table}_staging WHERE mutation_id=?`,
      params: [id],
    })),
    { sql: 'DELETE FROM session_row_local_metadata WHERE mutation_id=?', params: [id] },
  ]
}
export async function disposeSqlImportRows(db: SessionRowSqlDatabase, id: string): Promise<void> {
  await db.executeBatch(candidateRows(id))
}
function messageMeta(row: MessageRowMetadata, pathDepth: number | null = null) {
  return { value: row, pathDepth }
}

/** Group independent candidate inserts within each bounded native batch. */
function coalesceCandidateInserts(statements: SessionRowSqlStatement[]): SessionRowSqlStatement[] {
  const result: SessionRowSqlStatement[] = []
  const groups = new Map<string, SessionRowSqlStatement[]>()
  const flush = () => {
    for (const [sql, rows] of groups) {
      const width = rows[0].params.length
      const limit = Math.max(1, Math.floor(900 / width))
      const values = sql.indexOf(' VALUES ')
      for (let offset = 0; offset < rows.length; offset += limit) {
        const batch = rows.slice(offset, offset + limit)
        result.push({
          sql: `${sql.slice(0, values)} VALUES ${batch.map(() => sql.slice(values + 8)).join(',')}`,
          params: batch.flatMap((row) => row.params),
        })
      }
    }
    groups.clear()
  }
  for (const statement of statements) {
    if (
      /^INSERT(?: OR REPLACE)? INTO session_(?:messages|threads)_staging\s*\(.+\) VALUES \([?, ]+\)$/.test(
        statement.sql
      )
    ) {
      const rows = groups.get(statement.sql)
      if (rows) rows.push(statement)
      else groups.set(statement.sql, [statement])
    } else {
      flush()
      result.push(statement)
    }
  }
  flush()
  return result
}

export async function createSqlImportWriter(
  db: SessionRowSqlDatabase,
  input: SessionRecordV2,
  jobId: string
): Promise<SessionRowImportWriter> {
  const record = structuredClone(input)
  if (!jobId || !record.id || !record.activeThreadId || record.rowFormatVersion !== 3)
    throw new Error('Invalid import candidate record')
  const id = sessionImportCandidateId(jobId, record.id)
  const commit: SessionRowCommit = { record, revision: 1 }
  const sessionId = record.id
  let phase: Phase = 'collecting'
  let preparation: SessionRowImportPreparation | undefined
  let index: ImportIndex | undefined = { threads: new Map(), messages: new Map() }
  let rowsChanged = false
  let tail: Promise<void> = Promise.resolve()
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work).catch((error: unknown) => {
      index = undefined
      phase = 'failed'
      preparation = undefined
      throw error
    })
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  const state = () => {
    if (phase === 'failed' || phase === 'disposed') throw new Error('Import candidate is closed')
    return phase
  }
  const requireIndex = () => {
    if (!index) throw new Error('Import candidate is closed')
    return index
  }
  // Keep native batches within the transport envelope.
  const batchLimit = Math.min(384 * 1024, db.maxStatementBytes ?? 384 * 1024)
  const batchWriter = () => {
    const available = batchLimit - 1024
    let statements: SessionRowSqlStatement[] = [],
      bytes = 0,
      slicedRows = 0
    const flush = async () => {
      if (!statements.length) return
      await db.executeBatch(coalesceCandidateInserts(statements))
      statements = []
      bytes = 0
    }
    const append = async (statement: SessionRowSqlStatement): Promise<void> => {
      const size = sizeOf(statement)
      if (size > available) {
        const table = statement.sql.startsWith('INSERT INTO session_messages_staging(')
          ? 'messages'
          : statement.sql.startsWith('INSERT INTO session_threads_staging(')
            ? 'threads'
            : null
        if (!table) throw new Error('Import statement exceeds the storage transport limit')
        const parts = [...stageSqlRow(id, table, { ...statement, params: statement.params.slice(1) })]
        if (parts.length === 1) throw new Error('Import statement exceeds the storage transport limit')
        slicedRows++
        for (const part of parts) await append(part)
        return
      }
      if (statements.length && (statements.length >= 127 || bytes + size > available)) await flush()
      statements.push(statement)
      bytes += size
    }
    return {
      append,
      flush,
      get slicedRows() {
        return slicedRows
      },
    }
  }
  const appendRows = (input: readonly SessionStoredRow[], onIssue?: SessionRowImportIssueHandler) => {
    const rows = structuredClone(input)
    return enqueue(async () => {
      if (state() !== 'collecting') throw new Error('Import candidate is closed')
      const current = requireIndex(),
        writer = batchWriter()
      for (const row of rows) {
        const rowId = row.kind === 'thread' ? row.thread.threadId : row.message.messageId
        const report = (reason: string) => {
          rowsChanged = true
          onIssue?.({ action: 'skipped', entity: row.kind, id: rowId, reason })
        }
        if ((row.kind === 'thread' ? current.threads : current.messages).has(rowId)) {
          report('duplicate-row')
          continue
        }
        if (row.kind === 'message' && !current.threads.has(row.message.threadId)) {
          report('missing-thread')
          continue
        }
        try {
          if (row.kind === 'thread') {
            validateThreadRow(row.thread, sessionId)
            if (!Number.isSafeInteger(row.thread.threadOrder) || row.thread.threadOrder < -1)
              throw new Error('Invalid thread order')
          } else {
            validateMessageRow(row.message, sessionId)
            if (
              row.message.message.id !== row.message.messageId ||
              !Number.isSafeInteger(row.message.siblingOrder) ||
              row.message.siblingOrder < 0
            )
              throw new Error('Invalid message identity or order')
          }
        } catch {
          report('invalid-row')
          continue
        }
        const slicesBefore = writer.slicedRows
        if (row.kind === 'thread') {
          const thread = { ...row.thread, activeLeafMessageId: null, summary: undefined, control: undefined }
          await writer.append(stageInsert(id, 'threads', threadStatement(thread, commit)))
          current.threads.set(rowId, thread)
        } else {
          const normalized = {
            ...row.message,
            status: 'settled' as const,
            selected: false,
            fork: undefined,
            facts: deriveMessageFacts(row.message.message),
          }
          for (const statement of messageStatements(normalized))
            await writer.append(
              statement.kind === 'upsert-message' ? stageInsert(id, 'messages', statement) : statement
            )
          const { message: _body, ...metadata } = normalized
          current.messages.set(rowId, messageMeta(metadata))
        }
        if (writer.slicedRows !== slicesBefore) await writer.flush()
      }
      await writer.flush()
    })
  }
  return {
    candidateId: id,
    record: commit.record,
    appendRows,
    appendThread: (thread: ThreadRow) => appendRows([{ kind: 'thread', thread }]),
    appendMessage: (message: MessageRow) => appendRows([{ kind: 'message', message }]),
    prepare: (onIssue, forks) =>
      enqueue(async () => {
        const currentPhase = state()
        if (currentPhase === 'published') return
        if (currentPhase === 'ready') return preparation
        if (currentPhase !== 'collecting') throw new Error('Import candidate is closed')
        const current = requireIndex()
        const hadMessages = current.messages.size > 0
        const before = new Map(
          [...current.messages].map(([messageId, entry]) => [
            messageId,
            JSON.stringify([entry.value.siblingOrder, entry.value.activeChildId, rowExtra(entry.value)]),
          ])
        )
        const oldThreads = new Set(current.threads.keys())
        for (const entry of current.messages.values()) {
          entry.value.selected = false
          entry.value.fork = undefined
          entry.pathDepth = null
        }
        const prepared = prepareImportIndex(
          current,
          commit,
          (issue) => {
            rowsChanged = true
            onIssue?.(issue)
          },
          !rowsChanged ? forks : undefined,
          { sqlite: true }
        )
        prepared.skipSession = hadMessages && prepared.messageCount === 0
        const writer = batchWriter()
        const removed = [...before.keys()].filter((messageId) => !current.messages.has(messageId))
        for (let offset = 0; offset < removed.length; offset += 128) {
          const page = removed.slice(offset, offset + 128)
          await writer.append({
            sql: `DELETE FROM session_messages_staging WHERE mutation_id=? AND session_id=? AND message_id IN (${page.map(() => '?').join(',')})`,
            params: [id, sessionId, ...page],
          })
        }
        const updateText = async (table: 'threads' | 'messages', rowId: string, column: string, value: string) => {
          const key = `${table}:${rowId}:${column}`
          await writer.append({
            sql: 'INSERT OR REPLACE INTO session_row_local_metadata(mutation_id,message_id,value) VALUES (?,?,?)',
            params: [id, key, ''],
          })
          for (const part of sqlTextSlices(value))
            await writer.append({
              sql: 'UPDATE session_row_local_metadata SET value=value||? WHERE mutation_id=? AND message_id=?',
              params: [part, id, key],
            })
          await writer.append({
            sql: `UPDATE session_${table}_staging SET ${column}=(SELECT value FROM session_row_local_metadata WHERE mutation_id=? AND message_id=?) WHERE mutation_id=? AND session_id=? AND ${table === 'threads' ? 'thread_id' : 'message_id'}=?`,
            params: [id, key, id, sessionId, rowId],
          })
          await writer.append({
            sql: 'DELETE FROM session_row_local_metadata WHERE mutation_id=? AND message_id=?',
            params: [id, key],
          })
        }
        for (const thread of current.threads.values()) {
          if (!oldThreads.has(thread.threadId)) {
            await writer.append(stageInsert(id, 'threads', threadStatement(thread, commit)))
            continue
          }
          const statement = threadStatement(thread, commit)
          const columns = [
            'threadOrder',
            'name',
            'root_message_id',
            'active_leaf_message_id',
            'compaction_points_json',
            'session_record_json',
            'commit_revision',
            'projection_json',
          ]
          const values = [2, 3, 5, 6, 7, 9, 10, 11].map((position) => statement.params[position])
          const small = columns
            .map((column, i) => ({ column, value: values[i] }))
            .filter(({ value }) => typeof value !== 'string' || sizeOf(value) <= 32 * 1024)
          await writer.append({
            sql: `UPDATE session_threads_staging SET ${small.map(({ column }) => `${column}=?`).join(',')} WHERE mutation_id=? AND session_id=? AND thread_id=?`,
            params: [...small.map(({ value }) => value), id, sessionId, thread.threadId],
          })
          for (const [position, column] of columns.entries()) {
            const value = values[position]
            if (typeof value === 'string' && sizeOf(value) > 32 * 1024)
              await updateText('threads', thread.threadId, column, value)
          }
        }
        let updates: SessionRowSqlBindValue[][] = [],
          updateBytes = 0
        const makeUpdate = (rows: SessionRowSqlBindValue[][]): SessionRowSqlStatement => ({
          sql: `WITH updates(message_id,siblingOrder,active_child_id,row_metadata_json) AS (VALUES ${rows.map(() => '(?,?,?,?)').join(',')}) UPDATE session_messages_staging SET (siblingOrder,active_child_id,row_metadata_json)=(SELECT siblingOrder,active_child_id,row_metadata_json FROM updates WHERE updates.message_id=session_messages_staging.message_id) WHERE mutation_id=? AND session_id=? AND message_id IN(SELECT message_id FROM updates)`,
          params: [...rows.flat(), id, sessionId],
        })
        const flushUpdates = async () => {
          if (updates.length) {
            await writer.append(makeUpdate(updates))
            updates = []
            updateBytes = 0
          }
        }
        const updateEnvelope = sizeOf(makeUpdate([]))
        for (const [messageId, entry] of current.messages) {
          const extra = rowExtra(entry.value)
          if (before.get(messageId) === JSON.stringify([entry.value.siblingOrder, entry.value.activeChildId, extra]))
            continue
          const values = [messageId, entry.value.siblingOrder, entry.value.activeChildId, extra]
          const limit = batchLimit - 1024
          const rowBytes = sizeOf(values) + 16
          if (updateEnvelope + rowBytes > limit) {
            await flushUpdates()
            await writer.append({
              sql: 'UPDATE session_messages_staging SET siblingOrder=?,active_child_id=? WHERE mutation_id=? AND session_id=? AND message_id=?',
              params: [entry.value.siblingOrder, entry.value.activeChildId, id, sessionId, messageId],
            })
            await updateText('messages', messageId, 'row_metadata_json', extra!)
          } else {
            if (updates.length && (updates.length >= 128 || updateEnvelope + updateBytes + rowBytes > limit))
              await flushUpdates()
            updates.push(values)
            updateBytes += rowBytes
          }
        }
        await flushUpdates()
        await writer.flush()
        phase = 'ready'
        preparation = prepared
        return prepared
      }),
    publish: () =>
      enqueue(async () => {
        const currentPhase = state()
        if (currentPhase === 'published') {
          index = undefined
          return
        }
        if (currentPhase !== 'ready') throw new Error('Import candidate is not prepared')
        try {
          await db.executeBatch(
            [
              {
                sql: "INSERT INTO session_row_revision_guard(value) SELECT 1 FROM session_row_heads WHERE session_id=? AND (revision>=? OR revision<1 OR typeof(revision)<>'integer')",
                params: [sessionId, Number.MAX_SAFE_INTEGER],
              },
              {
                sql: 'INSERT INTO session_row_heads(session_id,revision,mutation_id) VALUES (?,1,?) ON CONFLICT(session_id) DO UPDATE SET revision=session_row_heads.revision+1,mutation_id=excluded.mutation_id',
                params: [sessionId, id],
              },
              ...(['threads', 'messages'] as const).flatMap((table) => [
                { sql: `DELETE FROM session_${table} WHERE session_id=?`, params: [sessionId] },
                {
                  sql: `INSERT INTO session_${table}(${transferColumns[table]}) SELECT ${transferColumns[table]} FROM session_${table}_staging WHERE mutation_id=? AND session_id=?`,
                  params: [id, sessionId],
                },
              ]),
              {
                sql: 'UPDATE session_threads SET commit_revision=(SELECT revision FROM session_row_heads WHERE session_id=?) WHERE session_id=? AND threadOrder=-1',
                params: [sessionId, sessionId],
              },
              ...candidateRows(id),
            ],
            { sessionId, mode: 'local-diff' }
          )
        } catch (error) {
          const receipt = await db
            .query<{ mutation_id: string }>('SELECT mutation_id FROM session_row_heads WHERE session_id=?', [sessionId])
            .then((rows) => rows[0])
            .catch(() => undefined)
          if (receipt?.mutation_id !== id) throw error
        }
        phase = 'published'
        index = undefined
      }),
    dispose: () =>
      enqueue(async () => {
        if (phase === 'disposed') return
        if (phase !== 'published') await disposeSqlImportRows(db, id)
        phase = 'disposed'
        index = undefined
      }),
  }
}
