import type { Folder } from '@shared/types/folder'

/**
 * Compute a fractional `sortOrder` for an item placed between `before` and
 * `after` siblings (both already sorted descending). Inlined here (rather than
 * imported from folderStore) so the resolver stays free of platform/storage
 * side-effect imports and is unit-testable in a node environment.
 */
function computeSortOrder(before?: { sortOrder: number }, after?: { sortOrder: number }): number {
  if (!before && !after) return Date.now()
  if (!before) return (after?.sortOrder ?? Date.now()) + 1000
  if (!after) return (before.sortOrder ?? Date.now()) - 1000
  return (before.sortOrder + after.sortOrder) / 2
}

/**
 * Sidebar tree drag & drop target resolution (Phase 4).
 *
 * The tree is rendered as a flat virtualized list (see {@link SidebarTree}),
 * so a drag operates on flat row indices. This module is a *pure* function:
 * given the flat rows, the dragged item id, and the id it was dropped over, it
 * computes the resulting placement — a new `parentId`, `sortOrder`, and (for
 * pinned↔tree transitions) a `starred` flag. Store mutations live in
 * {@link applyTreeDrop}; keeping resolution pure makes it unit-testable without
 * IndexedDB / React.
 */

/** Identifier for the pinned section (a virtual drop target). */
export const PINNED_SECTION_ID = '__pinned__'
/** Identifier for the empty-tree root slot (drop here → top-level). */
export const ROOT_DROP_ID = '__root__'

export interface SidebarFlatRow {
  id: string
  kind: 'folder' | 'session'
  depth: number
  /** Parent id at this row (null = root). */
  parentId: string | null
  sortOrder: number
}

/** What kind of move the drop represents, surfaced for analytics / tests. */
export type TreeDropKind =
  | 'reorder-within-parent' // same parent, just re-sorted
  | 'move-to-folder' // different parent (folder or root)
  | 'pin' // dragged from tree → pinned section
  | 'unpin' // dragged from pinned section → tree

export interface TreeDropResult {
  /** Id of the dragged item. */
  itemId: string
  kind: 'folder' | 'session'
  /** New parent folder id, or null for root. */
  newParentId: string | null
  /** New fractional sortOrder within the new parent. */
  newSortOrder: number
  /** New starred state. Only changes on pin/unpin transitions. */
  newStarred: boolean
  /** Describes the move for analytics/tests. */
  moveKind: TreeDropKind
}

interface ResolveArgs {
  rows: SidebarFlatRow[]
  draggedId: string
  /** Id of the row (or virtual target) the drag ended over. */
  overId: string
  /** Current starred state of the dragged session (folders are never starred). */
  draggedStarred: boolean
  /**
   * Folder list, used for cycle detection when a folder is dragged into one of
   * its own descendants.
   */
  folders: Folder[]
}

/**
 * Determine whether dropping `draggedId` over `overId` is allowed.
 * Returns `null` for disallowed drops (same item, cyclic folder move, etc.).
 */
export function computeTreeDrop(args: ResolveArgs): TreeDropResult | null {
  const { rows, draggedId, overId, draggedStarred, folders } = args

  const dragged = rows.find((row) => row.id === draggedId)
  if (!dragged) return null
  // Can't drop a row onto itself.
  if (draggedId === overId) return null

  // --- Pinned section transitions -------------------------------------------------
  if (overId === PINNED_SECTION_ID) {
    if (dragged.kind !== 'session') return null // folders cannot be pinned
    if (draggedStarred) return null // already pinned
    return {
      itemId: draggedId,
      kind: 'session',
      newParentId: null,
      newSortOrder: dragged.sortOrder,
      newStarred: true,
      moveKind: 'pin',
    }
  }

  if (overId === ROOT_DROP_ID) {
    // Drop into the root (top-level) — place above everything at the root.
    return resolveFolderDrop(rows, dragged, null, folders)
  }

  const over = rows.find((row) => row.id === overId)
  if (!over) return null

  // Dragging from the pinned section onto a tree row → unpin + nest/reorder.
  if (draggedStarred && dragged.kind === 'session') {
    if (over.kind === 'folder') {
      // Pinned session dropped onto a folder → unpin and move into the folder.
      return resolveFolderDrop(rows, dragged, over.id, folders, { unpin: true })
    }
    // Pinned session dropped onto a session → unpin and reorder within that
    // session's parent.
    return resolveReorder(rows, dragged, over.parentId, over.id, folders, { unpin: true })
  }

  // --- Same-kind drops (folder over folder/session, session over session/folder) ---
  if (dragged.kind === 'folder' && over.kind === 'folder') {
    // Dropping a folder onto another folder nests it inside (unless it's the
    // same parent already, in which case it's a reorder).
    return resolveFolderDrop(rows, dragged, over.id, folders)
  }

  if (dragged.kind === 'session' && over.kind === 'folder') {
    // Dropping a session onto a folder nests it inside that folder.
    return resolveFolderDrop(rows, dragged, over.id, folders)
  }

  // Folder or session dropped onto a session row → reorder within the session's
  // parent (i.e. take the session's parent as the new parent, place between
  // neighbors).
  if (over.kind === 'session') {
    return resolveReorder(rows, dragged, over.parentId, over.id, folders)
  }

  return null
}

/**
 * Resolve a drop that nests `dragged` inside `targetFolderId` (or root when
 * null). Computes a sortOrder that places the item at the top of its new
 * siblings. Rejects cyclic folder moves.
 */
