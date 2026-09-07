import 'fake-indexeddb/auto'
import { type SessionMetaRepositoryPort, SessionRepositoryError } from '@chatbox/core/ports'
import {
  createSessionRepositoryContract,
  runSessionRepositoryContract,
} from '@chatbox/core/ports/testing/session-repository-contract'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import type { Message, Session, SessionMetaPage, SessionMetaRecord } from '@shared/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { IndexedDBSessionMetaStorage } from '@/storage/SessionMetaStorage'
import { IndexedDBSessionRowStore } from '@/storage/SessionRowStorage'
import { type CurrentSessionDataStorage, CurrentSessionRepository } from './CurrentSessionRepository'

function message(id: string, role: Message['role'], timestamp: number): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }], timestamp }
}

function createSession(id = 'session-1'): Session {
  return {
    id,
    name: 'Session',
    type: 'chat',
    messages: [],
  }
}

function createSessionWithMessages(id = 'session-1'): Session {
  return {
    ...createSession(id),
    messages: [message('user-1', 'user', 100), message('assistant-1', 'assistant', 200)],
  }
}

function createMetaStorage(): SessionMetaRepositoryPort {
  return {
    initialize: vi.fn(() => Promise.resolve()),
    create: vi.fn(() => Promise.resolve()),
    createMany: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve(null)),
    getById: vi.fn(() => Promise.resolve(null)),
    delete: vi.fn(() => Promise.resolve()),
    deleteMany: vi.fn(() => Promise.resolve()),
    getAll: vi.fn(() => Promise.resolve([])),
    getAllIncludingHidden: vi.fn(() => Promise.resolve([])),
    getArchived: vi.fn(() => Promise.resolve([])),
    getArchivedPage: vi.fn(() =>
      Promise.resolve({
        items: [],
        nextCursor: null,
        total: 0,
      } satisfies SessionMetaPage)
    ),
    getPage: vi.fn(() =>
      Promise.resolve({
        items: [],
        nextCursor: null,
        total: 0,
      } satisfies SessionMetaPage)
    ),
    getTotal: vi.fn(() => Promise.resolve(0)),
    getAllTotal: vi.fn(() => Promise.resolve(0)),
    getArchivedTotal: vi.fn(() => Promise.resolve(0)),
    clear: vi.fn(() => Promise.resolve()),
  }
}

function createHarness(metaStorage: SessionMetaRepositoryPort = createMetaStorage()) {
  const values = new Map<string, unknown>()
  const getItem = vi.fn((key: string, initialValue: unknown) =>
    Promise.resolve(values.has(key) ? values.get(key) : initialValue)
  )
  const setItemNow = vi.fn((key: string, value: unknown) => {
    values.set(key, value)
    return Promise.resolve()
  })
  const removeItem = vi.fn((key: string) => {
    values.delete(key)
    return Promise.resolve()
  })
  const getAllKeys = vi.fn(() => Promise.resolve([...values.keys()]))
  const dataStorage: CurrentSessionDataStorage = {
    getItem: <T>(key: string, initialValue: T) => getItem(key, initialValue) as Promise<T>,
    setItemNow,
    removeItem,
    getAllKeys,
  }
  const rowStore = new IndexedDBSessionRowStore()
  const repository = new CurrentSessionRepository({
    dataStorage,
    metaStorage,
    rowStore,
  })

  return {
    dataStorage,
    getItem,
    setItemNow,
    removeItem,
    metaStorage,
    repository,
    rowStore,
    values,
  }
}

function storedRecord(harness: ReturnType<typeof createHarness>, id: string): Record<string, unknown> {
  return harness.values.get(`session:${id}`) as Record<string, unknown>
}

/** Rows come back in primary-key order, so ids are compared sorted. */
async function messageRowIds(harness: ReturnType<typeof createHarness>, id: string): Promise<string[]> {
  const snapshot = await harness.rowStore.readSnapshot(id)
  return (snapshot?.rows.messages ?? []).map((row) => row.messageId).sort()
}

