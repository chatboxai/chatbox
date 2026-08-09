import type { Session } from '@shared/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { metaStorageMock, platformMock, queryClientMock, storageMock } = vi.hoisted(() => {
  const metaStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null, total: 0 }),
    update: vi.fn().mockResolvedValue(null),
    getById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(undefined),
  }
  return {
    metaStorageMock: metaStorage,
    platformMock: {
      type: 'web',
      getSessionMetaStorage: () => metaStorage,
    },
    queryClientMock: {
      fetchQuery: vi.fn((options: { queryFn: () => Promise<Session | null> }) => options.queryFn()),
      fetchInfiniteQuery: vi.fn(),
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
    },
    storageMock: {
      getItem: vi.fn(),
      setItemNow: vi.fn(),
      removeItem: vi.fn(),
    },
  }
})

vi.mock('@ebay/nice-modal-react', () => ({ default: { show: vi.fn() } }))
vi.mock('@tanstack/react-query', () => ({ useInfiniteQuery: vi.fn(), useQuery: vi.fn() }))
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@/platform', () => ({ default: platformMock }))
vi.mock('@/storage', () => ({ default: storageMock, StorageKey: {} }))
vi.mock('@/storage/SessionMetaStorage', () => ({ sortSessionRecords: (items: unknown[]) => items }))
vi.mock('@/storage/StoreStorage', () => ({ StorageKeyGenerator: { session: (id: string) => `session:${id}` } }))
vi.mock('../lib/utils', () => ({ getLogger: () => ({ error: vi.fn() }) }))
vi.mock('../utils/session-utils', () => ({ migrateSession: (session: Session) => session }))
vi.mock('@/components/chat/MessageList', () => ({ clearScrollPositionCache: vi.fn() }))
vi.mock('./atoms/throttleWriteSessionAtom', () => ({ cleanupSessionAtomCache: vi.fn() }))
vi.mock('./lastUsedModelStore', () => ({ lastUsedModelStore: { getState: () => ({ chat: {}, picture: {} }) } }))
vi.mock('./queryClient', () => ({ default: queryClientMock }))
vi.mock('./sessionActivityStore', () => ({ clearSessionActivity: vi.fn() }))
vi.mock('./sessionHelpers', () => ({ getSessionMeta: (session: Session) => ({ id: session.id, name: session.name }) }))
vi.mock('./settingsStore', () => ({ settingsStore: { getState: vi.fn() }, useSettingsStore: vi.fn() }))
vi.mock('./uiStore', () => ({
  uiStore: {
    getState: () => ({
      clearSessionWebBrowsing: vi.fn(),
      removeSessionKnowledgeBase: vi.fn(),
      clearSessionAgentMode: vi.fn(),
    }),
  },
}))

import { deleteSession, deleteSessions, updateSessionWithMessages } from './chatStore'
import {
  beginSessionGeneration,
  registerSessionGenerationCancel,
  resetSessionGenerationRuntime,
  settleSessionGeneration,
} from './session/generation-runtime'

const session: Session = { id: 'session-1', name: 'Session', messages: [] }

