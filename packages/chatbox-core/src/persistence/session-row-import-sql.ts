import type { SessionRowCommit } from '../ports/session-row-store'
import {
  sessionImportCandidateId,
  type SessionRowImportWriter,
  type SessionRowImportIssueHandler,
  type SessionStoredRow,
} from '../ports/session-row-transfer'
import { deriveMessageFacts } from '../session/message-facts'
import type { MessageRow, MessageRowMetadata, ThreadRow } from '../session/session-tree/types'
import { prepareImportIndex, type SessionImportIndex } from './session-row-import-plan'
import { parseRowExtra, rowExtra } from './session-row-projection-sql'
import { queryRowMetadata } from './session-row-metadata-sql'
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

const SCHEMA = `CREATE TABLE IF NOT EXISTS session_row_imports (
 candidate_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, session_id TEXT NOT NULL,
 commit_json TEXT NOT NULL, expected_revision INTEGER,
 phase TEXT NOT NULL
);`
type Phase = 'collecting' | 'ready' | 'published'
interface Candidate {
  candidate_id: string
  session_id: string
  commit_json: string
  expected_revision: number | null
  phase: Phase
}
interface ImportState {
  version: number
  hadMessages?: boolean
}
interface ImportIndex extends SessionImportIndex {
  version: number
}
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
function readCandidate(candidate: Candidate): { commit: SessionRowCommit; state: ImportState } {
  const { importState, ...commit } = JSON.parse(candidate.commit_json) as SessionRowCommit & {
    importState?: ImportState
  }
  return { commit, state: importState ?? { version: 0 } }
}
function messageMeta(row: MessageRowMetadata, pathDepth: number | null = null) {
  return { value: row, pathDepth }
}

async function readIndex(
  db: SessionRowSqlDatabase,
  id: string,
  sessionId: string,
  version: number
): Promise<ImportIndex> {
  const index: ImportIndex = { version, threads: new Map(), messages: new Map() }
  let after = ''
  for (;;) {
    const rows = await queryRowMetadata<{ message_id: string; row_metadata_json: string }>(
      db,
      `SELECT thread_id AS message_id,json_object('threadOrder',threadOrder,'name',name,'createdAt',created_at,
        'rootMessageId',root_message_id,'activeLeafMessageId',active_leaf_message_id,
        'compactionPoints',json(compaction_points_json),
        'sessionPromptContextSnapshot',json(session_prompt_context_snapshot_json)) AS row_metadata_json
      FROM session_threads_staging WHERE mutation_id=? AND session_id=? AND thread_id>? ORDER BY thread_id LIMIT 128`,
      [id, sessionId, after],
      ['message_id', 'row_metadata_json'],
      db.maxStatementBytes !== undefined
    )
    for (const row of rows) {
      const extra = JSON.parse(row.row_metadata_json) as Omit<ThreadRow, 'sessionId' | 'threadId'>
      if (extra.sessionPromptContextSnapshot === null) delete extra.sessionPromptContextSnapshot
      index.threads.set(row.message_id, { sessionId, threadId: row.message_id, ...extra })
    }
    if (rows.length < 128) break
    after = rows[rows.length - 1].message_id
  }
  after = ''
  for (;;) {
    const columns = [
      'message_id',
      'thread_id',
      'parent_message_id',
      'active_child_id',
      'siblingOrder',
      'kind',
      'created_at',
      'updated_at',
      'branch_id',
      'row_metadata_json',
    ]
    const rows = await queryRowMetadata<{
      message_id: string
      thread_id: string
      parent_message_id: string | null
      active_child_id: string | null
      siblingOrder: number
      kind: MessageRow['kind']
      created_at: number
      updated_at: number
      branch_id: string | null
      row_metadata_json: string | null
    }>(
      db,
      `SELECT ${columns.join(',')} FROM session_messages_staging WHERE mutation_id=? AND session_id=? AND message_id>? ORDER BY message_id LIMIT 128`,
      [id, sessionId, after],
      columns,
      db.maxStatementBytes !== undefined
    )
    for (const row of rows)
      index.messages.set(
        row.message_id,
        messageMeta({
          sessionId,
          messageId: row.message_id,
          threadId: row.thread_id,
          parentMessageId: row.parent_message_id,
          activeChildId: row.active_child_id,
          siblingOrder: row.siblingOrder,
          kind: row.kind,
          status: 'settled',
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          branchId: row.branch_id,
          ...parseRowExtra(row.row_metadata_json),
        })
      )
    if (rows.length < 128) break
    after = rows[rows.length - 1].message_id
  }
  return index
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
  input: SessionRowCommit,
  expectedRevision: number | null,
  jobId: string
): Promise<SessionRowImportWriter> {
  const commit = { record: structuredClone(input.record), revision: input.revision }
  if (
    !jobId ||
    !commit.record.id ||
    !commit.record.activeThreadId ||
    commit.record.rowFormatVersion !== 3 ||
    !Number.isSafeInteger(commit.revision) ||
    (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) ||
    commit.revision !== (expectedRevision ?? 0) + 1
  )
    throw new Error('Invalid import candidate commit')
  await db.execute(SCHEMA)
  const id = sessionImportCandidateId(jobId, commit.record.id)
  await db.executeBatch([
    {
      sql: 'INSERT INTO session_row_imports(candidate_id,job_id,session_id,commit_json,expected_revision,phase) VALUES (?,?,?,?,?,?)',
      params: [id, jobId, commit.record.id, JSON.stringify(commit), expectedRevision, 'collecting'],
    },
  ])
  return resumeSqlImportWriter(db, id, true)
}