describe('CurrentSessionRepository contract', () => {
  let harness: ReturnType<typeof createHarness>

  beforeEach(() => {
    harness = createHarness()
  })

  test('satisfies the reusable portable repository contract', async () => {
    const values = new Map<string, unknown>()
    const inMemoryMeta = new InMemorySessionRepository()
    const repository = new CurrentSessionRepository({
      dataStorage: {
        getItem: <T>(key: string, initialValue: T) =>
          Promise.resolve(values.has(key) ? (values.get(key) as T) : initialValue),
        setItemNow: (key, value) => {
          values.set(key, value)
          return Promise.resolve()
        },
        removeItem: (key) => {
          values.delete(key)
          return Promise.resolve()
        },
        getAllKeys: () => Promise.resolve([...values.keys()]),
      },
      metaStorage: inMemoryMeta.meta,
      rowStore: new IndexedDBSessionRowStore(),
    })

    await runSessionRepositoryContract(() => repository)
  })

  test('initializes the current meta storage through the repository boundary', async () => {
    await harness.repository.initialize()

    expect(harness.metaStorage.initialize).toHaveBeenCalledOnce()
  })

  test('writes a session as a record without messages plus its message rows', async () => {
    const session = createSessionWithMessages('session-write')

    await harness.repository.setSession(session)

    const record = storedRecord(harness, 'session-write')
    expect(record.storageFormat).toBe('rows')
    expect(record).not.toHaveProperty('messages')
    expect(record).not.toHaveProperty('threads')
    expect(await messageRowIds(harness, 'session-write')).toEqual(['assistant-1', 'user-1'])
    await expect(harness.repository.getSession('session-write')).resolves.toMatchObject({
      messages: [{ id: 'user-1' }, { id: 'assistant-1' }],
    })
  })

  test('reports full-session write failures with operation and session context', async () => {
    const cause = new Error('session write failed')
    harness.setItemNow.mockRejectedValueOnce(cause)

    const error = await harness.repository.setSession(createSession()).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(SessionRepositoryError)
    expect(error).toMatchObject({
      operation: 'set-session',
      sessionId: 'session-1',
      cause,
    })
  })

  test('reads a legacy whole-session record immediately and converts it when migration is scheduled', async () => {
    harness.values.set('session:legacy', createSessionWithMessages('legacy'))

    const result = await harness.repository.getSession('legacy')

    expect(result).toMatchObject({
      id: 'legacy',
      name: 'Session',
      messages: [{ id: 'user-1' }, { id: 'assistant-1' }],
    })
    expect(storedRecord(harness, 'legacy')).toHaveProperty('messages')
    await expect(harness.repository.migrateSession('legacy')).resolves.toBe('migrated')

    const record = storedRecord(harness, 'legacy')
    expect(record.storageFormat).toBe('rows')
    expect(record).not.toHaveProperty('messages')
    expect(await messageRowIds(harness, 'legacy')).toEqual(['assistant-1', 'user-1'])
  })

  test('returns null for a missing session', async () => {
    await expect(harness.repository.getSession('missing')).resolves.toBeNull()
  })

  test('deletes the full-session storage key together with its rows', async () => {
    await harness.repository.setSession(createSessionWithMessages('session-delete'))

    await harness.repository.deleteSession('session-delete')

    expect(harness.values.has('session:session-delete')).toBe(false)
    expect(harness.removeItem).toHaveBeenCalledWith('session:session-delete')
    await expect(harness.rowStore.readSnapshot('session-delete')).resolves.toBeNull()
  })

  test('lists only valid full-session identifiers', async () => {
    harness.values.set('session:one', createSession('one'))
    harness.values.set('session:two', createSession('two'))
    harness.values.set('session:', {})
    harness.values.set('session:undefined', {})
    harness.values.set('settings', {})

    await expect(harness.repository.getAllSessionIds()).resolves.toEqual(['one', 'two'])
  })

  test('leaves out the draft held under the not-yet-created chat id', async () => {
    harness.values.set('session:one', createSession('one'))
    harness.values.set('session:new', createSession('new'))

    await expect(harness.repository.getAllSessionIds()).resolves.toEqual(['one'])
    await expect(harness.repository.listUnmigratedSessionIds()).resolves.toEqual(['one'])
  })

  test('delegates meta operations without changing their arguments', async () => {
    const record: SessionMetaRecord = {
      id: 'session-1',
      name: 'Session',
      type: 'chat',
      sortOrder: 10,
      createdAt: 10,
    }

    await harness.repository.meta.create(record)

    expect(harness.metaStorage.create).toHaveBeenCalledWith(record)
  })

  test('normalizes backend failures with operation and session context', async () => {
    const cause = new Error('backend failed')
    harness.getItem.mockRejectedValueOnce(cause)

    const error = await harness.repository.getSession('session-1').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(SessionRepositoryError)
    expect(error).toMatchObject({
      operation: 'get-session',
      sessionId: 'session-1',
      cause,
    })
  })
})

describe('CurrentSessionRepository shared behavior contract', () => {
  for (const contractCase of createSessionRepositoryContract(
    () => createHarness(new IndexedDBSessionMetaStorage()).repository
  )) {
    test(contractCase.name, contractCase.run)
  }
})
