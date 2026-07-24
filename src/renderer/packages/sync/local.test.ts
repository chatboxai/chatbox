import type { Session, SessionMetaRecord } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSyncSession,
  deleteSyncSession,
  listLocalSyncMetas,
  listLocalSyncSessions,
  restoreSyncSessionMetadata,
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

  it('updates metadata through the serialized chatStore path and returns a scoped undo record', async () => {
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

    const undo = await updateSyncSessionMetadata('same-id', {
      name: 'Remote Name',
      type: 'chat',
      starred: true,
    })

    expect(undo).toEqual({
      previousSession: { name: 'Local Name', type: 'chat', starred: undefined },
      appliedSession: { name: 'Remote Name', type: 'chat', starred: true },
    })
    expect(updateSession).toHaveBeenCalledTimes(1)
  })

  it('restores metadata through chatStore when an update fails after entering the queue', async () => {
    const current = session('same-id', 'chat')
    current.name = 'Local Name'
    let persisted = current
    let callCount = 0
    vi.mocked(updateSession).mockImplementation(async (_id, updater) => {
      const next = typeof updater === 'function' ? updater(persisted) : { ...persisted, ...updater }
      persisted = { ...persisted, ...next }
      callCount += 1
      if (callCount === 1) {
        throw new Error('meta update failed')
      }
      return persisted
    })

    await expect(updateSyncSessionMetadata('same-id', { name: 'Remote Name', type: 'chat' })).rejects.toThrow(
      /meta update failed/
    )

    expect(updateSession).toHaveBeenCalledTimes(2)
    expect(persisted).toMatchObject({ name: 'Local Name', type: 'chat' })
  })

  it('updates ordering fields without replacing the full metadata record', async () => {
    const current = session('same-id', 'chat')
    current.name = 'Local Name'
    const currentMeta = { ...meta('same-id', 'chat'), name: 'Locally Edited', sortOrder: 1, createdAt: 2 }
    const metaStorage = {
      getById: vi.fn(async () => currentMeta),
      update: vi.fn(async (_id, updates) => ({ ...currentMeta, ...updates })),
    }
    vi.mocked(getMetaStorage).mockResolvedValue(metaStorage as never)
    vi.mocked(updateSession).mockImplementation(async (_id, updater) => {
      return typeof updater === 'function' ? ({ ...current, ...updater(current) } as Session) : { ...current, ...updater }
    })

    const undo = await updateSyncSessionMetadata(
      'same-id',
      { name: 'Remote Name' },
      { sortOrder: 99, createdAt: 100 }
    )

    expect(metaStorage.update).toHaveBeenCalledWith('same-id', { sortOrder: 99, createdAt: 100 })
    expect(metaStorage.update).not.toHaveBeenCalledWith('same-id', expect.objectContaining({ name: expect.anything() }))
    expect(undo).toMatchObject({
      previousSession: { name: 'Local Name' },
      previousOrder: { sortOrder: 1, createdAt: 2 },
    })
  })

  it('does not roll back metadata fields changed after the sync write', async () => {
    let current = { ...session('same-id', 'chat'), name: 'User Edit', starred: true }
    const currentMeta = { ...meta('same-id', 'chat'), sortOrder: 777, createdAt: 100 }
    const metaStorage = {
      getById: vi.fn(async () => currentMeta),
      update: vi.fn(async (_id, updates) => ({ ...currentMeta, ...updates })),
    }
    vi.mocked(getMetaStorage).mockResolvedValue(metaStorage as never)
    vi.mocked(updateSession).mockImplementation(async (_id, updater) => {
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater }
      current = { ...current, ...next }
      return current
    })

    await restoreSyncSessionMetadata('same-id', {
      previousSession: { name: 'Local Name', starred: undefined },
      appliedSession: { name: 'Remote Name', starred: true },
      previousOrder: { sortOrder: 1, createdAt: 2 },
      appliedOrder: { sortOrder: 99, createdAt: 100 },
    })

    expect(current.name).toBe('User Edit')
    expect(current.starred).toBeUndefined()
    expect(metaStorage.update).toHaveBeenCalledWith('same-id', { createdAt: 2 })
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
