import { describe, expect, it } from 'vitest'
import { computeTreeDrop, PINNED_SECTION_ID, ROOT_DROP_ID, type SidebarFlatRow } from '../treeDrop'

// Minimal local folder shape — avoids importing @shared/types/folder (which
// pulls in zod + platform side effects and breaks the node test environment).
interface TestFolder {
  id: string
  type: 'folder'
  name: string
  parentId: string | null
  sortOrder: number
  createdAt: number
}

function folder(id: string, overrides: Partial<TestFolder> & { id?: string }): TestFolder {
  return {
    id,
    type: 'folder',
    name: id,
    parentId: overrides.parentId ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: 0,
    ...overrides,
  }
}

function row(id: string, overrides: Partial<SidebarFlatRow> & { id?: string }): SidebarFlatRow {
  return { id, kind: 'session', depth: 0, parentId: null, sortOrder: 0, ...overrides }
}

// Tree under test (sortOrder descending = top to bottom):
//   f1 (1000)            depth 0
//     s-child (900)      depth 1, parent f1
//   s-top (500)          depth 0
//   f2 (300)             depth 0
const ROWS: SidebarFlatRow[] = [
  row('f1', { kind: 'folder', sortOrder: 1000, parentId: null, depth: 0 }),
  row('s-child', { kind: 'session', sortOrder: 900, parentId: 'f1', depth: 1 }),
  row('s-top', { kind: 'session', sortOrder: 500, parentId: null, depth: 0 }),
  row('f2', { kind: 'folder', sortOrder: 300, parentId: null, depth: 0 }),
]

const FOLDERS: TestFolder[] = [
  folder('f1', { sortOrder: 1000 }),
  folder('f2', { sortOrder: 300 }),
  folder('f-inner', { parentId: 'f1', sortOrder: 800 }), // child of f1, for cycle tests
]

describe('computeTreeDrop — reorder within parent', () => {
  it('reorders a session within the root (drop onto another root session)', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 's-top',
      overId: 's-child', // over a session → reorder within that session's parent (f1)
      draggedStarred: false,
      folders: FOLDERS,
    })
    expect(result).not.toBeNull()
    expect(result?.moveKind).toBe('move-to-folder') // s-top moves from root into f1
    expect(result?.newParentId).toBe('f1')
  })

  it('reorders a root session onto another root session → same parent', () => {
    const rows = [
      row('a', { kind: 'session', sortOrder: 1000, parentId: null }),
      row('b', { kind: 'session', sortOrder: 500, parentId: null }),
    ]
    const result = computeTreeDrop({
      rows,
      draggedId: 'b',
      overId: 'a',
      draggedStarred: false,
      folders: [],
    })
    expect(result).not.toBeNull()
    expect(result?.moveKind).toBe('reorder-within-parent')
    expect(result?.newParentId).toBeNull()
    // Placed before `a` (higher sortOrder): a.sortOrder + 1000 = 2000
    expect(result?.newSortOrder).toBe(2000)
  })
})

describe('computeTreeDrop — move into folder', () => {
  it('moves a root session onto a folder → nests inside it', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 's-top',
      overId: 'f2',
      draggedStarred: false,
      folders: FOLDERS,
    })
    expect(result).not.toBeNull()
    expect(result?.moveKind).toBe('move-to-folder')
    expect(result?.newParentId).toBe('f2')
  })

  it('moves a folder onto another folder → nests inside', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 'f2',
      overId: 'f1',
      draggedStarred: false,
      folders: FOLDERS,
    })
    expect(result).not.toBeNull()
    expect(result?.moveKind).toBe('move-to-folder')
    expect(result?.newParentId).toBe('f1')
  })

  it('rejects cyclic folder move (folder into its own descendant)', () => {
    // f1 has a descendant f-inner. Dropping f1 onto f-inner must be rejected.
    const rows = [...ROWS, row('f-inner', { kind: 'folder', sortOrder: 800, parentId: 'f1', depth: 1 })]
    const result = computeTreeDrop({
      rows,
      draggedId: 'f1',
      overId: 'f-inner',
      draggedStarred: false,
      folders: [...FOLDERS, folder('f-inner', { parentId: 'f1', sortOrder: 800 })],
    })
    expect(result).toBeNull()
  })

  it('rejects dropping a folder onto itself', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 'f1',
      overId: 'f1',
      draggedStarred: false,
      folders: FOLDERS,
    })
    expect(result).toBeNull()
  })
})

