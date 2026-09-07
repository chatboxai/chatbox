import 'fake-indexeddb/auto'
import { type SessionMetaRepositoryPort, SessionRepositoryError, type SessionRepositoryPort } from '@chatbox/core/ports'
import {
  createSessionRepositoryContract,
  runSessionRepositoryContract,
} from '@chatbox/core/ports/testing/session-repository-contract'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import type { Session, SessionMetaPage, SessionMetaRecord } from '@shared/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { IndexedDBSessionMetaStorage } from '@/storage/SessionMetaStorage'
import { type CurrentSessionDataStorage, CurrentSessionRepository } from './CurrentSessionRepository'

function createSession(id = 'session-1'): Session {
  return {
    id,
    name: 'Session',
    type: 'chat',
    messages: [],
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
  const repository: SessionRepositoryPort = new CurrentSessionRepository({
    dataStorage,
    metaStorage,
  })

  return {
    dataStorage,
    getItem,
    setItemNow,
    removeItem,
    metaStorage,
    repository,
    values,
  }
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
    })

    await runSessionRepositoryContract(() => repository)
  })

  test('initializes the current meta storage through the repository boundary', async () => {
    await harness.repository.initialize()

    expect(harness.metaStorage.initialize).toHaveBeenCalledOnce()
  })

  test('writes full sessions under the existing session storage key', async () => {
    const session = createSession()

    await harness.repository.setSession(session)

    expect(harness.values.get('session:session-1')).toBe(session)
    expect(harness.setItemNow).toHaveBeenCalledWith('session:session-1', session)
  })

  test('reads and migrates sessions using the current compatibility path', async () => {
    const persisted = createSession()
    harness.values.set('session:session-1', persisted)

    const result = await harness.repository.getSession('session-1')

    expect(result).toEqual({
      ...persisted,
      settings: { temperature: undefined },
      messageForksHash: {},
    })
    expect(harness.getItem).toHaveBeenCalledWith('session:session-1', null)
    expect(harness.setItemNow).not.toHaveBeenCalled()
  })

  test('returns null for a missing session', async () => {
    await expect(harness.repository.getSession('missing')).resolves.toBeNull()
  })

  test('deletes the existing full-session storage key', async () => {
    harness.values.set('session:session-1', createSession())

    await harness.repository.deleteSession('session-1')

    expect(harness.values.has('session:session-1')).toBe(false)
    expect(harness.removeItem).toHaveBeenCalledWith('session:session-1')
  })

  test('lists only valid full-session identifiers', async () => {
    harness.values.set('session:one', createSession('one'))
    harness.values.set('session:two', createSession('two'))
    harness.values.set('session:', {})
    harness.values.set('session:undefined', {})
    harness.values.set('settings', {})

    await expect(harness.repository.getAllSessionIds()).resolves.toEqual(['one', 'two'])
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
