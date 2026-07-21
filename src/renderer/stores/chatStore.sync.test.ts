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

  it('refuses to overwrite an existing session ID', async () => {
    mocks.getStoreValue.mockResolvedValueOnce(session('remote-1'))

    await expect(createSessionWithId(session('remote-1'), meta('remote-1'))).rejects.toThrow(/already exists/)

    expect(mocks.storage.setItemNow).not.toHaveBeenCalled()
    expect(mocks.metaStorage.create).not.toHaveBeenCalled()
  })
})