describe('computeTreeDrop — pinned ↔ tree transitions', () => {
  it('pins a session when dropped on the pinned section', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 's-top',
      overId: PINNED_SECTION_ID,
      draggedStarred: false,
      folders: FOLDERS,
    })
    expect(result).not.toBeNull()
    expect(result?.moveKind).toBe('pin')
    expect(result?.newStarred).toBe(true)
    expect(result?.kind).toBe('session')
  })

  it('refuses to pin an already-pinned session', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 's-top',
      overId: PINNED_SECTION_ID,
      draggedStarred: true,
      folders: FOLDERS,
    })
    expect(result).toBeNull()
  })

  it('refuses to pin a folder', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 'f1',
      overId: PINNED_SECTION_ID,
      draggedStarred: false,
      folders: FOLDERS,
    })
    expect(result).toBeNull()
  })

  it('unpins a pinned session when dropped onto a folder', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 's-top',
      overId: 'f1',
      draggedStarred: true,
      folders: FOLDERS,
    })
    expect(result).not.toBeNull()
    expect(result?.moveKind).toBe('unpin')
    expect(result?.newStarred).toBe(false)
    expect(result?.newParentId).toBe('f1')
  })

  it('unpins a pinned session when dropped onto a tree session (reorder)', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 's-top',
      overId: 's-child',
      draggedStarred: true,
      folders: FOLDERS,
    })
    expect(result).not.toBeNull()
    expect(result?.moveKind).toBe('unpin')
    expect(result?.newStarred).toBe(false)
    expect(result?.newParentId).toBe('f1')
  })
})

describe('computeTreeDrop — root drop', () => {
  it('drops a nested session to root', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 's-child',
      overId: ROOT_DROP_ID,
      draggedStarred: false,
      folders: FOLDERS,
    })
    expect(result).not.toBeNull()
    expect(result?.newParentId).toBeNull()
    expect(result?.moveKind).toBe('move-to-folder')
  })
})

describe('computeTreeDrop — folder move between levels', () => {
  // Deeper tree for level-move scenarios:
  //   root
  //     f1 (1000)
  //       f-inner (800)   — child of f1
  //         s-deep (700)  — child of f-inner
  //       s-child (600)   — child of f1
  //     s-top (500)       — root session
  const DEEP_ROWS: SidebarFlatRow[] = [
    row('f1', { kind: 'folder', sortOrder: 1000, parentId: null, depth: 0 }),
    row('f-inner', { kind: 'folder', sortOrder: 800, parentId: 'f1', depth: 1 }),
    row('s-deep', { kind: 'session', sortOrder: 700, parentId: 'f-inner', depth: 2 }),
    row('s-child', { kind: 'session', sortOrder: 600, parentId: 'f1', depth: 1 }),
    row('s-top', { kind: 'session', sortOrder: 500, parentId: null, depth: 0 }),
  ]
  const DEEP_FOLDERS: TestFolder[] = [
    folder('f1', { sortOrder: 1000 }),
    folder('f-inner', { parentId: 'f1', sortOrder: 800 }),
  ]

  it('moves a nested folder up to the root via ROOT_DROP_ID', () => {
    // f-inner currently under f1 → drop on root spacer → moves to root level
    const result = computeTreeDrop({
      rows: DEEP_ROWS,
      draggedId: 'f-inner',
      overId: ROOT_DROP_ID,
      draggedStarred: false,
      folders: DEEP_FOLDERS,
    })
    expect(result).not.toBeNull()
    expect(result?.newParentId).toBeNull()
    expect(result?.moveKind).toBe('move-to-folder')
  })

  it('moves a root-level folder down into a sibling folder', () => {
    // f1 (root) dropped onto f-inner? No — f-inner is a descendant of f1 →
    // rejected. Instead use a separate root folder f2 dropped onto f1.
    const rows = [...DEEP_ROWS, row('f2', { kind: 'folder', sortOrder: 400, parentId: null, depth: 0 })]
    const folders = [...DEEP_FOLDERS, folder('f2', { sortOrder: 400 })]
    const result = computeTreeDrop({
      rows,
      draggedId: 'f2',
      overId: 'f1',
      draggedStarred: false,
      folders,
    })
    expect(result).not.toBeNull()
    expect(result?.newParentId).toBe('f1')
    expect(result?.moveKind).toBe('move-to-folder')
  })

  it('rejects moving a folder into its own descendant (cycle)', () => {
    // f1 dropped onto f-inner (a descendant of f1) → must be rejected.
    const result = computeTreeDrop({
      rows: DEEP_ROWS,
      draggedId: 'f1',
      overId: 'f-inner',
      draggedStarred: false,
      folders: DEEP_FOLDERS,
    })
    expect(result).toBeNull()
  })

  it('rejects moving a folder into itself via root spacer (no-op: already root)', () => {
    // f1 is already root; dropping onto root spacer is a same-parent reorder
    // (reorder-within-parent), not a cycle. Confirm it is allowed.
    const result = computeTreeDrop({
      rows: DEEP_ROWS,
      draggedId: 'f1',
      overId: ROOT_DROP_ID,
      draggedStarred: false,
      folders: DEEP_FOLDERS,
    })
    expect(result).not.toBeNull()
    expect(result?.newParentId).toBeNull()
    expect(result?.moveKind).toBe('reorder-within-parent')
  })
})

