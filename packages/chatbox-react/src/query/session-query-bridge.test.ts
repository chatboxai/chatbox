import {
  type Message,
  type Session,
  SessionEventBus,
  type SessionMetaPage,
  type SessionMetaRecord,
  SessionNotFoundError,
  SessionService,
  SessionWriteCoordinator,
} from '@chatbox/core'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test, vi } from 'vitest'
import { QueryKeys } from './query-keys'
import { applySessionListUpdate, type InfiniteSessionData, SessionQueryBridge } from './session-query-bridge'
import { createSessionQueryDefinitions } from './session-query-options'

function createTestSession(id: string): Session {
  return {
    id,
    name: id,
    type: 'chat',
    messages: [],
  }
}

function createTestRecord(session: Session, sortOrder: number): SessionMetaRecord {
  return {
    id: session.id,
    name: session.name,
    type: session.type,
    sortOrder,
    createdAt: sortOrder,
  }
}

function createService(repository: InMemorySessionRepository, events: SessionEventBus): SessionService {
  return new SessionService(repository, new SessionWriteCoordinator(repository), events, {
    createId: () => 'created',
    now: () => 100,
  })
}

describe('session query definitions', () => {
  test('the same definitions run against independent QueryClient instances', async () => {
    const page: SessionMetaPage = {
      items: [],
      nextCursor: null,
      total: 0,
    }
    const definitions = createSessionQueryDefinitions({
      getSession: () => Promise.resolve(null),
      listSessionsMetaPage: () => Promise.resolve(page),
      listArchivedSessionsMetaPage: () => Promise.resolve(page),
    })
    const firstClient = new QueryClient()
    const secondClient = new QueryClient()

    await firstClient.fetchInfiniteQuery(definitions.sessions)
    await secondClient.fetchInfiniteQuery(definitions.sessions)

    expect(firstClient.getQueryData(QueryKeys.ChatSessionsList)).toEqual(
      secondClient.getQueryData(QueryKeys.ChatSessionsList)
    )
    firstClient.setQueryData(QueryKeys.ChatSessionsList, undefined)
    expect(secondClient.getQueryData(QueryKeys.ChatSessionsList)).toBeDefined()
  })
})

