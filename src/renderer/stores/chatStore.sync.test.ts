import type { Session, SessionMetaRecord } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  storage: {
    getItem: vi.fn(),
    setItemNow: vi.fn(),
    removeItem: vi.fn(),
  },
  metaStorage: {
    initialize: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
  },
  queryClient: {
    setQueryData: vi.fn(),
    fetchQuery: vi.fn(),
  },
  getStoreValue: vi.fn(),
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'web',
    getSessionMetaStorage: () => mocks.metaStorage,
    getStoreValue: mocks.getStoreValue,
  },
}))

vi.mock('@/storage', () => ({ default: mocks.storage }))
vi.mock('@/components/chat/MessageList', () => ({ clearScrollPositionCache: vi.fn() }))
vi.mock('./atoms/throttleWriteSessionAtom', () => ({ cleanupSessionAtomCache: vi.fn() }))
vi.mock('./lastUsedModelStore', () => ({
  lastUsedModelStore: { getState: () => ({ chat: {}, picture: {} }) },
}))
vi.mock('./queryClient', () => ({ default: mocks.queryClient }))
vi.mock('./sessionHelpers', () => ({
  getSessionMeta: (session: Session) => ({
    id: session.id,
    name: session.name,
    type: session.type,
    starred: session.starred,
    hidden: session.hidden,
    assistantAvatarKey: session.assistantAvatarKey,
    picUrl: session.picUrl,
    backgroundImage: session.backgroundImage,
  }),
}))
vi.mock('./settingsStore', () => ({
  settingsStore: { getState: vi.fn() },
  useSettingsStore: vi.fn(),
}))
vi.mock('./uiStore', () => ({
  uiStore: {
    getState: () => ({
      clearSessionWebBrowsing: vi.fn(),
      removeSessionKnowledgeBase: vi.fn(),
    }),
  },
}))

const { createSessionWithId } = await import('./chatStore')

function session(id: string): Session {
  return {
    id,
    type: 'chat',
    name: 'Synced session',
    messages: [],
  }
}

function meta(id: string): SessionMetaRecord {
  return {
    id,
    type: 'chat',
    name: 'Synced session',
    sortOrder: 10,
    createdAt: 5,
  }
}

