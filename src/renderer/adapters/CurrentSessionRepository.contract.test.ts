import 'fake-indexeddb/auto'
import { SessionMigrationError } from '@chatbox/core/application/session'
import { SessionStorageBusyError } from '@chatbox/core/ports'
import { type SessionMetaRepositoryPort, SessionRowConflictError } from '@chatbox/core/ports'
import type { Message, Session, SessionMetaPage } from '@shared/types'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test, vi } from 'vitest'
import { IndexedDBSessionRowStore } from '@/storage/SessionRowStorage'
import {
  type CurrentSessionDataStorage,
  CurrentSessionRepository,
  withExclusiveSessionStorageLock,
} from './CurrentSessionRepository'
import { unencodableMessage } from '../../../packages/chatbox-core/src/session/session-tree/unencodable.test-support'

vi.mock('../../../packages/chatbox-core/src/session/session-tree/encode', async (importOriginal) => {
  const { failOnUnencodableMarker } = await import(
    '../../../packages/chatbox-core/src/session/session-tree/unencodable.test-support'
  )
  const actual = await importOriginal<typeof import('../../../packages/chatbox-core/src/session/session-tree/encode')>()
  return { ...actual, encodeSessionTree: failOnUnencodableMarker(actual.encodeSessionTree) }
})

async function pendingMigrationIds(
  repository: CurrentSessionRepository,
  shouldSkip?: (id: string) => Promise<boolean>
) {
  const pending: string[] = []
  for (const candidate of await repository.listSessionMigrationCandidates()) {
    if (!(await shouldSkip?.(candidate.id)) && (await repository.requiresSessionMigration(candidate)))
      pending.push(candidate.id)
  }
  return pending
}

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
  // Each harness owns its record map, so it also gets its own row database.
  globalThis.indexedDB = new IDBFactory()
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
    getItemRaw: <T>(key: string) => getItem(key, null) as Promise<T | null>,
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

async function createRows(harness: ReturnType<typeof createHarness>, id = 'session') {
  const { messages, ...header } = createSessionWithMessages(id)
  return harness.repository.createSessionRows(header, messages)
}

