import { afterEach, describe, expect, it, vi } from 'vitest'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { contextSnapshot } from './session-context-read.test-support'
import { SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const database of databases.splice(0)) database.close()
})
function setup() {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  return { database, store: new SqlSessionRowStore(database) }
}
const fixture = (text = 'whole😀\u0000'.repeat(100000)) =>
  contextSnapshot({
    id: 's',
    name: 'Whole message',
    messages: [
      { id: 'first', role: 'user', contentParts: [{ type: 'text', text }] },
      { id: 'last', role: 'assistant', contentParts: [{ type: 'text', text: 'reply' }] },
    ],
  })

describe('SQL row transfer', () => {
  it.each([0, 1, 3])('rejects a non-successor candidate revision %i', async (revision) => {
    const { store } = setup()
    await expect(store.stageRows({ ...fixture('small'), revision }, 1)).rejects.toThrow('Invalid row candidate commit')
  })
  it('publishes one invisible candidate and retains complete messages after dispose', async () => {
    const { database, store } = setup()
    const next = fixture()
    const writer = await store.stageRows(next, null)
    for (const thread of next.rows.threads) await writer.appendThread(thread)
    for (const message of next.rows.messages) await writer.appendMessage(message)
    expect(await store.hasRows('s')).toBe(false)
    await new SqlSessionRowStore(database).initialize()
    await writer.publish()
    await writer.dispose()
    const rows = []
    for await (const row of store.iterateRows({ sessionId: 's', expectedRevision: 1 })) rows.push(row)
    expect(rows.filter((row) => row.kind === 'message').map((row) => row.message)).toEqual(next.rows.messages)
    expect(await database.query('SELECT selected_depth FROM session_messages ORDER BY selected_depth')).toEqual([
      { selected_depth: 0 },
      { selected_depth: 1 },
    ])
    expect(await database.query('SELECT COUNT(*) AS n FROM session_messages_staging')).toEqual([{ n: 0 }])
  })

  it('rejects revision conflicts and discards only its unpublished candidate', async () => {
    const { store } = setup()
    const old = fixture('old')
    await store.writeRows(old)
    const writer = await store.stageRows({ ...old, revision: 2 }, 1)
    for (const thread of old.rows.threads) await writer.appendThread(thread)
    for (const message of old.rows.messages) await writer.appendMessage(message)
    const concurrent = fixture('concurrent')
    await store.writeRows({ ...concurrent, revision: 2 }, 1)
    await expect(writer.publish()).rejects.toMatchObject({ name: 'SessionRowConflictError' })
    await writer.dispose()
    expect((await store.readSnapshot('s'))?.rows).toEqual(concurrent.rows)
  })

  it.each(['thread', 'message'])('rejects duplicate %s identities and closes the candidate', async (kind) => {
    const { store } = setup()
    const next = fixture('small')
    const writer = await store.stageRows(next, null)
    for (const thread of next.rows.threads) await writer.appendThread(thread)
    for (const message of next.rows.messages) await writer.appendMessage(message)
    await expect(
      kind === 'thread' ? writer.appendThread(next.rows.threads[0]) : writer.appendMessage(next.rows.messages[0])
    ).rejects.toThrow()
    await expect(writer.publish()).rejects.toThrow('not writable')
    await writer.dispose()
    expect(await store.hasRows('s')).toBe(false)
  })

  it('rejects row identities outside the target session', async () => {
    const { store } = setup()
    const next = fixture('small')
    const writer = await store.stageRows(next, null)
    await expect(writer.appendThread({ ...next.rows.threads[0], sessionId: 'other' })).rejects.toThrow()
    await expect(writer.appendMessage({ ...next.rows.messages[0], sessionId: 'other' })).rejects.toThrow()
    await expect(
      writer.appendMessage({ ...next.rows.messages[0], message: { ...next.rows.messages[0].message, id: 'other' } })
    ).rejects.toThrow()
    await writer.dispose()
    expect(await store.hasRows('s')).toBe(false)
  })

  it.each(['cycle', 'missing-root', 'missing-child', 'wrong-selected-leaf'])(
    'rejects an incomplete selected-path projection: %s',
    async (kind) => {
      const { database, store } = setup()
      const old = fixture('old')
      await store.writeRows(old)
      const next = { ...fixture('replacement'), revision: 2 }
      if (kind === 'cycle') next.rows.messages[1].activeChildId = 'first'
      if (kind === 'missing-root') next.rows.threads[0].rootMessageId = 'absent'
      if (kind === 'missing-child') next.rows.messages[1].activeChildId = 'absent'
      if (kind === 'wrong-selected-leaf') next.rows.threads[0].activeLeafMessageId = 'first'
      const writer = await store.stageRows(next, 1)
      for (const thread of next.rows.threads) await writer.appendThread(thread)
      for (const message of next.rows.messages) await writer.appendMessage(message)
      await expect(writer.publish()).rejects.toThrow()
      await writer.dispose()
      expect((await store.readSnapshot('s'))?.rows).toEqual(old.rows)
      expect(await database.query('SELECT COUNT(*) AS n FROM session_messages_staging')).toEqual([{ n: 0 }])
      expect(await database.query('SELECT COUNT(*) AS n FROM session_row_selected_paths')).toEqual([{ n: 0 }])
    }
  )

  it('rolls back the complete replacement if a live row write fails', async () => {
    const { database, store } = setup()
    const old = fixture('old')
    await store.writeRows(old)
    const persisted = await store.readSnapshot('s')
    const next = { ...fixture('replacement'), revision: 2 }
    const writer = await store.stageRows(next, 1)
    for (const thread of next.rows.threads) await writer.appendThread(thread)
    for (const message of next.rows.messages) await writer.appendMessage(message)
    await database.execute(`CREATE TRIGGER reject_transfer BEFORE INSERT ON session_messages
      WHEN NEW.message_id='last' BEGIN SELECT RAISE(ABORT,'synthetic publish failure'); END`)
    await expect(writer.publish()).rejects.toThrow('synthetic publish failure')
    await writer.dispose()
    expect(await store.readSnapshot('s')).toEqual(persisted)
    expect(await database.query('SELECT COUNT(*) AS n FROM session_messages_staging')).toEqual([{ n: 0 }])
  })

  it('publishes using metadata projections without rereading bodies or branch definitions', async () => {
    const { database, store } = setup()
    const next = fixture('small')
    const writer = await store.stageRows(next, null)
    for (const thread of next.rows.threads) await writer.appendThread(thread)
    for (const message of next.rows.messages) await writer.appendMessage(message)
    const reads = vi.spyOn(database, 'query')
    await writer.publish()
    await writer.dispose()
    for (const [sql] of reads.mock.calls)
      expect(sql).not.toMatch(/message_json|row_metadata_json|compaction_points_json|json_each/i)
  })

  it('checks cancellation and revision changes during row iteration', async () => {
    const { store } = setup()
    const next = fixture('small')
    await store.writeRows(next)
    const controller = new AbortController()
    const iterator = store.iterateRows({ sessionId: 's', signal: controller.signal })[Symbol.asyncIterator]()
    await iterator.next()
    controller.abort()
    await expect(iterator.next()).rejects.toThrow()
    const other = store.iterateRows({ sessionId: 's' })[Symbol.asyncIterator]()
    await other.next()
    await store.writeRows({ ...next, revision: 2 }, 1)
    await expect(other.next()).rejects.toMatchObject({ name: 'SessionRowConflictError' })
  })
})
