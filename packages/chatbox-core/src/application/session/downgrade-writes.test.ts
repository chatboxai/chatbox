import { describe, expect, test } from 'vitest'
import type { StoredSessionRecord } from '../../ports'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import type { Message, Session } from '../../types/session'
import { RowBackedSessionRepository, type RowBackedSessionRepositoryOptions } from './RowBackedSessionRepository'

function message(id: string, role: Message['role'], timestamp: number): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }], timestamp }
}

function historySession(id: string): Session {
  return {
    id,
    type: 'chat',
    name: 'History',
    messages: [message('h-user', 'user', 100), message('h-assistant', 'assistant', 200)],
    threads: [{ id: 'h-thread', name: 'Earlier', createdAt: 10, messages: [message('h-old', 'user', 11)] }],
  }
}

/**
 * Chatbox 1.23 and earlier read a session record by spreading it and defaulting
 * the content arrays, then write the whole object back. A row marker therefore
 * keeps its marker fields and gains the content the older client produced.
 */
function readAsReleasedClient(record: StoredSessionRecord): Session {
  const session = record as Session
  return {
    ...session,
    settings: { temperature: undefined, ...session.settings },
    messages: session.messages ?? [],
    threads: session.threads,
    messageForksHash: session.messageForksHash ?? {},
  }
}

function createStores() {
  const records = new InMemorySessionRecordStore()
  const rows = new InMemorySessionRowStore()
  return { records, rows }
}

type Stores = ReturnType<typeof createStores>

async function storedRecord(stores: Stores, id: string): Promise<StoredSessionRecord> {
  const record = await stores.records.getRecord(id)
  if (!record) throw new Error(`session ${id} has no record`)
  return record
}

async function openRepository(stores: Stores, options: Partial<RowBackedSessionRepositoryOptions> = {}) {
  const repository = new RowBackedSessionRepository({ ...stores, now: () => 1_000, ...options })
  await repository.initialize()
  return repository
}

async function migratedSession(stores: Stores, session: Session) {
  await stores.records.setRecord(session)
  const repository = await openRepository(stores)
  await expect(repository.migrateSession(session.id)).resolves.toBe('migrated')
}

function messageIds(session: Session | null): string[] {
  return (session?.messages ?? []).map((item) => item.id)
}