describe('SessionQueryBridge', () => {
  test('distinguishes an absent cache entry from a cached missing session', () => {
    const repository = new InMemorySessionRepository()
    const events = new SessionEventBus()
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, createService(repository, events), events)

    expect(bridge.getCachedSession('session-1')).toBeUndefined()
    queryClient.setQueryData(QueryKeys.ChatSession('session-1'), null)
    expect(bridge.getCachedSession('session-1')).toBeNull()
  })

  test('failed deletion evicts stale session data before writes reopen', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, createTestRecord(session, 1))
    const events = new SessionEventBus()
    const queryClient = new QueryClient()
    let bridge: SessionQueryBridge | null = null
    const writes = new SessionWriteCoordinator(repository, {
      readCurrentSession: (sessionId) => (bridge ? bridge.getSession(sessionId) : repository.getSession(sessionId)),
      discardCurrentSession: (sessionId) => bridge?.discardSessionCache(sessionId),
    })
    const service = new SessionService(repository, writes, events, {
      createId: () => 'created',
      now: () => 100,
    })
    bridge = new SessionQueryBridge(queryClient, service, events)
    queryClient.setQueryData(QueryKeys.ChatSession(session.id), {
      ...session,
      name: 'Stale cached session',
    })
    repository.meta.delete = () => Promise.reject(new Error('metadata deletion failed'))

    await expect(service.deleteSession(session.id)).rejects.toThrow('metadata deletion failed')

    expect(queryClient.getQueryData(QueryKeys.ChatSession(session.id))).toBeUndefined()
    await expect(service.updateSession(session.id, { name: 'Must not revive' })).rejects.toBeInstanceOf(
      SessionNotFoundError
    )
    expect(repository.sessions.has(session.id)).toBe(false)
  })

  test('metadata update failure still projects persisted session data into the cache', async () => {
    const repository = new InMemorySessionRepository()
    const session = createTestSession('session-1')
    repository.sessions.set(session.id, session)
    repository.records.set(session.id, createTestRecord(session, 1))
    const events = new SessionEventBus()
    const queryClient = new QueryClient()
    let bridge: SessionQueryBridge | null = null
    const writes = new SessionWriteCoordinator(repository, {
      readCurrentSession: (sessionId) => (bridge ? bridge.getSession(sessionId) : repository.getSession(sessionId)),
    })
    const service = new SessionService(repository, writes, events, {
      createId: () => 'created',
      now: () => 100,
    })
    bridge = new SessionQueryBridge(queryClient, service, events)
    await bridge.getSession(session.id)
    const queuedMessage: Message = {
      id: 'queued-message',
      role: 'user',
      contentParts: [{ type: 'text', text: 'hello' }],
    }
    const metadataError = new Error('metadata update failed')
    vi.spyOn(repository.meta, 'update').mockRejectedValueOnce(metadataError)
    const onFullSessionPersisted = vi.fn()

    await expect(
      service.updateSessionWithMessages(
        session.id,
        (current) => {
          if (!current) throw new Error('Expected current session')
          return { ...current, messages: [...current.messages, queuedMessage] }
        },
        { onFullSessionPersisted }
      )
    ).rejects.toBe(metadataError)

    expect(onFullSessionPersisted).toHaveBeenCalledOnce()
    expect(onFullSessionPersisted).toHaveBeenCalledWith(repository.sessions.get(session.id))
    expect(repository.sessions.get(session.id)?.messages).toEqual([queuedMessage])
    expect(queryClient.getQueryData<Session>(QueryKeys.ChatSession(session.id))?.messages).toEqual([queuedMessage])
    expect(repository.records.get(session.id)?.name).toBe(session.name)
  })

  test('bulk deletion resets every client from storage and includes unloaded pages', async () => {
    const repository = new InMemorySessionRepository()
    for (let index = 1; index <= 4; index += 1) {
      const session = createTestSession(`session-${index}`)
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, index))
    }
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const firstClient = new QueryClient()
    const secondClient = new QueryClient()
    const firstBridge = new SessionQueryBridge(firstClient, service, events)
    const secondBridge = new SessionQueryBridge(secondClient, service, events)

    await firstClient.fetchInfiniteQuery(firstBridge.definitions.sessions)
    await secondClient.fetchInfiniteQuery(secondBridge.definitions.sessions)
    expect(
      firstClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)?.pages[0].items.map(({ id }) => id)
    ).toEqual(['session-4', 'session-3'])

    await service.deleteSessions(['session-3', 'session-1'])

    for (const client of [firstClient, secondClient]) {
      expect(client.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)).toEqual({
        pages: [
          {
            items: [repository.records.get('session-4'), repository.records.get('session-2')],
            nextCursor: null,
            total: 2,
          },
        ],
        pageParams: [0],
      })
    }
    expect([...repository.sessions.keys()].sort()).toEqual(['session-2', 'session-4'])
  })

  test('metadata persistence preserves newer generating messages in the cache', async () => {
    const repository = new InMemorySessionRepository()
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    new SessionQueryBridge(queryClient, service, events)
    const persisted: Session = {
      ...createTestSession('session-1'),
      messages: [
        {
          id: 'assistant',
          role: 'assistant',
          contentParts: [{ type: 'text', text: 'old' }],
          generating: true,
        },
      ],
    }
    const cached: Session = {
      ...persisted,
      messages: [
        {
          ...persisted.messages[0],
          contentParts: [{ type: 'text', text: 'new streaming content' }],
        },
      ],
    }
    queryClient.setQueryData(QueryKeys.ChatSession(persisted.id), cached)

    await events.publish({
      type: 'session-updated',
      session: { ...persisted, name: 'Renamed' },
      meta: { id: persisted.id, name: 'Renamed', type: 'chat' },
      preserveCachedGeneratingMessages: true,
    })

    expect(queryClient.getQueryData<Session>(QueryKeys.ChatSession(persisted.id))).toMatchObject({
      name: 'Renamed',
      messages: [
        {
          contentParts: [{ type: 'text', text: 'new streaming content' }],
        },
      ],
    })
  })

  test('unpinning a session reloads the first page so later pages do not duplicate it', async () => {
    const repository = new InMemorySessionRepository()
    const pinned = createTestSession('pinned-old')
    pinned.starred = true
    repository.sessions.set(pinned.id, pinned)
    repository.records.set(pinned.id, { ...createTestRecord(pinned, 35), starred: true })
    for (const sortOrder of [60, 50, 40, 30, 20]) {
      const session = createTestSession(`session-${sortOrder}`)
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, sortOrder))
    }
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)
    expect(
      queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)?.pages[0].items.map(({ id }) => id)
    ).toEqual(['pinned-old', 'session-60'])

    await service.updateSession(pinned.id, { starred: false })

    const cached = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    expect(cached?.pages).toHaveLength(1)
    expect(cached?.pages[0].items.map(({ id }) => id)).toEqual(['session-60', 'session-50'])
    expect(cached?.pages[0].nextCursor).toBe(2)

    const nextPage = await service.listSessionsMetaPage(cached?.pages[0].nextCursor ?? 0)
    const mergedIds = [...(cached?.pages[0].items ?? []), ...nextPage.items].map(({ id }) => id)
    expect(mergedIds).toEqual(['session-60', 'session-50', 'session-40', 'pinned-old'])
    expect(new Set(mergedIds).size).toBe(mergedIds.length)
  })

  test('name-only updates keep already loaded sessions instead of resetting to the first page', async () => {
    const repository = new InMemorySessionRepository()
    for (const sortOrder of [4, 3, 2, 1]) {
      const session = createTestSession(`session-${sortOrder}`)
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, sortOrder))
    }
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)
    const record = (id: string) => {
      const value = repository.records.get(id)
      if (!value) {
        throw new Error(`Missing session record ${id}`)
      }
      return value
    }
    queryClient.setQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList, {
      pages: [
        {
          items: [record('session-4'), record('session-3')],
          nextCursor: 2,
          total: 4,
        },
        {
          items: [record('session-2'), record('session-1')],
          nextCursor: null,
          total: 4,
        },
      ],
      pageParams: [0, 2],
    })

    await service.updateSession('session-4', { name: 'Renamed top session' })

    const cached = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    expect(cached?.pages[0].items.map(({ id }) => id)).toEqual(['session-4', 'session-3', 'session-2', 'session-1'])
    expect(cached?.pages[0].items[0].name).toBe('Renamed top session')
    expect(cached?.pages[0].nextCursor).toBeNull()
  })

  test('a stale pin-state refresh does not overwrite a newer list page', async () => {
    const repository = new InMemorySessionRepository()
    for (const [id, sortOrder] of [
      ['pinned-a', 20],
      ['pinned-b', 10],
    ] as const) {
      const session = createTestSession(id)
      session.starred = true
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, { ...createTestRecord(session, sortOrder), starred: true })
    }
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)

    let releaseFirstRead = () => {}
    const firstReadHeld = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    let firstReadStarted = () => {}
    const firstReadHasStarted = new Promise<void>((resolve) => {
      firstReadStarted = resolve
    })
    const originalListSessionsMetaPage = service.listSessionsMetaPage.bind(service)
    let refreshReads = 0
    vi.spyOn(service, 'listSessionsMetaPage').mockImplementation(async (cursor, limit) => {
      refreshReads += 1
      if (refreshReads === 1) {
        firstReadStarted()
        await firstReadHeld
        return {
          items: [
            { ...createTestRecord(createTestSession('pinned-a'), 20) },
            { ...createTestRecord(createTestSession('pinned-b'), 10), starred: true },
          ],
          nextCursor: null,
          total: 2,
        }
      }
      return originalListSessionsMetaPage(cursor, limit)
    })

    const firstUnpin = service.updateSession('pinned-a', { starred: false })
    await firstReadHasStarted
    const secondUnpin = service.updateSession('pinned-b', { starred: false })
    await vi.waitFor(() => expect(repository.records.get('pinned-b')?.starred).toBe(false))
    releaseFirstRead()
    await Promise.all([firstUnpin, secondUnpin])

    const cached = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    expect(cached?.pages[0].items.map(({ id, starred }) => ({ id, starred: Boolean(starred) }))).toEqual([
      { id: 'pinned-a', starred: false },
      { id: 'pinned-b', starred: false },
    ])
  })

  test('a pending pin-state refresh does not overwrite a later deletion', async () => {
    const repository = new InMemorySessionRepository()
    const pinned = createTestSession('pinned-old')
    pinned.starred = true
    repository.sessions.set(pinned.id, pinned)
    repository.records.set(pinned.id, { ...createTestRecord(pinned, 35), starred: true })
    for (const sortOrder of [60, 50]) {
      const session = createTestSession(`session-${sortOrder}`)
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, sortOrder))
    }
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)

    let releaseFirstRead = () => {}
    const firstReadHeld = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    let firstReadStarted = () => {}
    const firstReadHasStarted = new Promise<void>((resolve) => {
      firstReadStarted = resolve
    })
    const originalListSessionsMetaPage = service.listSessionsMetaPage.bind(service)
    let refreshReads = 0
    vi.spyOn(service, 'listSessionsMetaPage').mockImplementation(async (cursor, limit) => {
      refreshReads += 1
      if (refreshReads === 1) {
        firstReadStarted()
        await firstReadHeld
        return {
          items: [
            createTestRecord(createTestSession('session-60'), 60),
            createTestRecord(createTestSession('session-50'), 50),
          ],
          nextCursor: 2,
          total: 3,
        }
      }
      return originalListSessionsMetaPage(cursor, limit)
    })

    const unpin = service.updateSession(pinned.id, { starred: false })
    await firstReadHasStarted
    const deletion = service.deleteSession('session-60')
    await vi.waitFor(() => expect(repository.records.has('session-60')).toBe(false))
    releaseFirstRead()
    await Promise.all([unpin, deletion])

    const cached = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    expect(cached?.pages[0].items.map(({ id }) => id)).toEqual(['session-50', 'pinned-old'])
    expect(cached?.pages[0].items.some((item) => item.id === 'session-60')).toBe(false)
  })

  test('retries a failed pin-state list refresh before giving up', async () => {
    const repository = new InMemorySessionRepository()
    const pinned = createTestSession('pinned-old')
    pinned.starred = true
    repository.sessions.set(pinned.id, pinned)
    repository.records.set(pinned.id, { ...createTestRecord(pinned, 35), starred: true })
    for (const sortOrder of [60, 50, 40]) {
      const session = createTestSession(`session-${sortOrder}`)
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, sortOrder))
    }
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)
    const originalListSessionsMetaPage = service.listSessionsMetaPage.bind(service)
    let refreshReads = 0
    vi.spyOn(service, 'listSessionsMetaPage').mockImplementation(async (cursor, limit) => {
      refreshReads += 1
      if (refreshReads === 1) {
        throw new Error('transient list read failed')
      }
      return await originalListSessionsMetaPage(cursor, limit)
    })

    await service.updateSession(pinned.id, { starred: false })

    const cached = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    expect(cached?.pages[0].items.map(({ id }) => id)).toEqual(['session-60', 'session-50'])
    expect(cached?.pages[0].nextCursor).toBe(2)
    expect(queryClient.getQueryState(QueryKeys.ChatSessionsList)?.isInvalidated).toBe(false)
  })

  test('invalidates the list when pin-state refresh reads keep failing', async () => {
    const repository = new InMemorySessionRepository()
    const pinned = createTestSession('pinned-old')
    pinned.starred = true
    repository.sessions.set(pinned.id, pinned)
    repository.records.set(pinned.id, { ...createTestRecord(pinned, 35), starred: true })
    const regular = createTestSession('session-60')
    repository.sessions.set(regular.id, regular)
    repository.records.set(regular.id, createTestRecord(regular, 60))
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)
    const originalListSessionsMetaPage = service.listSessionsMetaPage.bind(service)
    let failReads = true
    vi.spyOn(service, 'listSessionsMetaPage').mockImplementation(async (cursor, limit) => {
      if (failReads) {
        throw new Error('persistent list read failed')
      }
      return await originalListSessionsMetaPage(cursor, limit)
    })

    await service.updateSession(pinned.id, { starred: false })

    expect(queryClient.getQueryState(QueryKeys.ChatSessionsList)?.isInvalidated).toBe(true)

    failReads = false
    const refetched = await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)
    expect(refetched.pages[0].items.map(({ id }) => id)).toEqual(['session-60', 'pinned-old'])
    expect(new Set(refetched.pages[0].items.map(({ id }) => id)).size).toBe(refetched.pages[0].items.length)
  })

  test('a session created after a loaded neighbor is inserted in place without a list reset', async () => {
    const repository = new InMemorySessionRepository()
    for (const sortOrder of [6000, 5000, 4000, 3000]) {
      const session = createTestSession(`session-${sortOrder}`)
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, sortOrder))
    }
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)
    const listReads = vi.spyOn(service, 'listSessionsMetaPage')

    const created = await service.createSession({ name: 'Copy', type: 'chat', messages: [] }, 'session-6000')

    const cached = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    expect(cached?.pages[0].items.map(({ id }) => id)).toEqual(['session-6000', created.id, 'session-5000'])
    expect(cached?.pages[0].nextCursor).toBe(3)
    expect(listReads).not.toHaveBeenCalled()

    const nextPage = await service.listSessionsMetaPage(cached?.pages[0].nextCursor ?? 0)
    const mergedIds = [...(cached?.pages[0].items ?? []), ...nextPage.items].map(({ id }) => id)
    expect(mergedIds).toEqual(['session-6000', created.id, 'session-5000', 'session-4000', 'session-3000'])
  })

  test('a session created after an unloaded predecessor reloads the first page', async () => {
    const repository = new InMemorySessionRepository()
    for (const sortOrder of [6000, 5000, 4000, 3000]) {
      const session = createTestSession(`session-${sortOrder}`)
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, sortOrder))
    }
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)

    const created = await service.createSession({ name: 'Copy', type: 'chat', messages: [] }, 'session-4000')

    // The copy lives beyond the loaded window, so the cache must stay a clean
    // first-page prefix instead of carrying the copy at the wrong offset.
    const cached = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    expect(cached?.pages).toHaveLength(1)
    expect(cached?.pages[0].items.map(({ id }) => id)).toEqual(['session-6000', 'session-5000'])
    expect(cached?.pages[0].nextCursor).toBe(2)

    const secondPage = await service.listSessionsMetaPage(2)
    const thirdPage = await service.listSessionsMetaPage(4)
    const mergedIds = [...(cached?.pages[0].items ?? []), ...secondPage.items, ...thirdPage.items].map(({ id }) => id)
    expect(mergedIds).toEqual(['session-6000', 'session-5000', 'session-4000', created.id, 'session-3000'])
  })

  test('a metadata update reschedules a pending created-session list refresh', async () => {
    const repository = new InMemorySessionRepository()
    for (const sortOrder of [6000, 5000, 4000, 3000]) {
      const session = createTestSession(`session-${sortOrder}`)
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, sortOrder))
    }
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)

    let releaseRefresh = () => {}
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let markRefreshStarted = () => {}
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve
    })
    const originalListSessionsMetaPage = service.listSessionsMetaPage.bind(service)
    let refreshReads = 0
    vi.spyOn(service, 'listSessionsMetaPage').mockImplementation(async (cursor, limit) => {
      refreshReads += 1
      if (refreshReads === 1) {
        const page = await originalListSessionsMetaPage(cursor, limit)
        markRefreshStarted()
        await refreshHeld
        return page
      }
      return await originalListSessionsMetaPage(cursor, limit)
    })

    const create = service.createSession({ name: 'Copy', type: 'chat', messages: [] }, 'session-4000')
    await refreshStarted
    const rename = service.updateSession('session-6000', { name: 'Renamed' })
    await vi.waitFor(() => expect(repository.records.get('session-6000')?.name).toBe('Renamed'))
    releaseRefresh()
    await Promise.all([create, rename])

    const cached = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    expect(cached?.pages[0].items.map(({ id }) => id)).toEqual(['session-6000', 'session-5000'])
    expect(cached?.pages[0].items[0].name).toBe('Renamed')
    expect(cached?.pages[0].nextCursor).toBe(2)
  })

  test('a new session reschedules a pending created-session list refresh', async () => {
    const repository = new InMemorySessionRepository()
    for (const sortOrder of [60, 50, 40, 30]) {
      const session = createTestSession(`session-${sortOrder}`)
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, sortOrder))
    }
    const events = new SessionEventBus()
    let nextId = 0
    const service = new SessionService(repository, new SessionWriteCoordinator(repository), events, {
      createId: () => `created-${++nextId}`,
      now: () => 100,
    })
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)

    let releaseFirstRefresh = () => {}
    const firstRefreshHeld = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve
    })
    let markFirstRefreshStarted = () => {}
    const firstRefreshStarted = new Promise<void>((resolve) => {
      markFirstRefreshStarted = resolve
    })
    const originalListSessionsMetaPage = service.listSessionsMetaPage.bind(service)
    let refreshReads = 0
    vi.spyOn(service, 'listSessionsMetaPage').mockImplementation(async (cursor, limit) => {
      refreshReads += 1
      if (refreshReads === 1) {
        markFirstRefreshStarted()
        await firstRefreshHeld
      }
      return await originalListSessionsMetaPage(cursor, limit)
    })

    const copy = service.createSession({ name: 'Copy', type: 'chat', messages: [] }, 'session-40')
    await firstRefreshStarted
    const createAtTop = service.createSession({ name: 'New', type: 'chat', messages: [] })
    await vi.waitFor(() => expect(repository.records.has('created-2')).toBe(true))
    releaseFirstRefresh()
    await Promise.all([copy, createAtTop])

    const cached = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    expect(cached?.pages[0].items.map(({ id }) => id)).toEqual(['created-2', 'session-60'])
    expect(cached?.pages[0].nextCursor).toBe(2)

    const secondPage = await service.listSessionsMetaPage(2)
    const thirdPage = await service.listSessionsMetaPage(4)
    const mergedIds = [...(cached?.pages[0].items ?? []), ...secondPage.items, ...thirdPage.items].map(({ id }) => id)
    expect(mergedIds).toEqual(['created-2', 'session-60', 'session-50', 'session-40', 'created-1', 'session-30'])
    expect(new Set(mergedIds).size).toBe(mergedIds.length)
  })

  test('a deletion reschedules a pending created-session list refresh', async () => {
    const repository = new InMemorySessionRepository()
    for (const sortOrder of [60, 50, 40, 30]) {
      const session = createTestSession(`session-${sortOrder}`)
      repository.sessions.set(session.id, session)
      repository.records.set(session.id, createTestRecord(session, sortOrder))
    }
    const events = new SessionEventBus()
    const service = createService(repository, events)
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, service, events)

    await queryClient.fetchInfiniteQuery(bridge.definitions.sessions)

    let releaseFirstRefresh = () => {}
    const firstRefreshHeld = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve
    })
    let markFirstRefreshStarted = () => {}
    const firstRefreshStarted = new Promise<void>((resolve) => {
      markFirstRefreshStarted = resolve
    })
    const originalListSessionsMetaPage = service.listSessionsMetaPage.bind(service)
    let refreshReads = 0
    vi.spyOn(service, 'listSessionsMetaPage').mockImplementation(async (cursor, limit) => {
      refreshReads += 1
      if (refreshReads === 1) {
        markFirstRefreshStarted()
        await firstRefreshHeld
      }
      return await originalListSessionsMetaPage(cursor, limit)
    })

    const copy = service.createSession({ name: 'Copy', type: 'chat', messages: [] }, 'session-40')
    await firstRefreshStarted
    const deletion = service.deleteSession('session-60')
    await vi.waitFor(() => expect(repository.records.has('session-60')).toBe(false))
    releaseFirstRefresh()
    await Promise.all([copy, deletion])

    const cached = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
    expect(cached?.pages[0].items.map(({ id }) => id)).toEqual(['session-50', 'session-40'])
    expect(cached?.pages[0].nextCursor).toBe(2)

    const secondPage = await service.listSessionsMetaPage(2)
    const mergedIds = [...(cached?.pages[0].items ?? []), ...secondPage.items].map(({ id }) => id)
    expect(mergedIds).toEqual(['session-50', 'session-40', 'created', 'session-30'])
    expect(new Set(mergedIds).size).toBe(mergedIds.length)
  })
})

describe('applySessionListUpdate', () => {
  test('dedupes overlapping pages and advances the cursor from the unique prefix', () => {
    const first = createTestRecord(createTestSession('session-1'), 1)
    const second = createTestRecord(createTestSession('session-2'), 2)
    const updated = applySessionListUpdate(
      {
        pages: [
          { items: [second, first], nextCursor: 2, total: 3 },
          { items: [first], nextCursor: 3, total: 3 },
        ],
        pageParams: [0, 2],
      },
      (items) => items
    )

    expect(updated).toEqual({
      pages: [
        {
          items: [second, first],
          nextCursor: 2,
          total: 3,
        },
      ],
      pageParams: [0],
    })
  })
})