describe('session deletion lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionGenerationRuntime()
    storageMock.getItem.mockResolvedValue(session)
    storageMock.setItemNow.mockResolvedValue(undefined)
    storageMock.removeItem.mockResolvedValue(undefined)
    metaStorageMock.initialize.mockResolvedValue(undefined)
    metaStorageMock.update.mockResolvedValue(null)
    metaStorageMock.getById.mockResolvedValue(null)
    metaStorageMock.create.mockResolvedValue(undefined)
    metaStorageMock.delete.mockResolvedValue(undefined)
    metaStorageMock.deleteMany.mockResolvedValue(undefined)
    metaStorageMock.getPage.mockResolvedValue({ items: [], nextCursor: null, total: 0 })
  })

  test('cancels and settles generation and pending writes before removing session storage', async () => {
    let finishPersist!: () => void
    storageMock.setItemNow.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishPersist = resolve
      })
    )
    const update = updateSessionWithMessages(session.id, { name: 'Updated' })
    await vi.waitFor(() => expect(storageMock.setItemNow).toHaveBeenCalledOnce())

    const cancel = vi.fn()
    beginSessionGeneration(session.id, 'reply-1')
    registerSessionGenerationCancel(session.id, 'reply-1', cancel)
    const deletion = deleteSession(session.id)
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())

    expect(storageMock.removeItem).not.toHaveBeenCalled()
    settleSessionGeneration(session.id, 'reply-1')
    await Promise.resolve()
    expect(storageMock.removeItem).not.toHaveBeenCalled()

    finishPersist()
    await update
    await deletion

    expect(storageMock.removeItem).toHaveBeenCalledWith('session:session-1')
    expect(storageMock.setItemNow).toHaveBeenCalledTimes(1)
    expect(metaStorageMock.delete).toHaveBeenCalledWith(session.id)
  })

  test('waits for every active generation before bulk session removal', async () => {
    const firstCancel = vi.fn()
    const secondCancel = vi.fn()
    beginSessionGeneration('session-1', 'reply-1')
    registerSessionGenerationCancel('session-1', 'reply-1', firstCancel)
    beginSessionGeneration('session-2', 'reply-2')
    registerSessionGenerationCancel('session-2', 'reply-2', secondCancel)

    const deletion = deleteSessions(['session-1', 'session-2'])
    await vi.waitFor(() => {
      expect(firstCancel).toHaveBeenCalledOnce()
      expect(secondCancel).toHaveBeenCalledOnce()
    })
    expect(storageMock.removeItem).not.toHaveBeenCalled()

    settleSessionGeneration('session-1', 'reply-1')
    await Promise.resolve()
    expect(storageMock.removeItem).not.toHaveBeenCalled()

    settleSessionGeneration('session-2', 'reply-2')
    await deletion

    expect(storageMock.removeItem).toHaveBeenCalledTimes(2)
    expect(metaStorageMock.deleteMany).toHaveBeenCalledWith(['session-1', 'session-2'])
  })

  test('persists canceled generation state and reopens updates when deletion fails', async () => {
    const deletionError = new Error('remove failed')
    storageMock.removeItem.mockRejectedValueOnce(deletionError)
    const cancel = vi.fn()
    beginSessionGeneration(session.id, 'reply-1')
    registerSessionGenerationCancel(session.id, 'reply-1', cancel)

    const deletion = deleteSession(session.id)
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())

    const canceledSession = {
      ...session,
      messages: [
        {
          id: 'reply-1',
          role: 'assistant' as const,
          contentParts: [],
          generating: false,
          finishReason: 'canceled' as const,
        },
      ],
    }
    await updateSessionWithMessages(session.id, canceledSession)
    settleSessionGeneration(session.id, 'reply-1')

    await expect(deletion).rejects.toThrow(deletionError)
    expect(storageMock.setItemNow).toHaveBeenCalledWith('session:session-1', canceledSession)
    expect(queryClientMock.setQueryData).toHaveBeenCalledWith(['chat-session', session.id], canceledSession)

    await expect(updateSessionWithMessages(session.id, { name: 'Still available' })).resolves.toMatchObject({
      name: 'Still available',
    })
    expect(beginSessionGeneration(session.id, 'reply-2')).toBe(true)
  })

  test('restores session storage when metadata deletion fails', async () => {
    const meta = { id: session.id, name: session.name, sortOrder: 1, createdAt: 1 }
    metaStorageMock.getById.mockResolvedValue(meta)
    const deletionError = new Error('meta delete failed')
    metaStorageMock.delete.mockRejectedValueOnce(deletionError)

    await expect(deleteSession(session.id)).rejects.toThrow(deletionError)

    expect(storageMock.removeItem).toHaveBeenCalledWith('session:session-1')
    expect(storageMock.setItemNow).toHaveBeenCalledWith('session:session-1', session)
    expect(metaStorageMock.update).toHaveBeenCalledWith(session.id, meta)
    expect(beginSessionGeneration(session.id, 'reply-after-rollback')).toBe(true)
  })

  test('restores every snapshot after a partial bulk storage deletion', async () => {
    const first = { ...session, id: 'session-1' }
    const second = { ...session, id: 'session-2' }
    const firstMeta = { id: first.id, name: first.name, sortOrder: 1, createdAt: 1 }
    const secondMeta = { id: second.id, name: second.name, sortOrder: 2, createdAt: 2 }
    storageMock.getItem.mockImplementation(async (key: string) => (key === 'session:session-1' ? first : second))
    metaStorageMock.getById.mockImplementation(async (id: string) => (id === first.id ? firstMeta : secondMeta))
    const deletionError = new Error('second remove failed')
    storageMock.removeItem.mockImplementationOnce(async () => undefined).mockRejectedValueOnce(deletionError)

    await expect(deleteSessions([first.id, second.id])).rejects.toThrow(deletionError)

    expect(storageMock.setItemNow).toHaveBeenCalledWith('session:session-1', first)
    expect(storageMock.setItemNow).toHaveBeenCalledWith('session:session-2', second)
    expect(metaStorageMock.update).toHaveBeenCalledWith(first.id, firstMeta)
    expect(metaStorageMock.update).toHaveBeenCalledWith(second.id, secondMeta)
  })
})