describe('sessions written by a released client after a downgrade', () => {
  test('keeps the row history and the messages the released client appended', async () => {
    const stores = createStores()
    await migratedSession(stores, historySession('s1'))

    const seen = readAsReleasedClient(await storedRecord(stores, 's1'))
    expect(seen.messages).toEqual([])
    await stores.records.setRecord({
      ...seen,
      messages: [message('d-user', 'user', 300), message('d-assistant', 'assistant', 400)],
    })

    const repository = await openRepository(stores)
    const session = await repository.getSession('s1')
    if (!session) throw new Error('session s1 is missing')
    expect(messageIds(session)).toEqual(['h-user', 'h-assistant', 'd-user', 'd-assistant'])
    expect(session?.threads?.map((thread) => thread.id)).toEqual(['h-thread'])

    const marker = (await stores.records.getRecord('s1')) as Record<string, unknown>
    expect(marker.storageFormat).toBe('rows')
    expect(marker).not.toHaveProperty('messages')
    expect(marker).not.toHaveProperty('messageForksHash')

    await repository.setSession({ ...session, name: 'Renamed' }, { baseSession: session })
    const reopened = await openRepository(stores)
    expect(messageIds(await reopened.getSession('s1'))).toEqual(['h-user', 'h-assistant', 'd-user', 'd-assistant'])
  })

  test('keeps a topic the released client started', async () => {
    const stores = createStores()
    await migratedSession(stores, historySession('s1'))

    const seen = readAsReleasedClient(await storedRecord(stores, 's1'))
    await stores.records.setRecord({
      ...seen,
      messages: [message('d-next', 'user', 600)],
      threads: [{ id: 'd-thread', name: 'Downgraded', createdAt: 500, messages: [message('d-first', 'user', 510)] }],
    })

    const session = await (await openRepository(stores)).getSession('s1')
    expect(messageIds(session)).toEqual(['h-user', 'h-assistant', 'd-next'])
    expect(session?.threads?.map((thread) => thread.id)).toEqual(['h-thread', 'd-thread'])
  })

  test('keeps a compaction the released client made', async () => {
    const stores = createStores()
    await migratedSession(stores, historySession('s1'))
    const seen = readAsReleasedClient(await storedRecord(stores, 's1'))
    const point = { summaryMessageId: 'd-summary', boundaryMessageId: 'd-next', createdAt: 450 }
    await stores.records.setRecord({
      ...seen,
      messages: [
        message('d-user', 'user', 300),
        message('d-assistant', 'assistant', 400),
        { ...message('d-summary', 'assistant', 450), isSummary: true },
        message('d-next', 'user', 500),
      ],
      compactionPoints: [point],
    })

    const session = await (await openRepository(stores)).getSession('s1')
    expect(session?.compactionPoints).toEqual([point])
    expect(await stores.records.getRecord('s1')).not.toHaveProperty('compactionPoints')
    expect((await (await openRepository(stores)).getSession('s1'))?.compactionPoints).toEqual([point])
  })

  test('folds released-client writes in from the background migration pass', async () => {
    const stores = createStores()
    await migratedSession(stores, historySession('s1'))
    const seen = readAsReleasedClient(await storedRecord(stores, 's1'))
    await stores.records.setRecord({ ...seen, messages: [message('d-user', 'user', 300)] })

    const repository = await openRepository(stores)
    await expect(repository.listUnmigratedSessionIds()).resolves.toEqual(['s1'])
    await expect(repository.migrateSession('s1')).resolves.toBe('migrated')
    await expect(repository.listUnmigratedSessionIds()).resolves.toEqual([])
    expect(messageIds(await repository.getSession('s1'))).toEqual(['h-user', 'h-assistant', 'd-user'])
  })

  test('cleans a marker the released client only rewrote', async () => {
    const stores = createStores()
    await migratedSession(stores, historySession('s1'))
    await stores.records.setRecord(readAsReleasedClient(await storedRecord(stores, 's1')))

    const repository = await openRepository(stores)
    expect(messageIds(await repository.getSession('s1'))).toEqual(['h-user', 'h-assistant'])
    expect(await stores.records.getRecord('s1')).not.toHaveProperty('messages')
  })

  test('restores a migrated session the released client deleted', async () => {
    const stores = createStores()
    await migratedSession(stores, historySession('s1'))
    await stores.records.removeRecord('s1')

    const restored: string[] = []
    const repository = await openRepository(stores, {
      onOrphanedRowsRestored: (session) => {
        restored.push(session.id)
        return Promise.resolve()
      },
    })

    expect(restored).toEqual(['s1'])
    await expect(repository.getAllSessionIds()).resolves.toEqual(['s1'])
    const session = await repository.getSession('s1')
    expect(messageIds(session)).toEqual(['h-user', 'h-assistant'])
    expect(session?.threads?.map((thread) => thread.id)).toEqual(['h-thread'])
  })

  test('keeps nested forks inside an inactive released-client branch', async () => {
    const stores = createStores()
    await migratedSession(stores, historySession('s1'))
    const seen = readAsReleasedClient(await storedRecord(stores, 's1'))
    await stores.records.setRecord({
      ...seen,
      messages: [message('outer', 'user', 300), message('active', 'assistant', 310)],
      messageForksHash: {
        inner: {
          position: 0,
          createdAt: 330,
          lists: [
            { id: 'inner-current', messages: [] },
            { id: 'inner-alternative', messages: [message('nested-answer', 'assistant', 340)] },
          ],
        },
        outer: {
          position: 0,
          createdAt: 320,
          lists: [
            { id: 'outer-current', messages: [] },
            {
              id: 'outer-alternative',
              messages: [message('inner', 'user', 325), message('inner-answer', 'assistant', 326)],
            },
          ],
        },
      },
    })

    const repository = await openRepository(stores)
    const merged = await repository.getSession('s1')
    expect(merged?.messageForksHash?.inner?.lists[1].messages.map((item) => item.id)).toEqual(['nested-answer'])
    expect(merged?.messageForksHash?.outer?.lists[1].messages.map((item) => item.id)).toEqual(['inner', 'inner-answer'])
    expect(await stores.records.getRecord('s1')).not.toHaveProperty('messages')
    expect(await (await openRepository(stores)).getSession('s1')).toEqual(merged)
  })

  test('keeps initializing when a list restoration fails and retries it on the next startup', async () => {
    const stores = createStores()
    await migratedSession(stores, historySession('s1'))
    await migratedSession(stores, historySession('s2'))
    await stores.records.removeRecord('s1')
    await stores.records.removeRecord('s2')
    let failS1 = true
    const restored: string[] = []
    const skipped: string[] = []
    const options = {
      onOrphanedRowsRestored: (session: Session) => {
        if (session.id === 's1' && failS1) return Promise.reject(new Error('list write failed'))
        restored.push(session.id)
        return Promise.resolve()
      },
      onMigrationSkipped: (id: string, reason: string) => {
        skipped.push(`${id}: ${reason}`)
      },
    }

    const first = await openRepository(stores, options)
    expect(skipped).toEqual([expect.stringContaining('s1: rows without a record were kept: list write failed')])
    expect(restored).toEqual(['s2'])
    await expect(first.getSession('s1')).resolves.toBeNull()
    expect(messageIds(await first.getSession('s2'))).toEqual(['h-user', 'h-assistant'])

    failS1 = false
    const second = await openRepository(stores, options)
    expect(restored).toEqual(['s2', 's1'])
    expect(messageIds(await second.getSession('s1'))).toEqual(['h-user', 'h-assistant'])
  })

  test('restores orphaned rows without a restore callback', async () => {
    const stores = createStores()
    await migratedSession(stores, historySession('s1'))
    await stores.records.removeRecord('s1')

    const repository = await openRepository(stores)
    expect(messageIds(await repository.getSession('s1'))).toEqual(['h-user', 'h-assistant'])
  })
})
