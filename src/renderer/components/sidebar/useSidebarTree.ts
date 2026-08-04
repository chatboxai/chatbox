import type { Folder } from '@shared/types/folder'
import type { SessionMetaRecord } from '@shared/types/session'
import { useMemo } from 'react'

export type SidebarTreeNode =
  | { kind: 'folder'; id: string; folder: Folder; children: SidebarTreeNode[]; depth: number }
  | { kind: 'session'; id: string; session: SessionMetaRecord; depth: number }

interface UseSidebarTreeArgs {
  sessions: SessionMetaRecord[] | undefined
  folders: Folder[] | undefined
  expandedFolderIds: Set<string>
}

/**
 * Join folders + sessions into a hierarchical tree of {@link SidebarTreeNode}.
 *
 * Rules (per plan §3.1 / §2.2):
 * - Pinned sessions (`starred === true`) are excluded — they render in the
 *   separate pinned section above the tree.
 * - Hidden and archived sessions are excluded from the tree.
 * - Top-level items have `parentId === undefined || null`.
 * - Within each parent group, folders and sessions interleave, both sorted by
 *   `sortOrder` descending (highest first).
 * - Only children of expanded folders are included; collapsed folders emit a
 *   node with an empty `children` array.
 *
 * Returns a flat-friendly root array; the recursive `children` make it easy to
 * flatten for virtualization by the caller (see SidebarTree).
 */
/**
 * Pure core of the sidebar tree builder. Extracted from {@link useSidebarTree}
 * so it can be unit-tested without a React/jsdom environment. Joins folders +
 * sessions into a recursive tree per the rules documented on the hook.
 */
export function buildSidebarTree(args: {
  sessions: SessionMetaRecord[] | undefined
  folders: Folder[] | undefined
  expandedFolderIds: Set<string>
}): SidebarTreeNode[] {
  const folderList = args.folders ?? []
  // Exclude pinned/hidden/archived sessions from the tree.
  const sessionList = (args.sessions ?? []).filter(
    (session) => !session.starred && !session.hidden && session.archivedAt === undefined
  )

  // Index children by parentId (null/undefined → root).
  const foldersByParent = new Map<string | null, Folder[]>()
  for (const folder of folderList) {
    const key = folder.parentId ?? null
    const list = foldersByParent.get(key)
    if (list) list.push(folder)
    else foldersByParent.set(key, [folder])
  }

  const sessionsByParent = new Map<string | null, SessionMetaRecord[]>()
  for (const session of sessionList) {
    const key = session.parentId ?? null
    const list = sessionsByParent.get(key)
    if (list) list.push(session)
    else sessionsByParent.set(key, [session])
  }

  const sortDescending = <T extends { sortOrder: number }>(items: T[]): T[] =>
    [...items].sort((a, b) => b.sortOrder - a.sortOrder)

  const buildChildren = (parentId: string | null, depth: number): SidebarTreeNode[] => {
    const childFolders = sortDescending(foldersByParent.get(parentId) ?? [])
    const childSessions = sortDescending(sessionsByParent.get(parentId) ?? [])

    // Interleave folders and sessions by sortOrder descending.
    const merged: Array<{ sortOrder: number; node: SidebarTreeNode }> = []
    for (const folder of childFolders) {
      const isExpanded = args.expandedFolderIds.has(folder.id)
      const children = isExpanded ? buildChildren(folder.id, depth + 1) : []
      const node: SidebarTreeNode = { kind: 'folder', id: folder.id, folder, children, depth }
      merged.push({ sortOrder: folder.sortOrder, node })
    }
    for (const session of childSessions) {
      const node: SidebarTreeNode = { kind: 'session', id: session.id, session, depth }
      merged.push({ sortOrder: session.sortOrder, node })
    }
    merged.sort((a, b) => b.sortOrder - a.sortOrder)
    return merged.map((entry) => entry.node)
  }

  return buildChildren(null, 0)
}

export function useSidebarTree({ sessions, folders, expandedFolderIds }: UseSidebarTreeArgs): SidebarTreeNode[] {
  return useMemo(
    () => buildSidebarTree({ sessions, folders, expandedFolderIds }),
    [sessions, folders, expandedFolderIds]
  )
}

/**
 * Flatten the recursive tree into a single ordered array (depth-first, parent
 * before children). Used by the virtualized list renderer in SidebarTree so the
 * DOM stays flat while still respecting nesting order.
 */
export function flattenSidebarTree(nodes: SidebarTreeNode[]): SidebarTreeNode[] {
  const out: SidebarTreeNode[] = []
  const walk = (list: SidebarTreeNode[]) => {
    for (const node of list) {
      out.push(node)
      if (node.kind === 'folder') {
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return out
}

/** Pinned sessions: flat list, excluded from the tree, sorted by sortOrder desc. */
export function selectPinnedSessions(sessions: SessionMetaRecord[] | undefined): SessionMetaRecord[] {
  if (!sessions) return []
  return sessions
    .filter((session) => session.starred && !session.hidden && session.archivedAt === undefined)
    .sort((a, b) => b.sortOrder - a.sortOrder)
}