describe('CurrentSessionRepository row boundary', () => {
  test('preserves legacy settings input when candidate publication fails and retries with normalized settings', async () => {
    const h = createHarness()
    const legacy = {
      ...createSessionWithMessages('upgrade'),
      settings: { aiProvider: 'openai', model: 'legacy-model' },
    }
    h.values.set('session:upgrade', legacy)
    expect((await h.repository.readUpgradeSessionHeader('upgrade'))?.settings).toMatchObject(legacy.settings)
    const normalized = { provider: 'openai', modelId: 'legacy-model' }
    const write = vi.spyOn(h.rowStore, 'writeRows').mockRejectedValueOnce(new Error('disk full'))
    await expect(h.repository.upgradeLegacySessionSettings('upgrade', normalized)).rejects.toThrow()
    expect(h.values.get('session:upgrade')).toEqual(legacy)
    expect(await h.rowStore.readCommit('upgrade')).toBeNull()
    await h.repository.upgradeLegacySessionSettings('upgrade', normalized)
    expect(write).toHaveBeenCalledTimes(2)
    expect((await h.repository.getSessionHeader('upgrade'))?.header.settings).toEqual(normalized)
    expect(
      (
        await h.repository.readSessionTranscriptWindow({ sessionId: 'upgrade', origin: 'tail', limit: 20 })
      )?.messages.map((row) => row.messageId)
    ).toEqual(['user-1', 'assistant-1'])
  })

  test('uses published row settings even if the external legacy record remains after an interrupted upgrade', async () => {
    const h = createHarness()
    await createRows(h, 'upgrade')
    await h.repository.executeSessionCommand('upgrade', {
      type: 'header',
      updater: { settings: { provider: 'openai', modelId: 'current' } },
    })
    const legacy = { ...createSessionWithMessages('upgrade'), settings: { aiProvider: 'openai', model: 'obsolete' } }
    h.values.set('session:upgrade', legacy)
    expect((await h.repository.readUpgradeSessionHeader('upgrade'))?.settings?.modelId).toBe('current')
    await h.repository.upgradeLegacySessionSettings('upgrade', { provider: 'openai', modelId: 'obsolete' })
    expect((await h.repository.getSessionHeader('upgrade'))?.header.settings?.modelId).toBe('current')
    await h.repository.storeLegacyUpgradeInput({ ...createSessionWithMessages('upgrade'), name: 'Obsolete source' })
    expect((await h.repository.getSessionHeader('upgrade'))?.header.name).toBe('Session')
  })

  test('publishes row headers and serves only the requested transcript page', async () => {
    const harness = createHarness()
    await createRows(harness)
    expect(harness.values.has('session:session')).toBe(false)
    expect(await harness.repository.getSessionHeader('session')).toMatchObject({
      header: { id: 'session' },
      revision: 1,
    })
    const page = await harness.repository.readSessionTranscriptWindow({
      sessionId: 'session',
      limit: 1,
      origin: 'tail',
    })
    expect(page?.messages.map((row) => row.messageId)).toEqual(['assistant-1'])
    expect(page?.older).not.toBeNull()
  })

  test('converts legacy input before exposing the header and preserves its messages', async () => {
    const harness = createHarness()
    harness.values.set('session:legacy', createSessionWithMessages('legacy'))
    expect(await harness.repository.getSessionHeader('legacy')).toMatchObject({ header: { id: 'legacy' } })
    expect(harness.values.get('session:legacy')).toEqual(createSessionWithMessages('legacy'))
    expect(
      (await harness.repository.readSessionMessages({ sessionId: 'legacy', messageIds: ['user-1'] }))?.messages[0].id
    ).toBe('user-1')
  })

  test('published header reads and migration enumeration do not reopen historical records', async () => {
    const harness = createHarness()
    await createRows(harness)
    harness.getItem.mockClear()
    await harness.repository.getSessionHeader('session')
    await harness.repository.getSessionHeader('session')
    expect(await pendingMigrationIds(harness.repository)).toEqual([])
    expect(harness.getItem).not.toHaveBeenCalled()
  })

  test('candidate listing performs no per-session commit reads or legacy body reads', async () => {
    const harness = createHarness()
    await createRows(harness)
    harness.values.set('session:legacy', createSessionWithMessages('legacy'))
    const commits = vi.spyOn(harness.rowStore, 'readCommit')
    harness.getItem.mockClear()
    const candidates = await harness.repository.listSessionMigrationCandidates()
    expect(candidates.map((candidate) => candidate.id).sort()).toEqual(['legacy', 'session'])
    expect(commits).not.toHaveBeenCalled()
    expect(harness.getItem).not.toHaveBeenCalled()
    expect(
      await harness.repository.requiresSessionMigration(candidates.find((candidate) => candidate.id === 'session')!)
    ).toBe(false)
    expect(commits).toHaveBeenCalledTimes(1)
    expect(harness.repository.hasForegroundSessionWork()).toBe(false)
  })

  test('foreground reads stay busy until every overlapping read settles, including failures', async () => {
    const harness = createHarness()
    await createRows(harness)
    const rejectReads: Array<(error: Error) => void> = []
    vi.spyOn(harness.rowStore, 'readMessages').mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectReads.push(reject)
        })
    )
    const read = () =>
      harness.repository
        .readSessionMessages({ sessionId: 'session', messageIds: ['user-1'] })
        .catch((error: unknown) => error)
    const first = read()
    const second = read()
    expect(harness.repository.hasForegroundSessionWork()).toBe(true)
    await vi.waitFor(() => expect(rejectReads).toHaveLength(2))
    rejectReads[0](new Error('first read failed'))
    await first
    expect(harness.repository.hasForegroundSessionWork()).toBe(true)
    rejectReads[1](new Error('second read failed'))
    await second
    expect(harness.repository.hasForegroundSessionWork()).toBe(false)
    await harness.repository.getSessionHeader('session')
    expect(harness.repository.hasForegroundSessionWork()).toBe(false)
  })

  test('keeps invalid source data intact and returns a diagnostic migration error', async () => {
    const harness = createHarness()
    const source = { ...createSession('invalid'), messages: [unencodableMessage()] }
    harness.values.set('session:invalid', source)
    await expect(harness.repository.getSessionHeader('invalid')).rejects.toBeInstanceOf(SessionMigrationError)
    expect(harness.values.get('session:invalid')).toBe(source)
    expect(await harness.rowStore.readCommit('invalid')).toBeNull()
  })

  test('migrates a legacy record once and never rewrites it', async () => {
    const harness = createHarness()
    harness.values.set('session:legacy', createSessionWithMessages('legacy'))
    expect(await harness.repository.getSessionHeader('legacy')).toMatchObject({ revision: 1 })
    await harness.repository.executeSessionCommand('legacy', {
      type: 'append',
      messages: [message('user-2', 'user', 300)],
    })
    harness.getItem.mockClear()
    const restarted = new CurrentSessionRepository({
      dataStorage: harness.dataStorage,
      metaStorage: harness.metaStorage,
      rowStore: harness.rowStore,
    })
    expect(await restarted.getSessionHeader('legacy')).toMatchObject({ revision: 2 })
    expect(harness.getItem).not.toHaveBeenCalled()
    expect(await pendingMigrationIds(restarted)).toEqual([])
    expect(await restarted.migrateSession('legacy')).toBe('already')
    expect(harness.setItemNow).not.toHaveBeenCalled()
    expect(harness.values.get('session:legacy')).toEqual(createSessionWithMessages('legacy'))
  })

  test('needs no migration for a row-only session and repairs its missing list entry on request', async () => {
    const harness = createHarness()
    await createRows(harness)
    expect(await pendingMigrationIds(harness.repository)).toEqual([])
    expect(await harness.repository.migrateSession('session')).toBe('already')
    expect(harness.metaStorage.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'session' }))
    expect(harness.values.has('session:session')).toBe(false)
  })

  test('checks recovery protection before touching a candidate record', async () => {
    const harness = createHarness()
    harness.values.set('session:protected', createSession('protected'))
    expect(await pendingMigrationIds(harness.repository, async () => true)).toEqual([])
    expect(harness.getItem).not.toHaveBeenCalled()
  })

  test('rejects row writes while a storage upgrade owns the lock and resumes afterwards', async () => {
    const harness = createHarness()
    await createRows(harness)
    await withExclusiveSessionStorageLock(async () => {
      const rows = []
      for await (const row of harness.rowStore.iterateRows({ sessionId: 'session' })) rows.push(row.kind)
      expect(rows.filter((kind) => kind === 'message')).toHaveLength(2)
      await expect(
        harness.repository.executeSessionCommand('session', { type: 'header', updater: { name: 'Blocked' } })
      ).rejects.toBeInstanceOf(SessionStorageBusyError)
    })
    await harness.repository.executeSessionCommand('session', { type: 'header', updater: { name: 'Saved' } })
    expect((await harness.repository.getSessionHeader('session'))?.header.name).toBe('Saved')
  })

  test('preserves revision conflict errors for the window controller', async () => {
    const harness = createHarness()
    await createRows(harness)
    const conflict = new SessionRowConflictError('session', 1, 2)
    vi.spyOn(harness.rowStore, 'readTranscriptWindow').mockRejectedValueOnce(conflict)
    await expect(harness.repository.readSessionTranscriptWindow({ sessionId: 'session', limit: 20 })).rejects.toBe(
      conflict
    )
  })

  test('deletes row authority and the record together', async () => {
    const harness = createHarness()
    await createRows(harness)
    await harness.repository.deleteSession('session')
    expect(await harness.repository.getSessionHeader('session')).toBeNull()
    expect(harness.values.has('session:session')).toBe(false)
    expect(await harness.rowStore.readCommit('session')).toBeNull()
  })

  test('initializes and normalizes metadata storage failures', async () => {
    const harness = createHarness()
    await harness.repository.initialize()
    expect(harness.metaStorage.initialize).toHaveBeenCalled()
    vi.mocked(harness.metaStorage.update).mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(harness.repository.meta.update('session', { name: 'Saved' })).rejects.toMatchObject({
      name: 'SessionRepositoryError',
      operation: 'update-meta',
      sessionId: 'session',
    })
  })

  test('filters reserved record keys while retaining legacy migration candidates', async () => {
    const harness = createHarness()
    for (const id of ['', 'new', 'undefined', 'valid']) harness.values.set(`session:${id}`, createSession(id))
    expect(await harness.repository.getAllSessionIds()).toEqual(['valid'])
    expect(await pendingMigrationIds(harness.repository)).toEqual(['valid'])
  })
})