function resolveFolderDrop(
  rows: SidebarFlatRow[],
  dragged: SidebarFlatRow,
  targetFolderId: string | null,
  folders: Folder[],
  options: { unpin?: boolean } = {}
): TreeDropResult | null {
  // Cycle detection: a folder cannot be moved into itself or into one of its
  // own descendants. `targetFolderId` is invalid if it is the dragged folder or
  // anywhere beneath it — i.e. target is a descendant of dragged.
  if (dragged.kind === 'folder' && targetFolderId !== null) {
    if (isDescendantFolder(dragged.id, targetFolderId, folders)) {
      return null
    }
  }

  // If the item is already in this parent and (for sessions) we're not unpinning,
  // a "move into" onto the same parent is a no-op reorder-to-top; allow it but
  // it just re-sorts to top.
  const siblings = rows.filter((row) => row.parentId === targetFolderId && row.id !== dragged.id)
  // Place at the very top of the target's children (highest sortOrder).
  const topSibling = siblings.sort((a, b) => b.sortOrder - a.sortOrder)[0]
  const newSortOrder = topSibling ? topSibling.sortOrder + 1000 : Date.now()

  const wasPinned = options.unpin === true
  const sameParent = dragged.parentId === targetFolderId

  let moveKind: TreeDropKind
  if (wasPinned) {
    moveKind = 'unpin'
  } else if (sameParent) {
    moveKind = 'reorder-within-parent'
  } else {
    moveKind = 'move-to-folder'
  }

  return {
    itemId: dragged.id,
    kind: dragged.kind,
    newParentId: targetFolderId,
    newSortOrder,
    // Folders and tree sessions are never pinned; only the pin/unpin branches
    // above can set newStarred to true.
    newStarred: false,
    moveKind,
  }
}

/**
 * Resolve a drop that reorders `dragged` to sit adjacent to the `anchorId` row
 * within `parentId`. The dragged item keeps/moves to `parentId` and gets a
 * fractional sortOrder computed from its new neighbors.
 */
function resolveReorder(
  rows: SidebarFlatRow[],
  dragged: SidebarFlatRow,
  parentId: string | null,
  anchorId: string,
  folders: Folder[],
  options: { unpin?: boolean } = {}
): TreeDropResult | null {
  if (dragged.kind === 'folder' && parentId !== null) {
    if (isDescendantFolder(parentId, dragged.id, folders)) {
      return null
    }
  }

  const wasPinned = options.unpin === true
  // Siblings of the anchor within the target parent (excluding the dragged item).
  const siblings = rows
    .filter((row) => row.parentId === parentId && row.id !== dragged.id)
    .sort((a, b) => b.sortOrder - a.sortOrder)

  const anchorIndex = siblings.findIndex((row) => row.id === anchorId)
  // Place the dragged item immediately *above* the anchor (higher sortOrder,
  // so it renders above the anchor in the descending list). `before` is the
  // sibling immediately above the dragged item's new slot; `after` is the
  // anchor itself (immediately below). In a descending-sorted list, index-1 is
  // the higher sortOrder neighbor.
  const before = anchorIndex > 0 ? siblings[anchorIndex - 1] : undefined
  const after = anchorIndex >= 0 ? siblings[anchorIndex] : undefined

  const newSortOrder = computeSortOrder(before, after)

  const sameParent = dragged.parentId === parentId
  let moveKind: TreeDropKind
  if (wasPinned) {
    moveKind = 'unpin'
  } else if (sameParent) {
    moveKind = 'reorder-within-parent'
  } else {
    moveKind = 'move-to-folder'
  }

  return {
    itemId: dragged.id,
    kind: dragged.kind,
    newParentId: parentId,
    newSortOrder,
    newStarred: false,
    moveKind,
  }
}

/**
 * Returns true if `ancestorId` is the same as `descendantId` or contains it at
 * any depth. Local to this module so the pure resolver doesn't need the store
 * cache (the folder list is passed in).
 */
function isDescendantFolder(ancestorId: string, descendantId: string, folders: Folder[]): boolean {
  if (ancestorId === descendantId) return true
  const childrenByParent = new Map<string | null, Folder[]>()
  for (const folder of folders) {
    const key = folder.parentId ?? null
    const list = childrenByParent.get(key)
    if (list) list.push(folder)
    else childrenByParent.set(key, [folder])
  }
  const stack = [...(childrenByParent.get(ancestorId) ?? [])]
  while (stack.length) {
    const current = stack.pop()
    if (!current) break
    if (current.id === descendantId) return true
    stack.push(...(childrenByParent.get(current.id) ?? []))
  }
  return false
}

/**
 * Apply a resolved drop to the stores. Imports are dynamic so the pure
 * resolver above stays free of store/storage dependencies (and testable in a
 * node environment).
 */
export async function applyTreeDrop(result: TreeDropResult): Promise<void> {
  if (result.kind === 'folder') {
    const { moveFolder } = await import('@/stores/folderStore')
    await moveFolder(result.itemId, result.newParentId, result.newSortOrder)
    return
  }

  // session moves
  const { moveSession } = await import('@/stores/session/crud')
  const { updateSession } = await import('@/stores/chatStore')

  // Pin/unpin transitions change `starred`; the parentId also changes (pinned
  // items live at root). Handle starred first via updateSession (which persists
  // through getSessionMeta), then move the session to its new parent/sortOrder.
  if (result.moveKind === 'pin' || result.moveKind === 'unpin') {
    await updateSession(result.itemId, { starred: result.newStarred })
  }
  await moveSession(result.itemId, result.newParentId, result.newSortOrder)
}