export async function resumeSqlImportWriter(
  db: SessionRowSqlDatabase,
  id: string,
  allowConvertedForks = false
): Promise<SessionRowImportWriter> {
  await db.execute(SCHEMA)
  const [initial] = await db.query<Candidate>('SELECT * FROM session_row_imports WHERE candidate_id=?', [id])
  if (!initial) throw new Error('Import candidate is missing')
  const decoded = readCandidate(initial),
    commit = decoded.commit,
    sessionId = initial.session_id
  let importState = decoded.state
  let index: ImportIndex | undefined = allowConvertedForks
    ? { version: importState.version, threads: new Map(), messages: new Map() }
    : undefined
  let rowsChanged = false
  let tail: Promise<void> = Promise.resolve()
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work).catch((error: unknown) => {
      index = undefined
      rowsChanged = true
      throw error
    })
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  const state = async () => {
    const [candidate] = await db.query<Candidate>('SELECT * FROM session_row_imports WHERE candidate_id=?', [id])
    if (!candidate) throw new Error('Import candidate is missing')
    const decoded = readCandidate(candidate)
    importState = decoded.state
    commit.record = decoded.commit.record
    commit.revision = decoded.commit.revision
    return candidate
  }
  const requireIndex = async () => {
    if (!index || index.version !== importState.version) {
      index = await readIndex(db, id, sessionId, importState.version)
      rowsChanged = true
    }
    return index
  }
  const controlStatement = (): SessionRowSqlStatement => ({
    sql: "UPDATE session_row_imports SET commit_json=json_set(commit_json,'$.importState',json(?),'$.record.activeThreadId',?) WHERE candidate_id=?",
    params: [JSON.stringify(importState), commit.record.activeThreadId, id],
  })
  // Leave room for the control write and native batch envelope.
  const batchLimit = Math.min(384 * 1024, db.maxStatementBytes ?? 384 * 1024)
  const batchWriter = () => {
    let statements: SessionRowSqlStatement[] = [],
      bytes = 0,
      slicedRows = 0
    const flush = async () => {
      if (!statements.length) return
      importState.version++
      // Invalidate other handles before any native sub-batch can commit.
      await db.executeBatch([controlStatement(), ...coalesceCandidateInserts(statements)])
      if (index) index.version = importState.version
      statements = []
      bytes = 0
    }
    const append = async (statement: SessionRowSqlStatement): Promise<void> => {
      const size = sizeOf(statement),
        available = batchLimit - sizeOf(controlStatement()) - 1024
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
      if ((await state()).phase !== 'collecting') throw new Error('Import candidate is closed')
      const current = await requireIndex(),
        writer = batchWriter()
      let incomplete: { kind: 'thread' | 'message'; id: string } | undefined
      try {
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
          incomplete = { kind: row.kind, id: rowId }
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
          incomplete = undefined
        }
        await writer.flush()
      } catch (error) {
        // A sliced row can span native transactions. Keep only complete rows on retry.
        if (incomplete)
          await db
            .executeBatch([
              {
                sql: `DELETE FROM session_${incomplete.kind}s_staging WHERE mutation_id=? AND session_id=? AND ${incomplete.kind}_id=?`,
                params: [id, sessionId, incomplete.id],
              },
            ])
            .catch(() => undefined)
        throw error
      }
    })
  }
  const candidateRows = (): SessionRowSqlStatement[] => [
    ...(['threads', 'messages'] as const).map((table) => ({
      sql: `DELETE FROM session_${table}_staging WHERE mutation_id=?`,
      params: [id],
    })),
    { sql: 'DELETE FROM session_row_local_metadata WHERE mutation_id=?', params: [id] },
  ]
  return {
    candidateId: id,
    commit,
    appendRows,
    appendThread: (thread: ThreadRow) => appendRows([{ kind: 'thread', thread }]),
    appendMessage: (message: MessageRow) => appendRows([{ kind: 'message', message }]),
    prepare: (onIssue, forks) =>
      enqueue(async () => {
        const candidate = await state()
        if (candidate.phase === 'published') return
        if (candidate.phase === 'ready') {
          const [counts] = await db.query<{ message_count: number; thread_count: number }>(
            `SELECT (SELECT COUNT(*) FROM session_messages_staging WHERE mutation_id=? AND session_id=?) message_count,
              (SELECT COUNT(*) FROM session_threads_staging WHERE mutation_id=? AND session_id=?) thread_count`,
            [id, sessionId, id, sessionId]
          )
          return {
            messageCount: counts.message_count,
            threadCount: counts.thread_count,
            skipSession: Boolean(importState.hadMessages) && counts.message_count === 0,
          }
        }
        if (candidate.phase !== 'collecting') throw new Error('Import candidate is closed')
        const current = await requireIndex()
        importState.hadMessages ||= current.messages.size > 0
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
          allowConvertedForks && !rowsChanged ? forks : undefined,
          { sqlite: true }
        )
        prepared.skipSession = Boolean(importState.hadMessages) && prepared.messageCount === 0
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
          const limit = batchLimit - sizeOf(controlStatement()) - 1024
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
        await writer.append({ sql: "UPDATE session_row_imports SET phase='ready' WHERE candidate_id=?", params: [id] })
        await writer.flush()
        return prepared
      }),
    publish: () =>
      enqueue(async () => {
        const current = await state()
        if (current.phase === 'published') {
          index = undefined
          return
        }
        if (current.phase !== 'ready') throw new Error('Import candidate is not prepared')
        try {
          await db.executeBatch(
            [
              ...(['threads', 'messages'] as const).flatMap((table) => [
                { sql: `DELETE FROM session_${table} WHERE session_id=?`, params: [sessionId] },
                {
                  sql: `INSERT INTO session_${table}(${transferColumns[table]}) SELECT ${transferColumns[table]} FROM session_${table}_staging WHERE mutation_id=? AND session_id=?`,
                  params: [id, sessionId],
                },
              ]),
              {
                sql: 'INSERT OR REPLACE INTO session_row_heads(session_id,revision,mutation_id) VALUES (?,?,?)',
                params: [sessionId, commit.revision, id],
              },
              ...candidateRows(),
              { sql: "UPDATE session_row_imports SET phase='published' WHERE candidate_id=?", params: [id] },
            ],
            { sessionId, mode: 'local-diff', expectedRevision: current.expected_revision }
          )
        } catch (error) {
          const committed = await state().catch(() => null)
          if (committed?.phase !== 'published') throw error
        }
        index = undefined
      }),
    dispose: () =>
      enqueue(async () => {
        await db.executeBatch([
          ...candidateRows(),
          { sql: 'DELETE FROM session_row_imports WHERE candidate_id=?', params: [id] },
        ])
        index = undefined
      }),
  }
}
