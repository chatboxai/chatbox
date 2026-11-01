import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionStoredRow } from '../ports/session-row-transfer'
import { storageRowFixture } from '../ports/testing/session-row-fixtures'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { contextSnapshot } from './session-context-read.test-support'
import { SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const database of databases.splice(0)) database.close()
})

function setup(readByteBudget: 'bounded' | 'none' = 'bounded') {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  return { database, store: new SqlSessionRowStore(database, undefined, { readByteBudget }) }
}

function fixture() {
  return storageRowFixture(
    contextSnapshot({
      id: 'export-session',
      name: '会话😀'.repeat(1800),
      threadName: '线程😀'.repeat(500),
      messages: [
        { id: 'question', role: 'user', contentParts: [{ type: 'text', text: '完整正文😀\u0000'.repeat(35000) }] },
        { id: 'answer', role: 'assistant', contentParts: [{ type: 'text', text: 'reply' }] },
      ],
    })
  )
}

describe.each(['bounded', 'none'] as const)('SQL export reads (%s)', (readByteBudget) => {
  it('reads the header once and exports complete rows with no revision queries or duplicate header text', async () => {
    const { database, store } = setup(readByteBudget)
    const source = fixture()
    source.rows.threads[0].sessionPromptContextSnapshot = {
      version: 1,
      soul: '记忆😀'.repeat(1000),
      memories: [],
      workspaceInstructions: 'instructions',
      workspaceDirectories: [],
      capturedAt: 1,
    }
    await store.writeRows(source)
    const query = vi.spyOn(database, 'query')
    expect(await store.readExportCommit(source.record.id)).toEqual({ record: source.record, revision: 1 })
    expect(query.mock.calls.filter(([sql]) => sql.includes('threadOrder = -1 LIMIT 2'))).toHaveLength(1)
    expect(query.mock.calls.some(([sql]) => sql.includes('session_row_heads'))).toBe(false)
    query.mockClear()

    const rows: SessionStoredRow[] = []
    for await (const row of store.iterateRows({ sessionId: source.record.id, consistency: 'export' })) rows.push(row)
    expect(rows.filter((row) => row.kind === 'thread').map((row) => row.thread)).toEqual(source.rows.threads)
    expect(rows.filter((row) => row.kind === 'message').map((row) => row.message)).toEqual(source.rows.messages)
    expect(query.mock.calls.some(([sql]) => /session_row_heads|substr\(session_record_json/.test(sql))).toBe(false)
    expect(query.mock.calls.filter(([sql]) => sql.includes('ORDER BY threadOrder, thread_id LIMIT'))).toHaveLength(1)
    expect(query.mock.calls.some(([sql]) => sql.includes('substr(session_prompt_context_snapshot_json'))).toBe(
      readByteBudget === 'bounded'
    )
  })
})

it.each(['identity', 'revision', 'authority', 'format'] as const)(
  'rejects an invalid export header %s',
  async (kind) => {
    const { database, store } = setup()
    const source = fixture()
    await store.writeRows(source)
    const record = {
      ...source.record,
      ...(kind === 'identity' ? { id: 'wrong-session' } : {}),
      ...(kind === 'authority' ? { rowAuthority: 0 } : {}),
      ...(kind === 'format' ? { rowFormatVersion: 2 } : {}),
    }
    await database.executeBatch([
      {
        sql: 'UPDATE session_threads SET session_record_json = ?, commit_revision = ? WHERE session_id = ? AND threadOrder = -1',
        params: [JSON.stringify(record), kind === 'revision' ? 0 : 1, source.record.id],
      },
    ])
    await expect(store.readExportCommit(source.record.id)).rejects.toMatchObject({ operation: 'read-commit' })
  }
)

it('keeps export cancellation and rejects an expected revision on an export request', async () => {
  const { database, store } = setup()
  const source = fixture()
  await store.writeRows(source)
  const query = vi.spyOn(database, 'query')
  const invalid = store.iterateRows({ sessionId: source.record.id, consistency: 'export', expectedRevision: 1 })
  await expect(invalid.next()).rejects.toThrow('Export row iteration cannot require a revision')
  expect(query).not.toHaveBeenCalled()

  const controller = new AbortController()
  const iterator = store.iterateRows({
    sessionId: source.record.id,
    consistency: 'export',
    signal: controller.signal,
  })
  expect(await iterator.next()).toMatchObject({ done: false, value: { kind: 'thread' } })
  controller.abort()
  await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
})
