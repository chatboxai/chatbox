import type { Session, SessionMetaRecord } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSyncSession,
  deleteSyncSession,
  listLocalSyncMetas,
  listLocalSyncSessions,
  saveSyncMetas,
  updateSyncSessionMetadata,
} from './local'

vi.mock('@/stores/chatStore', () => ({
  createSessionWithId: vi.fn(),
  deleteSession: vi.fn(),
  getMetaStorage: vi.fn(),
  listAllSessionsMeta: vi.fn(),
  refreshSessionListCache: vi.fn(),
  updateSession: vi.fn(),
}))

vi.mock('@/storage', () => ({
  default: {
    getItem: vi.fn(),
  },
}))

const {
  createSessionWithId,
  deleteSession,
  getMetaStorage,
  listAllSessionsMeta,
  refreshSessionListCache,
  updateSession,
} = await import('@/stores/chatStore')
const { default: storage } = await import('@/storage')

function session(id: string, type?: Session['type']): Session {
  return {
    id,
    type,
    name: id,
    messages: [],
  }
}

function meta(id: string, type?: SessionMetaRecord['type']): SessionMetaRecord {
  return {
    id,
    type,
    name: id,
    sortOrder: 1,
    createdAt: 1,
  }
}

describe('local sync data selection', () => {
  beforeEach(() => {
    vi.mocked(listAllSessionsMeta).mockReset()
    vi.mocked(storage.getItem).mockReset()
    vi.mocked(createSessionWithId).mockReset()
    vi.mocked(deleteSession).mockReset()
    vi.mocked(updateSession).mockReset()
    vi.mocked(getMetaStorage).mockReset()
    vi.mocked(refreshSessionListCache).mockReset()
  })

  it('lists only chat and legacy chat sessions for sync', async () => {
    vi.mocked(listAllSessionsMeta).mockResolvedValue([
      meta('chat-1', 'chat'),
      meta('legacy-chat'),
      meta('picture-1', 'picture'),
      meta('guide-1', 'guide'),
    ])
    vi.mocked(storage.getItem).mockImplementation((key) => {
      const id = String(key).replace('session:', '')
      return Promise.resolve(session(id, id === 'legacy-chat' ? undefined : 'chat'))
    })

    const sessions = await listLocalSyncSessions()
    const metas = await listLocalSyncMetas()

    expect(sessions.map((item) => item.id)).toEqual(['chat-1', 'legacy-chat'])
    expect(metas.map((item) => item.id)).toEqual(['chat-1', 'legacy-chat'])
    expect(storage.getItem).toHaveBeenCalledTimes(2)
  })

  it('migrates legacy message content before syncing local sessions', async () => {
    vi.mocked(listAllSessionsMeta).mockResolvedValue([meta('legacy-chat')])
    vi.mocked(storage.getItem).mockResolvedValue({
      id: 'legacy-chat',
      name: 'Legacy',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'legacy text',
        },
      ],
    } as unknown as Session)

    const sessions = await listLocalSyncSessions()

    expect(sessions[0].messages[0].contentParts).toEqual([{ type: 'text', text: 'legacy text' }])
  })

  it('creates new synced sessions through the fixed-ID chatStore path', async () => {
    const syncedSession = session('remote-1', 'chat')
    const syncedMeta = meta('remote-1', 'chat')

    await createSyncSession(syncedSession, syncedMeta)

    expect(createSessionWithId).toHaveBeenCalledWith(syncedSession, syncedMeta)
  })

  it('updates only metadata through the serialized chatStore path and returns the previous patch', async () => {
    const current = session('same-id', 'chat')
    current.name = 'Local Name'
    current.messages = [
      {
        id: 'latest-message',
        role: 'user',
        contentParts: [{ type: 'text', text: 'keep me' }],
      },
    ]
    vi.mocked(updateSession).mockImplementation((_id, updater) => {
      const patch = typeof updater === 'function' ? updater(current) : updater
      expect(patch).toMatchObject({ messages: current.messages, name: 'Remote Name', starred: true })
      return Promise.resolve({ ...current, ...patch })
    })

    const previous = await updateSyncSessionMetadata('same-id', {
      name: 'Remote Name',
      type: 'chat',
      starred: true,
    })

    expect(previous).toMatchObject({ name: 'Local Name', type: 'chat' })
    expect(updateSession).toHaveBeenCalledTimes(1)
  })

  it('restores metadata through chatStore when an update fails after entering the queue', async () => {
    const current = session('same-id', 'chat')
    current.name = 'Local Name'
    vi.mocked(updateSession)
      .mockImplementationOnce((_id, updater) => {
        if (typeof updater === 'function') updater(current)
        return Promise.reject(new Error('meta update failed'))
      })
      .mockResolvedValueOnce(current)

    await expect(updateSyncSessionMetadata('same-id', { name: 'Remote Name', type: 'chat' })).rejects.toThrow(
      /meta update failed/
    )

    expect(updateSession).toHaveBeenNthCalledWith(
      2,
      'same-id',
      expect.objectContaining({ name: 'Local Name', type: 'chat' })
    )
  })

  it('deletes rolled-back sessions through chatStore', async () => {
    await deleteSyncSession('remote-1')

    expect(deleteSession).toHaveBeenCalledWith('remote-1')
  })

  it('restores exact metadata when the batch is written but refreshing the cache fails', async () => {
    const previous = meta('same-id', 'chat')
    previous.name = 'Local Name'
    const remote = { ...previous, name: 'Remote Name', sortOrder: 99 }
    const metaStorage = {
      getById: vi.fn(async () => previous),
      createMany: vi.fn(async () => undefined),
      deleteMany: vi.fn(async () => undefined),
    }
    vi.mocked(getMetaStorage).mockResolvedValue(metaStorage as never)
    vi.mocked(refreshSessionListCache)
      .mockRejectedValueOnce(new Error('cache refresh failed'))
      .mockResolvedValueOnce(undefined)

    await expect(saveSyncMetas([remote])).rejects.toThrow(/cache refresh failed/)

    expect(metaStorage.createMany).toHaveBeenNthCalledWith(1, [remote])
    expect(metaStorage.createMany).toHaveBeenNthCalledWith(2, [previous])
    expect(metaStorage.deleteMany).toHaveBeenCalledWith([])
    expect(refreshSessionListCache).toHaveBeenCalledTimes(2)
  })
})
