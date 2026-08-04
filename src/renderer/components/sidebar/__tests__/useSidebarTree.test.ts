import type { Folder } from '@shared/types/folder'
import type { SessionMetaRecord } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { buildSidebarTree, flattenSidebarTree, selectPinnedSessions } from '../useSidebarTree'

function makeFolder(overrides: Partial<Folder> & { id: string }): Folder {
  return {
    type: 'folder',
    name: overrides.name ?? 'Folder',
    parentId: overrides.parentId ?? null,
    sortOrder: overrides.sortOrder ?? Date.now(),
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  }
}

function makeSession(overrides: Partial<SessionMetaRecord> & { id: string; sortOrder: number }): SessionMetaRecord {
  return {
    name: 'Chat',
    createdAt: Date.now(),
    ...overrides,
  }
}

function buildTree(args: { sessions: SessionMetaRecord[]; folders: Folder[]; expandedFolderIds: Set<string> }) {
  return buildSidebarTree(args)
}

describe('buildSidebarTree', () => {
  it('nests a session under its parent folder (regression: chats must appear in folder)', () => {
    const folder = makeFolder({ id: 'folder-1', name: 'Work', sortOrder: 100 })
    const sessionInFolder = makeSession({
      id: 'session-1',
      sortOrder: 200,
      parentId: 'folder-1',
      name: 'Project chat',
    })
    const topSession = makeSession({ id: 'session-2', sortOrder: 50, parentId: undefined, name: 'Loose chat' })

    const tree = buildTree({
      sessions: [sessionInFolder, topSession],
      folders: [folder],
      expandedFolderIds: new Set(['folder-1']),
    })

    // Root should contain the folder and the top-level session, sorted desc.
    expect(tree.map((node) => node.id)).toEqual(['folder-1', 'session-2'])

    const folderNode = tree.find((node) => node.kind === 'folder' && node.id === 'folder-1')
    expect(folderNode).toBeDefined()
    expect(folderNode?.kind).toBe('folder')
    if (folderNode?.kind === 'folder') {
      // The session with parentId must appear nested inside the expanded folder.
      expect(folderNode.children.map((child) => child.id)).toEqual(['session-1'])
    }
  })

  it('hides children of collapsed folders but still lists the folder', () => {
    const folder = makeFolder({ id: 'folder-1', sortOrder: 100 })
    const nested = makeSession({ id: 'session-1', sortOrder: 200, parentId: 'folder-1' })

    const tree = buildTree({
      sessions: [nested],
      folders: [folder],
      expandedFolderIds: new Set(),
    })

    expect(tree.map((node) => node.id)).toEqual(['folder-1'])
    const folderNode = tree[0]
    expect(folderNode?.kind).toBe('folder')
    if (folderNode?.kind === 'folder') {
      expect(folderNode.children).toHaveLength(0)
    }
  })

  it('excludes pinned, hidden, and archived sessions from the tree', () => {
    const folder = makeFolder({ id: 'folder-1', sortOrder: 100 })
    const pinned = makeSession({ id: 'p', sortOrder: 300, parentId: 'folder-1', starred: true })
    const hidden = makeSession({ id: 'h', sortOrder: 200, parentId: 'folder-1', hidden: true })
    const archived = makeSession({ id: 'a', sortOrder: 100, parentId: 'folder-1', archivedAt: 1234 })

    const tree = buildTree({
      sessions: [pinned, hidden, archived],
      folders: [folder],
      expandedFolderIds: new Set(['folder-1']),
    })

    const folderNode = tree[0]
    if (folderNode?.kind === 'folder') {
      expect(folderNode.children).toHaveLength(0)
    }
  })

  it('supports infinite nesting (folder inside folder inside folder)', () => {
    const root = makeFolder({ id: 'f1', sortOrder: 100 })
    const child = makeFolder({ id: 'f2', parentId: 'f1', sortOrder: 100 })
    const grandchild = makeFolder({ id: 'f3', parentId: 'f2', sortOrder: 100 })
    const deepSession = makeSession({ id: 's1', parentId: 'f3', sortOrder: 100 })

    const tree = buildTree({
      sessions: [deepSession],
      folders: [root, child, grandchild],
      expandedFolderIds: new Set(['f1', 'f2', 'f3']),
    })

    const flat = flattenSidebarTree(tree)
    expect(flat.map((node) => node.id)).toEqual(['f1', 'f2', 'f3', 's1'])
    // Depth increases per nesting level.
    expect(flat.map((node) => node.depth)).toEqual([0, 1, 2, 3])
  })

  it('interleaves folders and sessions by sortOrder descending within a level', () => {
    const folder = makeFolder({ id: 'f', sortOrder: 150 })
    const sessionHigh = makeSession({ id: 's-high', sortOrder: 200 })
    const sessionLow = makeSession({ id: 's-low', sortOrder: 100 })

    const tree = buildTree({
      sessions: [sessionLow, sessionHigh],
      folders: [folder],
      expandedFolderIds: new Set(),
    })

    // 200 (session-high) > 150 (folder) > 100 (session-low)
    expect(tree.map((node) => node.id)).toEqual(['s-high', 'f', 's-low'])
  })

  it('assigns depth 0 to root items and increments for nested children', () => {
    const folder = makeFolder({ id: 'f1', sortOrder: 100 })
    const nested = makeSession({ id: 's1', parentId: 'f1', sortOrder: 100 })

    const tree = buildTree({
      sessions: [nested],
      folders: [folder],
      expandedFolderIds: new Set(['f1']),
    })

    expect(tree[0]?.depth).toBe(0)
    const folderNode = tree[0]
    if (folderNode?.kind === 'folder') {
      expect(folderNode.children[0]?.depth).toBe(1)
    }
  })

  it('propagates folder moves to all descendants (parentId relationship preserved)', () => {
    // Simulate a folder `f1` that was just moved under a new root folder
    // `f-new`. Its descendants (subfolder f2 + chat s1) keep their parentId
    // pointing at f1, so they automatically follow f1 wherever it goes — no
    // per-descendant move required. This is the core propagation guarantee.
    const fNew = makeFolder({ id: 'f-new', sortOrder: 500 })
    const f1 = makeFolder({ id: 'f1', parentId: 'f-new', sortOrder: 400 })
    const f2 = makeFolder({ id: 'f2', parentId: 'f1', sortOrder: 300 })
    const s1 = makeSession({ id: 's1', parentId: 'f1', sortOrder: 200 })
    const s2 = makeSession({ id: 's2', parentId: 'f2', sortOrder: 100 })

    const tree = buildTree({
      sessions: [s1, s2],
      folders: [fNew, f1, f2],
      expandedFolderIds: new Set(['f-new', 'f1', 'f2']),
    })

    const flat = flattenSidebarTree(tree)
    // Full hierarchy follows f1 → f-new root: f-new > f1 > (f2 > s2), s1
    expect(flat.map((node) => node.id)).toEqual(['f-new', 'f1', 'f2', 's2', 's1'])
    expect(flat.map((node) => node.depth)).toEqual([0, 1, 2, 3, 2])
  })
})

describe('selectPinnedSessions', () => {
  it('returns only starred, non-hidden, non-archived sessions sorted by sortOrder desc', () => {
    const sessions = [
      makeSession({ id: 'p1', sortOrder: 100, starred: true }),
      makeSession({ id: 'p2', sortOrder: 300, starred: true }),
      makeSession({ id: 'normal', sortOrder: 500 }),
      makeSession({ id: 'p-hidden', sortOrder: 999, starred: true, hidden: true }),
      makeSession({ id: 'p-archived', sortOrder: 999, starred: true, archivedAt: 1 }),
    ]

    const result = selectPinnedSessions(sessions)
    expect(result.map((s) => s.id)).toEqual(['p2', 'p1'])
  })

  it('returns empty array for undefined input', () => {
    expect(selectPinnedSessions(undefined)).toEqual([])
  })
})