describe('chatStore fixed-ID session creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storage.getItem.mockResolvedValue(null)
    mocks.storage.setItemNow.mockResolvedValue(undefined)
    mocks.storage.removeItem.mockResolvedValue(undefined)
    mocks.metaStorage.initialize.mockResolvedValue(undefined)
    mocks.metaStorage.getById.mockResolvedValue(null)
    mocks.metaStorage.create.mockResolvedValue(undefined)
    mocks.getStoreValue.mockResolvedValue(undefined)
  })

  it('writes the session and exact metadata before publishing the cache update', async () => {
    const syncedSession = session('remote-1')
    const syncedMeta = meta('remote-1')

    await createSessionWithId(syncedSession, syncedMeta)

    expect(mocks.storage.setItemNow).toHaveBeenCalledWith('session:remote-1', syncedSession)
    expect(mocks.metaStorage.create).toHaveBeenCalledWith(syncedMeta)
    expect(mocks.queryClient.setQueryData).toHaveBeenCalled()
  })

  it('removes a partially written session when metadata creation fails', async () => {
    mocks.metaStorage.create.mockRejectedValueOnce(new Error('meta create failed'))

    await expect(createSessionWithId(session('remote-1'), meta('remote-1'))).rejects.toThrow(/meta create failed/)

    expect(mocks.storage.removeItem).toHaveBeenCalledWith('session:remote-1')

    await expect(createSessionWithId(session('remote-1'), meta('remote-1'))).resolves.toMatchObject({
      id: 'remote-1',
    })
  })

  it('repairs metadata when a matching session survived an interrupted import', async () => {
    const syncedSession = session('remote-1')
    const syncedMeta = meta('remote-1')
    mocks.getStoreValue.mockResolvedValue(syncedSession)

    await expect(createSessionWithId(syncedSession, syncedMeta)).resolves.toMatchObject(syncedSession)

    expect(mocks.storage.setItemNow).not.toHaveBeenCalled()
    expect(mocks.metaStorage.create).toHaveBeenCalledWith(syncedMeta)
    expect(mocks.queryClient.setQueryData).toHaveBeenCalled()

    const listUpdate = mocks.queryClient.setQueryData.mock.calls.find(([, value]) => typeof value === 'function')?.[1]
    expect(listUpdate).toBeTypeOf('function')
    const updatedCache = listUpdate({
      pages: [{ items: [syncedMeta], nextCursor: null, total: 1 }],
      pageParams: [0],
    })
    expect(updatedCache.pages[0].items.map((item: SessionMetaRecord) => item.id)).toEqual(['remote-1'])
    expect(updatedCache.pages[0].total).toBe(1)
  })

  it('repairs the session when matching metadata exists without its value', async () => {
    const syncedSession = session('remote-1')
    const syncedMeta = meta('remote-1')
    mocks.metaStorage.getById.mockResolvedValue(syncedMeta)

    await expect(createSessionWithId(syncedSession, syncedMeta)).resolves.toMatchObject(syncedSession)

    expect(mocks.storage.setItemNow).toHaveBeenCalledWith('session:remote-1', syncedSession)
    expect(mocks.metaStorage.create).not.toHaveBeenCalled()
    expect(mocks.queryClient.setQueryData).toHaveBeenCalledTimes(1)
  })

  it('treats an already complete matching import as an idempotent success', async () => {
    const syncedSession = session('remote-1')
    const syncedMeta = { ...meta('remote-1'), starred: false }
    mocks.getStoreValue.mockResolvedValue(syncedSession)
    mocks.metaStorage.getById.mockResolvedValue({ ...syncedMeta, starred: undefined })

    await expect(createSessionWithId(syncedSession, syncedMeta)).resolves.toMatchObject(syncedSession)

    expect(mocks.storage.setItemNow).not.toHaveBeenCalled()
    expect(mocks.metaStorage.create).not.toHaveBeenCalled()
    expect(mocks.queryClient.setQueryData).toHaveBeenCalledTimes(1)
  })

  it('refuses to overwrite different session data under an existing ID', async () => {
    mocks.getStoreValue.mockResolvedValueOnce({ ...session('remote-1'), name: 'Local session' })

    await expect(createSessionWithId(session('remote-1'), meta('remote-1'))).rejects.toThrow(
      /already exists with different session data/
    )

    expect(mocks.storage.setItemNow).not.toHaveBeenCalled()
    expect(mocks.metaStorage.create).not.toHaveBeenCalled()
  })

  it('refuses to overwrite different metadata under an existing ID', async () => {
    mocks.metaStorage.getById.mockResolvedValueOnce({ ...meta('remote-1'), name: 'Local metadata' })

    await expect(createSessionWithId(session('remote-1'), meta('remote-1'))).rejects.toThrow(
      /already exists with different metadata/
    )

    expect(mocks.storage.setItemNow).not.toHaveBeenCalled()
    expect(mocks.metaStorage.create).not.toHaveBeenCalled()
  })

  it('repairs an orphaned session on retry when the original cleanup also failed', async () => {
    let persistedSession: Session | undefined
    let persistedMeta: SessionMetaRecord | undefined
    mocks.getStoreValue.mockImplementation(() => Promise.resolve(persistedSession))
    mocks.storage.setItemNow.mockImplementation((_key, value: Session) => {
      persistedSession = value
      return Promise.resolve()
    })
    mocks.storage.removeItem.mockRejectedValueOnce(new Error('session cleanup failed'))
    mocks.metaStorage.getById.mockImplementation(() => Promise.resolve(persistedMeta ?? null))
    mocks.metaStorage.create
      .mockRejectedValueOnce(new Error('meta create failed'))
      .mockImplementation((record: SessionMetaRecord) => {
        persistedMeta = record
        return Promise.resolve()
      })

    await expect(createSessionWithId(session('remote-1'), meta('remote-1'))).rejects.toThrow(
      /remove its partially written data/
    )
    expect(persistedSession).toEqual(session('remote-1'))
    expect(persistedMeta).toBeUndefined()

    await expect(createSessionWithId(session('remote-1'), meta('remote-1'))).resolves.toMatchObject({
      id: 'remote-1',
    })

    expect(mocks.storage.setItemNow).toHaveBeenCalledTimes(1)
    expect(mocks.metaStorage.create).toHaveBeenCalledTimes(2)
    expect(persistedMeta).toEqual(meta('remote-1'))
  })

  it('serializes concurrent matching imports and resolves both without duplicate writes', async () => {
    let persistedSession: Session | undefined
    let persistedMeta: SessionMetaRecord | undefined
    let releaseMetadataWrite: (() => void) | undefined
    const metadataWriteGate = new Promise<void>((resolve) => {
      releaseMetadataWrite = resolve
    })
    mocks.getStoreValue.mockImplementation(() => Promise.resolve(persistedSession))
    mocks.storage.setItemNow.mockImplementation((_key, value: Session) => {
      persistedSession = value
      return Promise.resolve()
    })
    mocks.metaStorage.getById.mockImplementation(() => Promise.resolve(persistedMeta ?? null))
    mocks.metaStorage.create.mockImplementation(async (record: SessionMetaRecord) => {
      await metadataWriteGate
      persistedMeta = record
    })

    const first = createSessionWithId(session('remote-1'), meta('remote-1'))
    const second = createSessionWithId(session('remote-1'), meta('remote-1'))
    await vi.waitFor(() => expect(mocks.metaStorage.create).toHaveBeenCalledTimes(1))
    releaseMetadataWrite?.()

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(mocks.storage.setItemNow).toHaveBeenCalledTimes(1)
    expect(mocks.metaStorage.create).toHaveBeenCalledTimes(1)
  })

  it('rejects different content queued behind a concurrent fixed-ID import', async () => {
    let persistedSession: Session | undefined
    let persistedMeta: SessionMetaRecord | undefined
    let releaseMetadataWrite: (() => void) | undefined
    const metadataWriteGate = new Promise<void>((resolve) => {
      releaseMetadataWrite = resolve
    })
    mocks.getStoreValue.mockImplementation(() => Promise.resolve(persistedSession))
    mocks.storage.setItemNow.mockImplementation((_key, value: Session) => {
      persistedSession = value
      return Promise.resolve()
    })
    mocks.metaStorage.getById.mockImplementation(() => Promise.resolve(persistedMeta ?? null))
    mocks.metaStorage.create.mockImplementation(async (record: SessionMetaRecord) => {
      await metadataWriteGate
      persistedMeta = record
    })

    const first = createSessionWithId(session('remote-1'), meta('remote-1'))
    const conflicting = createSessionWithId(
      { ...session('remote-1'), name: 'Different remote session' },
      meta('remote-1')
    )
    await vi.waitFor(() => expect(mocks.metaStorage.create).toHaveBeenCalledTimes(1))
    releaseMetadataWrite?.()

    await expect(first).resolves.toMatchObject({ id: 'remote-1' })
    await expect(conflicting).rejects.toThrow(/already exists with different session data/)
    expect(mocks.storage.setItemNow).toHaveBeenCalledTimes(1)
    expect(mocks.metaStorage.create).toHaveBeenCalledTimes(1)
  })
})