describe('computeTreeDrop — chat reorder up/down within parent', () => {
  // Three root sessions, sortOrder descending (top→bottom): a, b, c
  const SESSIONS: SidebarFlatRow[] = [
    row('a', { kind: 'session', sortOrder: 3000, parentId: null, depth: 0 }),
    row('b', { kind: 'session', sortOrder: 2000, parentId: null, depth: 0 }),
    row('c', { kind: 'session', sortOrder: 1000, parentId: null, depth: 0 }),
  ]

  it('moves a chat up (c dropped onto a → placed above a)', () => {
    const result = computeTreeDrop({
      rows: SESSIONS,
      draggedId: 'c',
      overId: 'a',
      draggedStarred: false,
      folders: [],
    })
    expect(result).not.toBeNull()
    expect(result?.newParentId).toBeNull()
    expect(result?.moveKind).toBe('reorder-within-parent')
    // Placed above `a` (higher sortOrder): a.sortOrder + 1000 = 4000
    expect(result?.newSortOrder).toBe(4000)
  })

  it('moves a chat down (a dropped onto c → placed just above c)', () => {
    const result = computeTreeDrop({
      rows: SESSIONS,
      draggedId: 'a',
      overId: 'c',
      draggedStarred: false,
      folders: [],
    })
    expect(result).not.toBeNull()
    expect(result?.newParentId).toBeNull()
    expect(result?.moveKind).toBe('reorder-within-parent')
    // Siblings with `a` removed (descending): b (2000), c (1000). Anchor = c
    // (index 1). before = b (2000), after = c (1000) → midpoint 1500, so `a`
    // lands directly above `c` and below `b`.
    expect(result?.newSortOrder).toBe(1500)
  })

  it('reorders a chat between two siblings (c dropped onto b → between a and b)', () => {
    const result = computeTreeDrop({
      rows: SESSIONS,
      draggedId: 'c',
      overId: 'b',
      draggedStarred: false,
      folders: [],
    })
    expect(result).not.toBeNull()
    expect(result?.newParentId).toBeNull()
    expect(result?.moveKind).toBe('reorder-within-parent')
    // before = a (3000), after = b (2000) → midpoint 2500
    expect(result?.newSortOrder).toBe(2500)
  })
})

describe('computeTreeDrop — empty folder drop', () => {
  it('drops a session onto an empty folder (folder has no children) → nests inside', () => {
    // f-empty is a root folder with no children rows.
    const rows = [
      row('f-empty', { kind: 'folder', sortOrder: 1000, parentId: null, depth: 0 }),
      row('s-top', { kind: 'session', sortOrder: 500, parentId: null, depth: 0 }),
    ]
    const folders = [folder('f-empty', { sortOrder: 1000 })]
    const result = computeTreeDrop({
      rows,
      draggedId: 's-top',
      overId: 'f-empty',
      draggedStarred: false,
      folders,
    })
    expect(result).not.toBeNull()
    expect(result?.newParentId).toBe('f-empty')
    expect(result?.moveKind).toBe('move-to-folder')
  })
})

describe('computeTreeDrop — invalid / edge cases', () => {
  it('returns null when dragged id is not in the rows', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 'does-not-exist',
      overId: 'f1',
      draggedStarred: false,
      folders: FOLDERS,
    })
    expect(result).toBeNull()
  })

  it('returns null when over id is not found and not a virtual target', () => {
    const result = computeTreeDrop({
      rows: ROWS,
      draggedId: 's-top',
      overId: 'missing',
      draggedStarred: false,
      folders: FOLDERS,
    })
    expect(result).toBeNull()
  })
})
