import { describe, expect, test, vi } from 'vitest'
import { createTestRecord, createTestSession, MemorySessionRepository } from './__tests__/memory-session-repository'
import { SessionService } from './SessionService'
import { SessionNotFoundError, SessionWriteCoordinator } from './SessionWriteCoordinator'
import { type SessionApplicationEvent, SessionEventBus } from './session-events'

function createHarness(
  repairSessionOnRead?: (session: ReturnType<typeof createTestSession>) => {
    session: ReturnType<typeof createTestSession>
    changed: boolean
  }
) {
  const repository = new MemorySessionRepository()
  const events = new SessionEventBus()
  const published: SessionApplicationEvent[] = []
  events.subscribe((event) => {
    published.push(event)
  })
  const writes = new SessionWriteCoordinator(repository)
  const log = vi.fn()
  const service = new SessionService(repository, writes, events, {
    createId: () => 'created-session',
    logger: { log },
    now: () => 100,
    getLastUsedModels: () => ({
      chat: { provider: 'openai', modelId: 'last-used-model' },
    }),
    repairSessionOnRead,
  })
  return { repository, events, log, published, service }
}

describe('SessionService', () => {
  test('logs session read failures before rethrowing the repository error', async () => {
    const harness = createHarness()
    const error = new Error('read failed')
    vi.spyOn(harness.repository, 'getSession').mockRejectedValue(error)

    await expect(harness.service.getSession('session-1')).rejects.toBe(error)
    expect(harness.log).toHaveBeenCalledWith(
      'error',
      'Failed to read session from repository',
      expect.objectContaining({
        sessionId: 'session-1',
        error: expect.objectContaining({ name: 'Error', message: 'read failed' }),
      })
    )
  })

  test('logs session-list page read failures before rethrowing', async () => {
    const harness = createHarness()
    const error = new Error('page failed')
    vi.spyOn(harness.repository.meta, 'getPage').mockRejectedValue(error)

    await expect(harness.service.listSessionsMetaPage(20, 10)).rejects.toBe(error)
    expect(harness.log).toHaveBeenCalledWith(
      'error',
      'Failed to read session list page from repository',
      expect.objectContaining({ cursor: 20, limit: 10 })
    )
  })

  test('persists read repairs through the write coordinator and publishes the repaired session', async () => {
    const harness = createHarness((session) => ({
      session: session.name === 'Recovered' ? session : { ...session, name: 'Recovered' },
      changed: session.name !== 'Recovered',
    }))
    const persisted = createTestSession('session-1')
    harness.repository.sessions.set(persisted.id, persisted)
    const setSession = vi.spyOn(harness.repository, 'setSession')

    await expect(harness.service.getSession(persisted.id)).resolves.toMatchObject({ name: 'Recovered' })

    expect(setSession).toHaveBeenCalledOnce()
    expect(harness.repository.sessions.get(persisted.id)?.name).toBe('Recovered')
    expect(harness.published.at(-1)).toMatchObject({
      type: 'session-updated',
      session: { id: persisted.id, name: 'Recovered' },
      meta: null,
      preserveCachedGeneratingMessages: true,
    })

    await harness.service.getSession(persisted.id)
    expect(setSession).toHaveBeenCalledOnce()
  })

  test('logs each unreadable session and a recovery summary', async () => {
    const harness = createHarness()
    const readable = createTestSession('readable')
    vi.spyOn(harness.repository, 'getAllSessionIds').mockResolvedValue(['unreadable', 'readable'])
    vi.spyOn(harness.repository, 'getSession').mockImplementation((sessionId) => {
      if (sessionId === 'unreadable') return Promise.reject(new Error('large IndexedDB value'))
      return Promise.resolve(readable)
    })

    await expect(harness.service.recoverSessionList()).resolves.toEqual({ recovered: 1, failed: 1 })
    expect(harness.log).toHaveBeenCalledWith(
      'error',
      'Failed to read session during session-list recovery',
      expect.objectContaining({ sessionId: 'unreadable' })
    )
    expect(harness.log).toHaveBeenCalledWith('warn', 'Failed to recover sessions due to read errors', {
      failed: 1,
      sessionIds: ['unreadable'],
    })
  })

  test('creates full session data and meta before publishing a precise event', async () => {
    const harness = createHarness()

    const created = await harness.service.createSession({
      name: 'Created',
      type: 'chat',
      messages: [],
      settings: { temperature: 0.3 },
    })

    expect(created.threadName).toBe('')
    expect(created.settings).toEqual({
      provider: 'openai',
      modelId: 'last-used-model',
      temperature: 0.3,
    })
    expect(harness.repository.sessions.get(created.id)).toBe(created)
    expect(harness.repository.records.get(created.id)).toMatchObject({
      id: created.id,
      sortOrder: 100,
      createdAt: 100,
    })
    expect(harness.published.at(-1)).toMatchObject({ type: 'session-created', session: created })
  })

  test('places a created session between its predecessor and the repository successor', async () => {
    const harness = createHarness()
    for (const sortOrder of [6000, 5000, 4000]) {
      const session = createTestSession(`session-${sortOrder}`)
      harness.repository.sessions.set(session.id, session)
      harness.repository.records.set(session.id, createTestRecord(session, sortOrder))
    }

    const created = await harness.service.createSession({ name: 'Copy', type: 'chat', messages: [] }, 'session-5000')

    expect(harness.repository.records.get(created.id)?.sortOrder).toBe(4500)
    expect((await harness.repository.meta.getAll()).map(({ id }) => id)).toEqual([
      'session-6000',
      'session-5000',
      created.id,
      'session-4000',
    ])
  })

  test('keeps a copy of the last pinned session inside the pinned group', async () => {
    const harness = createHarness()
    for (const [id, sortOrder, starred] of [
      ['pinned-a', 3000, true],
      ['pinned-b', 2000, true],
      ['chat-recent', 10000, false],
    ] as const) {
      const session = { ...createTestSession(id), ...(starred ? { starred } : {}) }
      harness.repository.sessions.set(session.id, session)
      harness.repository.records.set(session.id, {
        ...createTestRecord(session, sortOrder),
        ...(starred ? { starred } : {}),
      })
    }

    const created = await harness.service.createSession(
      { name: 'Copy', type: 'chat', messages: [], starred: true },
      'pinned-b'
    )

    expect(harness.repository.records.get(created.id)?.sortOrder).toBe(0)
    expect((await harness.repository.meta.getAll()).map(({ id }) => id)).toEqual([
      'pinned-a',
      'pinned-b',
      created.id,
      'chat-recent',
    ])
  })

  test('uses the opposite pin group as a numeric lower bound', async () => {
    const harness = createHarness()
    const pinned = { ...createTestSession('pinned'), starred: true }
    harness.repository.sessions.set(pinned.id, pinned)
    harness.repository.records.set(pinned.id, { ...createTestRecord(pinned, 5000), starred: true })
    const regular = createTestSession('regular')
    harness.repository.sessions.set(regular.id, regular)
    harness.repository.records.set(regular.id, createTestRecord(regular, 3000))

    const created = await harness.service.createSession(
      { name: 'Copy', type: 'chat', messages: [], starred: true },
      pinned.id
    )

    expect(harness.repository.records.get(created.id)?.sortOrder).toBe(4000)
    expect((await harness.repository.meta.getAll()).map(({ id }) => id)).toEqual([pinned.id, created.id, regular.id])
  })

  test('midpoints against a hidden record below a predecessor with no visible successor', async () => {
    const harness = createHarness()
    const visible = createTestSession('visible')
    harness.repository.sessions.set(visible.id, visible)
    harness.repository.records.set(visible.id, createTestRecord(visible, 5000))
    const archived = createTestSession('archived')
    harness.repository.sessions.set(archived.id, { ...archived, hidden: true, archivedAt: 1 })
    harness.repository.records.set(archived.id, { ...createTestRecord(archived, 3000), hidden: true, archivedAt: 1 })

    const created = await harness.service.createSession({ name: 'Copy', type: 'chat', messages: [] }, 'visible')

    expect(harness.repository.records.get(created.id)?.sortOrder).toBe(4000)
  })

  test('midpoints against a hidden record between the predecessor and its visible successor', async () => {
    const harness = createHarness()
    for (const [id, sortOrder, hidden] of [
      ['top', 5000, false],
      ['archived', 4000, true],
      ['bottom', 3000, false],
    ] as const) {
      const session = { ...createTestSession(id), ...(hidden ? { hidden, archivedAt: 1 } : {}) }
      harness.repository.sessions.set(session.id, session)
      harness.repository.records.set(session.id, {
        ...createTestRecord(session, sortOrder),
        ...(hidden ? { hidden, archivedAt: 1 } : {}),
      })
    }

    const created = await harness.service.createSession({ name: 'Copy', type: 'chat', messages: [] }, 'top')

    expect(harness.repository.records.get(created.id)?.sortOrder).toBe(4500)
  })

  test('places a created session below a predecessor with no successor', async () => {
    const harness = createHarness()
    const only = createTestSession('only')
    harness.repository.sessions.set(only.id, only)
    harness.repository.records.set(only.id, createTestRecord(only, 5000))

    const created = await harness.service.createSession({ name: 'Copy', type: 'chat', messages: [] }, 'only')

    expect(harness.repository.records.get(created.id)?.sortOrder).toBe(3000)
  })

  test('falls back to the top of the list when the predecessor is not visible', async () => {
    const harness = createHarness()

    const created = await harness.service.createSession({ name: 'Copy', type: 'chat', messages: [] }, 'missing')

    expect(harness.repository.records.get(created.id)?.sortOrder).toBe(100)
  })

  test('keeps an explicit thread title on create instead of marking the session pending', async () => {
    const harness = createHarness()

    const created = await harness.service.createSession({
      name: 'Weekend trip',
      type: 'chat',
      threadName: 'Weekend trip',
      messages: [],
    })

    expect(created.threadName).toBe('Weekend trip')
  })

  test('does not report a committed create as failed when a post-event listener rejects', async () => {
    const harness = createHarness()
    harness.events.subscribe((event) => {
      if (event.type === 'session-created') {
        return Promise.reject(new Error('subscriber failed'))
      }
    })

    const created = await harness.service.createSession({
      name: 'Created',
      type: 'chat',
      messages: [],
      settings: {},
    })

    expect(harness.repository.sessions.get(created.id)).toBe(created)
    expect(harness.repository.records.has(created.id)).toBe(true)
  })

  test('archives and restores full data and meta together', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    harness.repository.sessions.set(session.id, session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))

    await harness.service.archiveSession(session.id)
    expect(harness.repository.sessions.get(session.id)).toMatchObject({ hidden: true, archivedAt: 100 })
    expect(harness.repository.records.get(session.id)).toMatchObject({ hidden: true, archivedAt: 100 })

    await harness.service.restoreSession(session.id)
    expect(harness.repository.sessions.get(session.id)?.hidden).toBe(false)
    expect(harness.repository.sessions.get(session.id)?.archivedAt).toBeUndefined()
    expect(harness.repository.records.get(session.id)?.hidden).toBe(false)
    expect(harness.repository.records.get(session.id)?.archivedAt).toBeUndefined()
  })

  test('deletes persistence only after awaited pre-delete effects', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    harness.repository.sessions.set(session.id, session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))
    const order: string[] = []
    harness.events.subscribe((event) => {
      if (event.type === 'session-will-delete') {
        throw new Error('best-effort cleanup failed')
      }
    })
    harness.events.subscribe(async (event) => {
      if (event.type === 'session-will-delete') {
        await Promise.resolve()
        order.push('effect')
      }
      if (event.type === 'session-deleted') {
        order.push('deleted')
      }
    })
    const deleteSpy = vi.spyOn(harness.repository, 'deleteSession').mockImplementation((id) => {
      order.push('storage')
      harness.repository.sessions.delete(id)
      return Promise.resolve()
    })

    await harness.service.deleteSession(session.id)

    expect(deleteSpy).toHaveBeenCalledWith(session.id)
    expect(order).toEqual(['effect', 'storage', 'deleted'])
    expect(harness.repository.records.has(session.id)).toBe(false)
  })

  test('rejects writes that start after deletion begins and never resurrects the session', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    harness.repository.sessions.set(session.id, session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))
    let releasePreDelete: () => void = () => undefined
    const preDeleteBlocked = new Promise<void>((resolve) => {
      releasePreDelete = resolve
    })
    let preDeleteStarted: () => void = () => undefined
    const preDeleteStartedPromise = new Promise<void>((resolve) => {
      preDeleteStarted = resolve
    })
    harness.events.subscribe(async (event) => {
      if (event.type !== 'session-will-delete') return
      preDeleteStarted()
      await preDeleteBlocked
    })

    const deletion = harness.service.deleteSession(session.id)
    await preDeleteStartedPromise

    await expect(harness.service.updateSession(session.id, { name: 'late write' })).rejects.toBeInstanceOf(
      SessionNotFoundError
    )
    releasePreDelete()
    await deletion

    expect(harness.repository.sessions.has(session.id)).toBe(false)
    expect(harness.repository.records.has(session.id)).toBe(false)
  })

  test('does not resurrect a session when metadata deletion fails after full-session deletion', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    harness.repository.sessions.set(session.id, session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))
    await harness.service.updateSession(session.id, { name: 'Cached before delete' })
    vi.spyOn(harness.repository.meta, 'delete').mockRejectedValueOnce(new Error('metadata deletion failed'))

    await expect(harness.service.deleteSession(session.id)).rejects.toThrow('metadata deletion failed')
    await expect(harness.service.updateSession(session.id, { name: 'Must not revive' })).rejects.toBeInstanceOf(
      SessionNotFoundError
    )

    expect(harness.repository.sessions.has(session.id)).toBe(false)
    expect(harness.repository.records.has(session.id)).toBe(true)
  })

  test('keeps writes fenced until every started bulk deletion settles', async () => {
    const harness = createHarness()
    const failed = createTestSession('failed')
    const delayed = createTestSession('delayed')
    for (const session of [failed, delayed]) {
      harness.repository.sessions.set(session.id, session)
      harness.repository.records.set(session.id, createTestRecord(session, 1))
      await harness.service.updateSession(session.id, { name: `Cached ${session.id}` })
    }

    let releaseDelayedDelete: () => void = () => undefined
    const delayedDeleteBlocked = new Promise<void>((resolve) => {
      releaseDelayedDelete = resolve
    })
    let delayedDeleteStarted: () => void = () => undefined
    const delayedDeleteStartedPromise = new Promise<void>((resolve) => {
      delayedDeleteStarted = resolve
    })
    const originalDeleteSession = harness.repository.deleteSession.bind(harness.repository)
    vi.spyOn(harness.repository, 'deleteSession').mockImplementation(async (sessionId) => {
      if (sessionId === failed.id) throw new Error('bulk deletion failed')
      delayedDeleteStarted()
      await delayedDeleteBlocked
      await originalDeleteSession(sessionId)
    })

    const deletionResult = harness.service.deleteSessions([failed.id, delayed.id]).then(
      () => undefined,
      (error: unknown) => error
    )
    await delayedDeleteStartedPromise
    await Promise.resolve()
    await Promise.resolve()

    await expect(harness.service.updateSession(delayed.id, { name: 'Must remain fenced' })).rejects.toBeInstanceOf(
      SessionNotFoundError
    )
    releaseDelayedDelete()

    await expect(deletionResult).resolves.toEqual(expect.objectContaining({ message: 'bulk deletion failed' }))
    expect(harness.repository.sessions.has(delayed.id)).toBe(false)
  })
})
