/**
 * React Query cache + imperative CRUD helpers for {@link Folder} records.
 *
 * Mirrors the flattened-page pattern used by `chatStore` for session metadata:
 * the cache holds a single "page" of all folders, and `updateFolderListData`
 * lets imperative helpers mutate it optimistically.
 */

import type { Folder } from '@shared/types/folder'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import type { FolderStorage } from '@/storage/FolderStorage'
import { sortFolderRecords } from '@/storage/FolderStorage'
import queryClient from './queryClient'

const log = getLogger('folder-store')

export const FolderQueryKeys = {
  Folders: ['folders'] as const,
}

// The folder list cache stores a bare `Folder[]` — the same shape returned by
// `listFoldersFromStorage` (the queryFn). Do NOT wrap it in `{ items }`;
// otherwise `useFolderList().folderList` becomes a non-iterable object after
// the first mutation, breaking `buildSidebarTree` ("folderList is not
// iterable").
type FolderListData = Folder[]

let _folderStorage: FolderStorage | null = null

async function getFolderStorage(): Promise<FolderStorage> {
  if (!_folderStorage) {
    _folderStorage = platform.getFolderStorage()
    await _folderStorage.initialize()
  }
  return _folderStorage
}

async function listFoldersFromStorage(): Promise<Folder[]> {
  try {
    const storage = await getFolderStorage()
    return await storage.getAll()
  } catch (error) {
    log.error('Failed to read folders from storage:', error)
    throw error
  }
}

const folderListQueryOptions = {
  queryKey: FolderQueryKeys.Folders,
  queryFn: () => listFoldersFromStorage(),
  staleTime: Infinity,
}

/** Hook returning the cached folder list + helpers, mirroring `useSessionList`. */
export function useFolderList() {
  const result = useQuery(folderListQueryOptions)
  const folderList = useMemo(() => result.data, [result.data])
  return {
    folderList,
    refetch: result.refetch,
    isLoading: result.isLoading,
  }
}

/** Get all cached folders (without triggering a fetch). */
export function getCachedFolders(): Folder[] {
  const data = queryClient.getQueryData<FolderListData>(FolderQueryKeys.Folders)
  return data ?? []
}

/** Get all folders, fetching from storage if the cache is empty. */
export async function listFolders(): Promise<Folder[]> {
  const cached = getCachedFolders()
  if (cached.length > 0) return cached
  const data = await queryClient.fetchQuery(folderListQueryOptions)
  return data ?? []
}

/** Update the folder list cache. */
export function updateFolderListData(updater: (items: Folder[]) => Folder[]) {
  queryClient.setQueryData<FolderListData>(FolderQueryKeys.Folders, (old) => {
    const items = old ?? []
    return sortFolderRecords(updater(items))
  })
}

/** Re-read the folder list from storage and refresh the cache. */
export async function refreshFolderListCache() {
  const items = await listFoldersFromStorage()
  queryClient.setQueryData<FolderListData>(FolderQueryKeys.Folders, items)
}

/**
 * Compute a fractional `sortOrder` for an item being placed between `before`
 * and `after` siblings (both already sorted descending). Falls back to
 * `Date.now()` when the slot is unbounded, matching the session convention.
 */
export function computeFolderSortOrder(before?: Folder, after?: Folder): number {
  if (!before && !after) return Date.now()
  if (!before) return (after?.sortOrder ?? Date.now()) + 1000
  if (!after) return (before.sortOrder ?? Date.now()) - 1000
  return (before.sortOrder + after.sortOrder) / 2
}

/** Create a new folder (optionally nested under `parentId`). */
export async function createFolder(name: string, parentId: string | null = null): Promise<Folder> {
  const storage = await getFolderStorage()
  const existing = getCachedFolders()
  const siblings = existing.filter((folder) => (folder.parentId ?? null) === parentId)
  // New folders go to the top (highest sortOrder), above existing siblings.
  const topSibling = siblings[0]
  const sortOrder = topSibling ? topSibling.sortOrder + 1000 : Date.now()

  const folder: Folder = {
    id: uuidv4(),
    type: 'folder',
    name,
    parentId,
    sortOrder,
    createdAt: Date.now(),
  }
  await storage.create(folder)
  updateFolderListData((items) => [...items, folder])
  return folder
}

/** Update arbitrary fields of a folder. */
export async function updateFolder(id: string, updates: Partial<Folder>): Promise<Folder | null> {
  const storage = await getFolderStorage()
  const updated = await storage.update(id, updates)
  if (updated) {
    updateFolderListData((items) => items.map((folder) => (folder.id === id ? updated : folder)))
  }
  return updated
}

/** Delete a folder by id. Callers should confirm child emptiness beforehand. */
export async function deleteFolder(id: string): Promise<void> {
  const storage = await getFolderStorage()
  await storage.delete(id)
  updateFolderListData((items) => items.filter((folder) => folder.id !== id))
}

/**
 * Move a folder to a new parent (or root) with a target `sortOrder`. The caller
 * is responsible for cycle detection (see `sessionTreeActions`).
 */
export async function moveFolder(id: string, parentId: string | null, sortOrder: number): Promise<void> {
  await updateFolder(id, { parentId, sortOrder })
}

/**
 * Returns true if `descendantId` is the same as `ancestorId` or nested anywhere
 * beneath `ancestorId` in the cached folder tree. Used to prevent cyclic moves.
 */
export function isFolderDescendant(ancestorId: string, descendantId: string): boolean {
  if (ancestorId === descendantId) return true
  const folders = getCachedFolders()
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
