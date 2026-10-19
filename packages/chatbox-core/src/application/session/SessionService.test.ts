import { describe, expect, test, vi } from 'vitest'
import { createTestRecord, createTestSession, InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { Session } from '../../types'
import { SessionService } from './SessionService'
import { SessionNotFoundError, SessionWriteCoordinator } from './SessionWriteCoordinator'
import { type SessionApplicationEvent, SessionEventBus } from './session-events'

function createHarness() {
  const repository = new InMemorySessionRepository()
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
  })
  return { repository, events, log, published, service, writes }
}

describe('SessionService', () => {
  test('saves folders, lists pages in folder order and files sessions', async () => {
    const { repository, published, service } = createHarness()
    const saved: unknown[] = []
    const folderService = new SessionService(repository, new SessionWriteCoordinator(repository), service.events, {
      createId: () => 'id',
      now: () => 100,
      folders: {
        load: () => Promise.resolve([]),
        save: (folders) => {
          saved.push(folders)
          return Promise.resolve()
        },
      },
    })
    for (const [id, sortOrder] of [
      ['a', 3],
      ['b', 2],
      ['c', 1],
    ] as const) {
      const session = createTestSession(id)
      await repository.seedSession(session)
      repository.records.set(id, createTestRecord(session, sortOrder))
    }

    await folderService.saveSessionFolders([{ id: 'f', name: 'Folder' }])
    expect(saved).toEqual([[{ id: 'f', name: 'Folder' }]])
    expect(published.map((event) => event.type)).toEqual(['session-folders-changed', 'session-list-reset'])

    await folderService.moveSessionToFolder('c', 'f')
    expect((await repository.getSessionHeader('c'))?.header.folderId).toBe('f')
    expect(repository.records.get('c')?.folderId).toBe('f')
    expect((await folderService.listSessionsMetaPage(0, 3)).items.map((item) => item.id)).toEqual(['c', 'a', 'b'])

    // Deleting a folder leaves the session untouched; it is listed as unfiled again.
    await folderService.saveSessionFolders([])
    expect(repository.records.get('c')?.folderId).toBe('f')
    expect((await folderService.listSessionsMetaPage(0, 3)).items.map((item) => item.id)).toEqual(['a', 'b', 'c'])

    await folderService.moveSessionToFolder('a', undefined, 0)
    expect(repository.records.get('a')?.folderId).toBeUndefined()
    expect(repository.records.get('a')?.sortOrder).toBe(0)
  })

  test('does not create or reorder sessions while backup storage access is active', async () => {
    const { service, writes } = createHarness()
    const session = await service.createSession({ name: 'Original', type: 'chat', messages: [] })
    await writes.withBackupAccess(async () => {
      await expect(service.createSession({ name: 'New', type: 'chat', messages: [] })).rejects.toMatchObject({
        name: 'BackupOperationBusyError',
      })
      await expect(service.updateSessionSortOrder(session.id, 200)).rejects.toMatchObject({
        name: 'BackupOperationBusyError',
      })
    })
    expect((await service.getSessionHeader(session.id))?.header.name).toBe('Original')
  })

  test('reads a session header and summaries without hydrating message payloads', async () => {
    const harness = createHarness()
    await harness.repository.seedSession({
      ...createTestSession('header'),
      messages: [{ id: 'message', role: 'user', contentParts: [{ type: 'text', text: 'body' }] }],
    })
    const payloads = vi.spyOn(harness.repository.rowStore, 'readMessages')
    const mutation = vi.spyOn(harness.repository.rowStore, 'applyDiff')
    expect(await harness.service.getSessionHeader('header')).toMatchObject({
      header: { id: 'header', name: 'header' },
      summary: { messageCount: 1 },
      revision: 1,
    })
    expect(payloads).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
    expect(harness.published).toEqual([])
  })

  test('publishes the precise local command delta for message and header writes', async () => {
    const harness = createHarness()
    const session = {
      ...createTestSession('session-1'),
      messages: [{ id: 'assistant-1', role: 'assistant' as const, contentParts: [] }],
    }
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))
    await harness.service.updateMessage(session.id, 'assistant-1', { generating: false })
    await harness.service.insertMessage(session.id, { id: 'user-2', role: 'user', contentParts: [] })
    await harness.service.removeMessage(session.id, 'user-2')
    await harness.service.updateSessionHeader(session.id, { name: 'Renamed' })
    const committed = harness.published.filter((event) => event.type === 'session-command-committed')
    expect(committed).toHaveLength(4)
    expect(committed[0].delta.diff.messages.upsert?.map((row) => row.messageId)).toEqual(['assistant-1'])
    expect(committed[1].delta.appendedMessageIds).toEqual(['user-2'])
    expect(committed[2].delta.diff.messages.delete).toContain('user-2')
    expect(committed[3].delta.header.name).toBe('Renamed')
    expect(committed[3].delta.diff.messages.upsert ?? []).toEqual([])
  })

  test('logs session read failures before rethrowing the repository error', async () => {
    const harness = createHarness()
    const error = new Error('read failed')
    vi.spyOn(harness.repository, 'getSessionHeader').mockRejectedValue(error)

    await expect(harness.service.getSessionHeader('session-1')).rejects.toBe(error)
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

  test('logs each unreadable session and a recovery summary', async () => {
    const harness = createHarness()
    const readable = createTestSession('readable')
    await harness.repository.seedSession(readable)
    const read = await harness.repository.getSessionHeader(readable.id)
    vi.spyOn(harness.repository, 'getAllSessionIds').mockResolvedValue(['unreadable', 'readable'])
    vi.spyOn(harness.repository, 'getSessionHeader').mockImplementation((sessionId) => {
      if (sessionId === 'unreadable') return Promise.reject(new Error('large IndexedDB value'))
      return Promise.resolve(read)
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

  test('creates session rows and meta before publishing a precise event', async () => {
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
    expect(harness.repository.inspectSession(created.id)).toMatchObject(created)
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
      await harness.repository.seedSession(session)
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
      await harness.repository.seedSession(session)
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
    await harness.repository.seedSession(pinned)
    harness.repository.records.set(pinned.id, { ...createTestRecord(pinned, 5000), starred: true })
    const regular = createTestSession('regular')
    await harness.repository.seedSession(regular)
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
    await harness.repository.seedSession(visible)
    harness.repository.records.set(visible.id, createTestRecord(visible, 5000))
    const archived = createTestSession('archived')
    await harness.repository.seedSession({ ...archived, hidden: true, archivedAt: 1 })
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
      await harness.repository.seedSession(session)
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
    await harness.repository.seedSession(only)
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

    expect(harness.repository.inspectSession(created.id)).toMatchObject(created)
    expect(harness.repository.records.has(created.id)).toBe(true)
  })

  test('archives and restores the header and meta together', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))

    await harness.service.archiveSession(session.id)
    expect(harness.repository.inspectSession(session.id)).toMatchObject({ hidden: true, archivedAt: 100 })
    expect(harness.repository.records.get(session.id)).toMatchObject({ hidden: true, archivedAt: 100 })
    expect(harness.repository.records.get(session.id)?.recoveryArchived).toBeUndefined()

    await harness.service.restoreSession(session.id)
    expect(harness.repository.inspectSession(session.id)?.hidden).toBe(false)
    expect(harness.repository.inspectSession(session.id)?.archivedAt).toBeUndefined()
    expect(harness.repository.records.get(session.id)?.hidden).toBe(false)
    expect(harness.repository.records.get(session.id)?.archivedAt).toBeUndefined()
  })

  test.each(['archiveSession', 'restoreSession'] as const)(
    '%s rejects a row command failure and retains the persisted state',
    async (operation) => {
      const harness = createHarness()
      const session = {
        ...createTestSession('session-1'),
        hidden: operation === 'restoreSession',
        archivedAt: operation === 'restoreSession' ? 50 : undefined,
      }
      const record = {
        ...createTestRecord(session, 1),
        hidden: session.hidden,
        archivedAt: session.archivedAt,
      }
      await harness.repository.seedSession(session)
      harness.repository.records.set(session.id, record)
      const writeError = new Error('row command failed')
      vi.spyOn(harness.repository, 'executeSessionCommand').mockRejectedValueOnce(writeError)
      const updateMeta = vi.spyOn(harness.repository.meta, 'update')

      await expect(harness.service[operation](session.id)).rejects.toBe(writeError)

      expect(harness.repository.inspectSession(session.id)).toEqual(session)
      expect(harness.repository.records.get(session.id)).toEqual(record)
      expect(updateMeta).not.toHaveBeenCalled()
      expect(harness.published).toEqual([])
    }
  )

  test.each([
    ['archiveSession', 'getPage'],
    ['archiveSession', 'getArchivedPage'],
    ['restoreSession', 'getPage'],
    ['restoreSession', 'getArchivedPage'],
  ] as const)('%s resolves when the committed state is followed by a %s failure', async (operation, pageMethod) => {
    const harness = createHarness()
    const session = {
      ...createTestSession('session-1'),
      hidden: operation === 'restoreSession',
      archivedAt: operation === 'restoreSession' ? 50 : undefined,
    }
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, {
      ...createTestRecord(session, 1),
      hidden: session.hidden,
      archivedAt: session.archivedAt,
    })
    const pageError = new Error('list page failed')
    vi.spyOn(harness.repository.meta, pageMethod).mockRejectedValueOnce(pageError)
    const executeCommand = vi.spyOn(harness.repository, 'executeSessionCommand')

    await expect(harness.service[operation](session.id)).resolves.toBeUndefined()

    const expected = {
      hidden: operation === 'archiveSession',
      archivedAt: operation === 'archiveSession' ? 100 : undefined,
    }
    expect(harness.repository.inspectSession(session.id)).toMatchObject(expected)
    expect(harness.repository.records.get(session.id)).toMatchObject(expected)
    expect(executeCommand).toHaveBeenCalledOnce()
    expect(harness.published).toContainEqual(
      expect.objectContaining({
        type: 'session-command-committed',
        delta: expect.objectContaining({ header: expect.objectContaining(expected) }),
      })
    )
    expect(harness.log).toHaveBeenCalledWith(
      'warn',
      'Failed to refresh session lists after archive state was committed',
      expect.objectContaining({ sessionId: session.id, error: expect.objectContaining({ message: pageError.message }) })
    )
  })

  test.each([
    ['archiveSession', 'throw'],
    ['archiveSession', 'reject'],
    ['restoreSession', 'throw'],
    ['restoreSession', 'reject'],
  ] as const)('%s stays successful when the failure logger uses %s', async (operation, failureMode) => {
    const harness = createHarness()
    const session = {
      ...createTestSession('session-1'),
      hidden: operation === 'restoreSession',
      archivedAt: operation === 'restoreSession' ? 50 : undefined,
    }
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, {
      ...createTestRecord(session, 1),
      hidden: session.hidden,
      archivedAt: session.archivedAt,
    })
    vi.spyOn(harness.repository.meta, 'getArchivedPage').mockRejectedValueOnce(new Error('list page failed'))
    harness.log.mockImplementation(() => {
      const error = new Error('logger failed')
      if (failureMode === 'throw') throw error
      return Promise.reject(error)
    })

    await expect(harness.service[operation](session.id)).resolves.toBeUndefined()

    const expected = {
      hidden: operation === 'archiveSession',
      archivedAt: operation === 'archiveSession' ? 100 : undefined,
    }
    expect(harness.repository.inspectSession(session.id)).toMatchObject(expected)
    expect(harness.repository.records.get(session.id)).toMatchObject(expected)
    expect(harness.log).toHaveBeenCalledWith(
      'warn',
      'Failed to refresh session lists after archive state was committed',
      expect.objectContaining({ sessionId: session.id })
    )
  })

  test('repairs a restored recovery archive after its metadata projection fails', async () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness()
      const session = createTestSession('session-1')
      await harness.repository.seedSession(session)
      harness.repository.records.set(session.id, createTestRecord(session, 1))
      await harness.service.archiveSessionWithoutLoading(session.id)
      expect(harness.repository.records.get(session.id)).toMatchObject({
        hidden: true,
        archivedAt: 100,
        recoveryArchived: true,
      })
      harness.published.length = 0
      const metadataError = new Error('metadata update failed')
      const updateMeta = vi.spyOn(harness.repository.meta, 'update').mockRejectedValueOnce(metadataError)
      const executeCommand = vi.spyOn(harness.repository, 'executeSessionCommand')

      await expect(harness.service.restoreSession(session.id)).resolves.toBeUndefined()

      expect(harness.repository.inspectSession(session.id)).toMatchObject({ hidden: false })
      expect(harness.repository.inspectSession(session.id)?.archivedAt).toBeUndefined()
      expect(harness.repository.records.get(session.id)).toMatchObject({
        hidden: true,
        archivedAt: 100,
        recoveryArchived: true,
      })
      expect(harness.published).toEqual([
        expect.objectContaining({
          type: 'session-command-committed',
          delta: expect.objectContaining({ header: expect.objectContaining({ hidden: false }) }),
          meta: null,
          metaRevision: null,
        }),
      ])
      expect(harness.log).toHaveBeenCalledWith(
        'warn',
        'Session rows committed; metadata projection will be retried',
        expect.objectContaining({ sessionId: session.id })
      )

      await vi.advanceTimersByTimeAsync(1000)

      expect(updateMeta).toHaveBeenCalledTimes(2)
      expect(executeCommand).toHaveBeenCalledOnce()
      expect(harness.repository.records.get(session.id)?.hidden).toBe(false)
      expect(harness.repository.records.get(session.id)?.archivedAt).toBeUndefined()
      expect(harness.repository.records.get(session.id)?.recoveryArchived).toBeUndefined()
      expect(harness.published.at(-1)).toMatchObject({
        type: 'session-list-reset',
        visible: { items: [{ id: session.id, hidden: false }] },
        archived: { items: [] },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  test('archives an unreadable session through metadata without loading its full record', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))
    const getSession = vi.spyOn(harness.repository, 'getSessionHeader').mockRejectedValue(new Error('read failed'))
    const executeCommand = vi.spyOn(harness.repository, 'executeSessionCommand')

    await harness.service.archiveSessionWithoutLoading(session.id)

    expect(getSession).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
    expect(harness.repository.inspectSession(session.id)).not.toHaveProperty('archivedAt')
    expect(harness.repository.records.get(session.id)).toMatchObject({
      hidden: true,
      archivedAt: 100,
      recoveryArchived: true,
    })
    expect(harness.published.at(-1)).toMatchObject({
      type: 'session-list-reset',
      visible: { items: [] },
      archived: { items: [{ id: session.id }] },
    })
  })

  test('restores a recovery archive through metadata without loading its full record', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))
    await harness.service.archiveSessionWithoutLoading(session.id)
    const getSession = vi.spyOn(harness.repository, 'getSessionHeader').mockRejectedValue(new Error('read failed'))
    const executeCommand = vi.spyOn(harness.repository, 'executeSessionCommand')

    await harness.service.restoreSessionWithoutLoading(session.id)

    expect(getSession).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
    expect(harness.repository.inspectSession(session.id)).not.toHaveProperty('archivedAt')
    expect(harness.repository.records.get(session.id)).toMatchObject({ hidden: false })
    expect(harness.repository.records.get(session.id)?.archivedAt).toBeUndefined()
    expect(harness.repository.records.get(session.id)?.recoveryArchived).toBeUndefined()
    expect(harness.published.at(-1)).toMatchObject({
      type: 'session-list-reset',
      visible: { items: [{ id: session.id }] },
      archived: { items: [] },
    })
  })

  test('preserves a metadata-only archive when rebuilding the session list', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))

    await harness.service.archiveSessionWithoutLoading(session.id)
    await expect(harness.service.recoverSessionList()).resolves.toEqual({ recovered: 1, failed: 0 })

    expect(harness.repository.records.get(session.id)).toMatchObject({
      hidden: true,
      archivedAt: 100,
      recoveryArchived: true,
    })
  })

  test('clears the recovery archive marker when the session header is restored', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))
    await harness.service.archiveSessionWithoutLoading(session.id)

    await harness.service.restoreSession(session.id)

    expect(harness.repository.inspectSession(session.id)?.hidden).toBe(false)
    expect(harness.repository.records.get(session.id)?.hidden).toBe(false)
    expect(harness.repository.records.get(session.id)?.recoveryArchived).toBeUndefined()
  })

  test('does not preserve an ordinary archived projection over the readable header', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, {
      ...createTestRecord(session, 1),
      hidden: true,
      archivedAt: 50,
    })

    await expect(harness.service.recoverSessionList()).resolves.toEqual({ recovered: 1, failed: 0 })

    expect(harness.repository.records.get(session.id)).not.toHaveProperty('archivedAt')
    expect(harness.repository.records.get(session.id)?.recoveryArchived).toBeUndefined()
  })

  test('retains archived metadata for an unreadable session when rebuilding the session list', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))
    await harness.service.archiveSessionWithoutLoading(session.id)
    vi.spyOn(harness.repository, 'getSessionHeader').mockRejectedValue(new Error('read failed'))

    await expect(harness.service.recoverSessionList()).resolves.toEqual({ recovered: 0, failed: 1 })

    expect(harness.repository.records.get(session.id)).toMatchObject({
      hidden: true,
      archivedAt: 100,
      recoveryArchived: true,
    })
  })

  test('rebuilds readable metadata when the archived metadata snapshot cannot be read', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
    vi.spyOn(harness.repository.meta, 'getAllIncludingHidden').mockRejectedValue(new Error('meta read failed'))

    await expect(harness.service.recoverSessionList()).resolves.toEqual({ recovered: 1, failed: 0 })

    expect(harness.repository.records.get(session.id)).toMatchObject({ id: session.id })
    expect(harness.repository.records.get(session.id)).not.toHaveProperty('archivedAt')
    expect(harness.log).toHaveBeenCalledWith(
      'warn',
      'Failed to preserve archived metadata during session-list recovery',
      expect.objectContaining({ error: expect.objectContaining({ message: 'meta read failed' }) })
    )
  })

  test('updates sort order in session metadata and refreshes the visible list', async () => {
    const harness = createHarness()
    const first = createTestSession('session-1')
    const second = createTestSession('session-2')
    for (const [index, session] of [first, second].entries()) {
      await harness.repository.seedSession(session)
      harness.repository.records.set(session.id, createTestRecord(session, index + 1))
    }

    await expect(harness.service.updateSessionSortOrder(first.id, 3000)).resolves.toMatchObject({
      id: first.id,
      sortOrder: 3000,
    })

    expect(harness.repository.records.get(first.id)?.sortOrder).toBe(3000)
    expect(harness.published.at(-1)).toMatchObject({
      type: 'session-list-reset',
      visible: { items: [{ id: first.id }, { id: second.id }] },
    })
  })

  test('rejects sort-order updates for missing session metadata', async () => {
    const harness = createHarness()

    await expect(harness.service.updateSessionSortOrder('missing', 3000)).rejects.toBeInstanceOf(SessionNotFoundError)
  })

  test('deletes persistence only after awaited pre-delete effects', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
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
    const originalDelete = harness.repository.deleteSession.bind(harness.repository)
    const deleteSpy = vi.spyOn(harness.repository, 'deleteSession').mockImplementation((id, projectDeletion) => {
      order.push('storage')
      return originalDelete(id, projectDeletion)
    })

    await harness.service.deleteSession(session.id)

    expect(deleteSpy).toHaveBeenCalledWith(session.id, expect.any(Function))
    expect(order).toEqual(['effect', 'storage', 'deleted'])
    expect(harness.repository.records.has(session.id)).toBe(false)
  })

  test('reprojects hasPausedToolCall when a row clear command removes a paused message', async () => {
    const harness = createHarness()
    const session: Session = {
      id: 'session-1',
      name: 'session-1',
      type: 'chat',
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          generating: false,
          contentParts: [
            {
              type: 'tool-call',
              toolCallId: 'tool-1',
              toolName: 'user_exec',
              args: {},
              state: 'paused',
              pauseReason: { type: 'user_exec_approval', command: 'ls' },
            },
          ],
        },
      ],
    }
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, { ...createTestRecord(session, 1), hasPausedToolCall: true })

    await harness.service.executeStructureCommand(session.id, { action: 'session-clear', scope: 'all' })

    expect(harness.repository.records.get(session.id)?.hasPausedToolCall).toBe(false)
  })

  test('publishes committed rows and retries metadata when its projection fails', async () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness()
      const session = createTestSession('session-1')
      await harness.repository.seedSession(session)
      harness.repository.records.set(session.id, { ...createTestRecord(session, 1), hasPausedToolCall: true })
      const metadataError = new Error('metadata update failed')
      vi.spyOn(harness.repository.meta, 'update').mockRejectedValueOnce(metadataError)

      await expect(
        harness.service.updateSessionHeader(session.id, (current) => {
          if (!current) throw new Error('Expected current session')
          return { ...current, name: 'Renamed' }
        })
      ).resolves.toMatchObject({ name: 'Renamed' })

      expect(harness.published.at(-1)).toMatchObject({
        type: 'session-command-committed',
        delta: { header: { id: session.id, name: 'Renamed' } },
        meta: null,
        metaRevision: null,
      })
      expect(harness.repository.records.get(session.id)).toMatchObject({ name: 'session-1', hasPausedToolCall: true })

      await vi.advanceTimersByTimeAsync(1000)

      expect(harness.repository.records.get(session.id)).toMatchObject({ name: 'Renamed', hasPausedToolCall: false })
      expect(harness.published.at(-1)).toMatchObject({
        type: 'session-meta-projected',
        sessionId: session.id,
        meta: { id: session.id, name: 'Renamed', hasPausedToolCall: false },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  test('gives up the metadata repair when the retry fails too', async () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness()
      const session = createTestSession('session-1')
      await harness.repository.seedSession(session)
      harness.repository.records.set(session.id, createTestRecord(session, 1))
      vi.spyOn(harness.repository.meta, 'update').mockRejectedValue(new Error('metadata update failed'))

      await expect(
        harness.service.updateSessionHeader(session.id, (current) => {
          if (!current) throw new Error('Expected current session')
          return { ...current, name: 'Renamed' }
        })
      ).resolves.toMatchObject({ name: 'Renamed' })

      await vi.advanceTimersByTimeAsync(5000)

      expect(harness.repository.records.get(session.id)).toMatchObject({ name: 'session-1' })
      expect(harness.log).toHaveBeenCalledWith(
        'warn',
        'Failed to repair session metadata projection',
        expect.objectContaining({ sessionId: session.id })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  test('rejects writes that start after deletion begins and never resurrects the session', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
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

    await expect(harness.service.updateSessionHeader(session.id, { name: 'late write' })).rejects.toBeInstanceOf(
      SessionNotFoundError
    )
    releasePreDelete()
    await deletion

    expect(Boolean(harness.repository.inspectSession(session.id))).toBe(false)
    expect(harness.repository.records.has(session.id)).toBe(false)
  })

  test('does not resurrect a session when metadata deletion fails after row deletion', async () => {
    const harness = createHarness()
    const session = createTestSession('session-1')
    await harness.repository.seedSession(session)
    harness.repository.records.set(session.id, createTestRecord(session, 1))
    await harness.service.updateSessionHeader(session.id, { name: 'Cached before delete' })
    vi.spyOn(harness.repository.meta, 'delete').mockRejectedValueOnce(new Error('metadata deletion failed'))

    await expect(harness.service.deleteSession(session.id)).rejects.toThrow('metadata deletion failed')
    await expect(harness.service.updateSessionHeader(session.id, { name: 'Must not revive' })).rejects.toBeInstanceOf(
      SessionNotFoundError
    )

    expect(Boolean(harness.repository.inspectSession(session.id))).toBe(false)
    expect(harness.repository.records.has(session.id)).toBe(true)
  })

  test('keeps writes fenced until every started bulk deletion settles', async () => {
    const harness = createHarness()
    const failed = createTestSession('failed')
    const delayed = createTestSession('delayed')
    for (const session of [failed, delayed]) {
      await harness.repository.seedSession(session)
      harness.repository.records.set(session.id, createTestRecord(session, 1))
      await harness.service.updateSessionHeader(session.id, { name: `Cached ${session.id}` })
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
    vi.spyOn(harness.repository, 'deleteSession').mockImplementation(async (sessionId, projectDeletion) => {
      if (sessionId === failed.id) throw new Error('bulk deletion failed')
      delayedDeleteStarted()
      await delayedDeleteBlocked
      await originalDeleteSession(sessionId, projectDeletion)
    })

    const deletionResult = harness.service.deleteSessions([failed.id, delayed.id]).then(
      () => undefined,
      (error: unknown) => error
    )
    await delayedDeleteStartedPromise
    await Promise.resolve()
    await Promise.resolve()

    await expect(
      harness.service.updateSessionHeader(delayed.id, { name: 'Must remain fenced' })
    ).rejects.toBeInstanceOf(SessionNotFoundError)
    releaseDelayedDelete()

    await expect(deletionResult).resolves.toEqual(expect.objectContaining({ message: 'bulk deletion failed' }))
    expect(Boolean(harness.repository.inspectSession(delayed.id))).toBe(false)
  })
})
