import type { SessionGroup, SessionMeta, UpdaterFn } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageState: { groups: SessionGroup[]; sessions: SessionMeta[] } = {
  groups: [],
  sessions: [],
}

vi.mock('@/storage', () => {
  const StorageKey = {
    SessionGroupsList: 'session-groups-list',
    ChatSessionsList: 'chat-sessions-list',
  }
  return {
    default: {
      getItem: vi.fn(async (key: string, initial: unknown) => {
        if (key === StorageKey.SessionGroupsList) return storageState.groups
        if (key === StorageKey.ChatSessionsList) return storageState.sessions
        return initial
      }),
      setItemNow: vi.fn(async (key: string, value: unknown) => {
        if (key === StorageKey.SessionGroupsList) storageState.groups = value as SessionGroup[]
        else if (key === StorageKey.ChatSessionsList) storageState.sessions = value as SessionMeta[]
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      getAllKeys: vi.fn(async () => []),
    },
    StorageKey,
  }
})

vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }))

vi.mock('../../lib/utils', () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

const updateSessionListMock = vi.fn(async (updater: UpdaterFn<SessionMeta[]>) => {
  storageState.sessions = updater(storageState.sessions)
})

const updateSessionMock = vi.fn(async (sessionId: string, updater: UpdaterFn<Omit<SessionMeta, 'messages'>>) => {
  storageState.sessions = storageState.sessions.map((s) =>
    s.id === sessionId ? ({ ...s, ...updater(s) } as SessionMeta) : s
  )
})

const metaStorageMock = {
  update: vi.fn(async (id: string, patch: Partial<SessionMeta>) => {
    storageState.sessions = storageState.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s))
    return storageState.sessions.find((s) => s.id === id) ?? null
  }),
}

vi.mock('../chatStore', () => ({
  updateSessionList: (updater: UpdaterFn<SessionMeta[]>) => updateSessionListMock(updater),
  updateSession: (sessionId: string, updater: UpdaterFn<Omit<SessionMeta, 'messages'>>) =>
    updateSessionMock(sessionId, updater),
  updateSessionListData: (updater: (items: SessionMeta[]) => SessionMeta[]) => {
    storageState.sessions = updater(storageState.sessions)
  },
  listSessionsMeta: async () => storageState.sessions,
  getMetaStorage: async () => metaStorageMock,
  invalidateSessionLists: async () => {},
}))

const updateGroupListMock = vi.fn(async (updater: UpdaterFn<SessionGroup[]>) => {
  storageState.groups = updater(storageState.groups)
})

let groupCounter = 0
const createGroupMock = vi.fn(async (input: { name: string; parentId?: string | null; color?: string }) => {
  groupCounter += 1
  const id = `group:new-${groupCounter}`
  const created: SessionGroup = {
    id,
    name: input.name,
    parentId: input.parentId ?? null,
    sortIndex: storageState.groups.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(input.color !== undefined ? { color: input.color } : {}),
  }
  storageState.groups = [...storageState.groups, created]
  return created
})

vi.mock('../groupStore', () => ({
  updateGroupList: (updater: UpdaterFn<SessionGroup[]>) => updateGroupListMock(updater),
  listGroups: async () => storageState.groups,
  createGroup: (input: { name: string; parentId?: string | null; color?: string }) => createGroupMock(input),
}))

let sessionCounter = 0
const copySessionMock = vi.fn(async (sourceMeta: SessionMeta) => {
  sessionCounter += 1
  const copied: SessionMeta = {
    ...sourceMeta,
    id: `copied-${sessionCounter}-${sourceMeta.id}`,
    name: `${sourceMeta.name} (copy)`,
  }
  storageState.sessions = [...storageState.sessions, copied]
  return copied
})

vi.mock('./crud', () => ({
  _copySession: (sourceMeta: SessionMeta) => copySessionMock(sourceMeta),
}))

async function importFresh() {
  vi.resetModules()
  return await import('./groups.js')
}

describe('session/groups', () => {
  beforeEach(() => {
    storageState.groups = []
    storageState.sessions = []
    updateSessionListMock.mockClear()
    updateSessionListMock.mockImplementation(async (updater: UpdaterFn<SessionMeta[]>) => {
      storageState.sessions = updater(storageState.sessions)
    })
    updateSessionMock.mockClear()
    updateSessionMock.mockImplementation(
      async (sessionId: string, updater: UpdaterFn<Omit<SessionMeta, 'messages'>>) => {
        storageState.sessions = storageState.sessions.map((s) =>
          s.id === sessionId ? ({ ...s, ...updater(s) } as SessionMeta) : s
        )
      }
    )
    updateGroupListMock.mockClear()
    updateGroupListMock.mockImplementation(async (updater: UpdaterFn<SessionGroup[]>) => {
      storageState.groups = updater(storageState.groups)
    })
    createGroupMock.mockClear()
    groupCounter = 0
    createGroupMock.mockImplementation(async (input: { name: string; parentId?: string | null; color?: string }) => {
      groupCounter += 1
      const id = `group:new-${groupCounter}`
      const created: SessionGroup = {
        id,
        name: input.name,
        parentId: input.parentId ?? null,
        sortIndex: storageState.groups.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(input.color !== undefined ? { color: input.color } : {}),
      }
      storageState.groups = [...storageState.groups, created]
      return created
    })
    copySessionMock.mockClear()
    sessionCounter = 0
    copySessionMock.mockImplementation(async (sourceMeta: SessionMeta) => {
      sessionCounter += 1
      const copied: SessionMeta = {
        ...sourceMeta,
        id: `copied-${sessionCounter}-${sourceMeta.id}`,
        name: `${sourceMeta.name} (copy)`,
      }
      storageState.sessions = [...storageState.sessions, copied]
      return copied
    })
  })

  it('moveSessionToGroup(id, null) clears groupId and sortIndex', async () => {
    const mod = await importFresh()
    storageState.sessions = [
      { id: 's1', name: 's1', groupId: 'group:x', sortIndex: 7 } as SessionMeta,
      { id: 's2', name: 's2' } as SessionMeta,
    ]
    await mod.moveSessionToGroup('s1', null)
    const s1 = storageState.sessions.find((s) => s.id === 's1')
    expect(s1?.groupId).toBeUndefined()
    expect(s1?.sortIndex).toBeUndefined()
  })

  it('moveSessionToGroup(id, "group:x", 2) sets groupId and sortIndex', async () => {
    const mod = await importFresh()
    storageState.sessions = [{ id: 's1', name: 's1' } as SessionMeta]
    await mod.moveSessionToGroup('s1', 'group:x', 2)
    const s1 = storageState.sessions.find((s) => s.id === 's1')
    expect(s1?.groupId).toBe('group:x')
    expect(s1?.sortIndex).toBe(2)
  })

  it('reorderWithinGroup only reassigns sortIndex for target-group sessions', async () => {
    const mod = await importFresh()
    storageState.sessions = [
      { id: 'a1', name: 'a1', groupId: 'group:a', sortIndex: 0 } as SessionMeta,
      { id: 'a2', name: 'a2', groupId: 'group:a', sortIndex: 1 } as SessionMeta,
      { id: 'a3', name: 'a3', groupId: 'group:a', sortIndex: 2 } as SessionMeta,
      { id: 'b1', name: 'b1', groupId: 'group:b', sortIndex: 5 } as SessionMeta,
      { id: 'n1', name: 'n1', sortIndex: 99 } as SessionMeta,
    ]
    // move a1 from index 0 to index 2 in group:a -> order becomes [a2, a3, a1]
    await mod.reorderWithinGroup('group:a', 0, 2)
    const byId = Object.fromEntries(storageState.sessions.map((s) => [s.id, s]))
    expect(byId.a2.sortIndex).toBe(0)
    expect(byId.a3.sortIndex).toBe(1)
    expect(byId.a1.sortIndex).toBe(2)
    // untouched groups/sessions
    expect(byId.b1.sortIndex).toBe(5)
    expect(byId.n1.sortIndex).toBe(99)
  })

  it('reorderGroups applies arrayMove and renumbers sortIndex from 0', async () => {
    const mod = await importFresh()
    storageState.groups = [
      { id: 'group:a', name: 'a', parentId: null, sortIndex: 0, createdAt: 1, updatedAt: 1 },
      { id: 'group:b', name: 'b', parentId: null, sortIndex: 1, createdAt: 2, updatedAt: 2 },
      { id: 'group:c', name: 'c', parentId: null, sortIndex: 2, createdAt: 3, updatedAt: 3 },
    ]
    // move 'c' (index 2) to index 0 -> order becomes [c, a, b]
    await mod.reorderGroups(2, 0)
    const sorted = [...storageState.groups].sort((a, b) => a.sortIndex - b.sortIndex)
    expect(sorted.map((g) => g.id)).toEqual(['group:c', 'group:a', 'group:b'])
    expect(sorted.map((g) => g.sortIndex)).toEqual([0, 1, 2])
  })

  it('reorderChildGroups only renumbers siblings sharing the parent, leaves others alone', async () => {
    const mod = await importFresh()
    storageState.groups = [
      { id: 'group:root', name: 'root', parentId: null, sortIndex: 0, createdAt: 1, updatedAt: 1 },
      { id: 'group:other', name: 'other', parentId: null, sortIndex: 1, createdAt: 2, updatedAt: 2 },
      { id: 'group:c1', name: 'c1', parentId: 'group:root', sortIndex: 0, createdAt: 3, updatedAt: 3 },
      { id: 'group:c2', name: 'c2', parentId: 'group:root', sortIndex: 1, createdAt: 4, updatedAt: 4 },
      { id: 'group:c3', name: 'c3', parentId: 'group:root', sortIndex: 2, createdAt: 5, updatedAt: 5 },
      { id: 'group:x1', name: 'x1', parentId: 'group:other', sortIndex: 0, createdAt: 6, updatedAt: 6 },
    ]
    // move c3 (sibling-index 2) to index 0 -> [c3, c1, c2]
    await mod.reorderChildGroups('group:root', 2, 0)
    const childrenOfRoot = storageState.groups
      .filter((g) => g.parentId === 'group:root')
      .sort((a, b) => a.sortIndex - b.sortIndex)
    expect(childrenOfRoot.map((g) => g.id)).toEqual(['group:c3', 'group:c1', 'group:c2'])
    expect(childrenOfRoot.map((g) => g.sortIndex)).toEqual([0, 1, 2])
    // unrelated groups untouched
    expect(storageState.groups.find((g) => g.id === 'group:other')?.sortIndex).toBe(1)
    expect(storageState.groups.find((g) => g.id === 'group:x1')?.sortIndex).toBe(0)
  })

  it('reorderChildGroups is a no-op when oldIndex === newIndex or out of range', async () => {
    const mod = await importFresh()
    storageState.groups = [
      { id: 'group:root', name: 'root', parentId: null, sortIndex: 0, createdAt: 1, updatedAt: 1 },
      { id: 'group:c1', name: 'c1', parentId: 'group:root', sortIndex: 0, createdAt: 2, updatedAt: 2 },
      { id: 'group:c2', name: 'c2', parentId: 'group:root', sortIndex: 1, createdAt: 3, updatedAt: 3 },
    ]
    const updatedAtBefore = storageState.groups.find((g) => g.id === 'group:c1')?.updatedAt
    await mod.reorderChildGroups('group:root', 0, 0)
    await mod.reorderChildGroups('group:root', -1, 1)
    await mod.reorderChildGroups('group:root', 0, 99)
    expect(storageState.groups.find((g) => g.id === 'group:c1')?.updatedAt).toBe(updatedAtBefore)
    expect(storageState.groups.find((g) => g.id === 'group:c1')?.sortIndex).toBe(0)
    expect(storageState.groups.find((g) => g.id === 'group:c2')?.sortIndex).toBe(1)
  })

  it('duplicateGroup on a leaf root with 2 sessions creates 1 group + 2 sessions', async () => {
    const mod = await importFresh()
    storageState.groups = [
      { id: 'group:src', name: 'src', parentId: null, sortIndex: 0, createdAt: 1, updatedAt: 1, color: '#abc' },
    ]
    storageState.sessions = [
      { id: 's1', name: 's1', groupId: 'group:src' } as SessionMeta,
      { id: 's2', name: 's2', groupId: 'group:src' } as SessionMeta,
      { id: 's3', name: 's3' } as SessionMeta,
    ]

    const created = await mod.duplicateGroup('group:src')

    expect(created.name).toBe('src (copy)')
    expect(created.parentId).toBe(null)
    expect(created.color).toBe('#abc')
    expect(createGroupMock).toHaveBeenCalledTimes(1)
    expect(copySessionMock).toHaveBeenCalledTimes(2)
    const copiedSessions = storageState.sessions.filter((s) => s.id.startsWith('copied-'))
    expect(copiedSessions).toHaveLength(2)
    expect(copiedSessions.every((s) => s.groupId === created.id)).toBe(true)
  })

  it('duplicateGroup on a root with one child + sessions maps children correctly', async () => {
    const mod = await importFresh()
    storageState.groups = [
      { id: 'group:src', name: 'src', parentId: null, sortIndex: 0, createdAt: 1, updatedAt: 1 },
      { id: 'group:c1', name: 'c1', parentId: 'group:src', sortIndex: 1, createdAt: 2, updatedAt: 2 },
    ]
    storageState.sessions = [
      { id: 'sr', name: 'sr', groupId: 'group:src' } as SessionMeta,
      { id: 'sc', name: 'sc', groupId: 'group:c1' } as SessionMeta,
      { id: 'unrelated', name: 'unrelated' } as SessionMeta,
    ]

    const created = await mod.duplicateGroup('group:src')

    expect(createGroupMock).toHaveBeenCalledTimes(2)
    expect(copySessionMock).toHaveBeenCalledTimes(2)
    const groupsAfter = storageState.groups
    const newRoot = groupsAfter.find((g) => g.id === created.id)
    expect(newRoot?.parentId).toBe(null)
    const newChild = groupsAfter.find((g) => g.parentId === created.id)
    expect(newChild?.name).toBe('c1')
    const copiedSessions = storageState.sessions.filter((s) => s.id.startsWith('copied-'))
    expect(copiedSessions).toHaveLength(2)
    const copyOfRootSession = copiedSessions.find((s) => s.id.endsWith('sr'))
    const copyOfChildSession = copiedSessions.find((s) => s.id.endsWith('sc'))
    expect(copyOfRootSession?.groupId).toBe(created.id)
    expect(copyOfChildSession?.groupId).toBe(newChild?.id)
  })
})
