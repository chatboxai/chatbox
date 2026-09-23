import { QueryKeys } from '@chatbox/react/query'
import type { SessionFolder } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { rendererApplication } from '@/app/renderer-application'
import storage from '@/storage'
import { StorageKey } from '@/storage/StoreStorage'
import { getMetaStorage } from './sessionHelpers'
import { uiStore } from './uiStore'

// MARK: session folders
// Folders are a small flat list persisted as a single KV blob (no pagination/indexes needed),
// unlike session metas which live in SessionMetaStorage.

export function sortFolders<T extends { sortOrder: number }>(folders: T[]): T[] {
  return [...folders].sort((a, b) => b.sortOrder - a.sortOrder)
}

async function listFolders(): Promise<SessionFolder[]> {
  const queryClient = rendererApplication.queryClient
  const cached = queryClient.getQueryData<SessionFolder[]>(QueryKeys.SessionFolders)
  if (cached) return cached
  const folders = sortFolders(await storage.getItem<SessionFolder[]>(StorageKey.SessionFolders, []))
  queryClient.setQueryData(QueryKeys.SessionFolders, folders)
  return folders
}

export function useFolders() {
  const { data, isLoading } = useQuery({
    queryKey: QueryKeys.SessionFolders,
    queryFn: () => listFolders(),
    staleTime: Infinity,
  })
  return { folders: data ?? [], isLoading }
}

function updateFoldersData(updater: (folders: SessionFolder[]) => SessionFolder[]) {
  rendererApplication.queryClient.setQueryData<SessionFolder[]>(QueryKeys.SessionFolders, (old) => updater(old ?? []))
}

async function persistFolders(folders: SessionFolder[]) {
  await storage.setItemNow(StorageKey.SessionFolders, folders)
  updateFoldersData(() => folders)
}

export async function createFolder(name: string): Promise<SessionFolder> {
  const folders = await listFolders()
  const folder: SessionFolder = {
    id: uuidv4(),
    name,
    // Place the new folder above existing ones, mirroring how new chats sort to the top.
    sortOrder: (folders[0]?.sortOrder ?? 0) + 1000,
    createdAt: Date.now(),
  }
  await persistFolders(sortFolders([folder, ...folders]))
  return folder
}

export async function renameFolder(folderId: string, name: string) {
  const folders = await listFolders()
  await persistFolders(folders.map((f) => (f.id === folderId ? { ...f, name } : f)))
}

export async function deleteFolder(folderId: string) {
  // Move member sessions back to the unfiled list before dropping the folder.
  // Sweep with getAllIncludingHidden (not sessions.listAllSessionsMeta, whose
  // paging skips hidden records): archived members are hidden, and an orphaned
  // folderId left on them would keep the session invisible after unarchive.
  const metaStorage = await getMetaStorage()
  const sessions = await metaStorage.getAllIncludingHidden()
  const memberSessions = sessions.filter((s) => s.folderId === folderId)
  for (const session of memberSessions) {
    await rendererApplication.sessions.updateSession(session.id, { folderId: undefined })
  }
  const folders = await listFolders()
  await persistFolders(folders.filter((f) => f.id !== folderId))
  uiStore.getState().removeCollapsedFolder(folderId)
}

export async function moveSessionToFolder(sessionId: string, folderId: string | null) {
  if (folderId) {
    // Pinning and folders are mutually exclusive: unpin when filing into a folder.
    await rendererApplication.sessions.updateSession(sessionId, { folderId, starred: undefined })
  } else {
    await rendererApplication.sessions.updateSession(sessionId, { folderId: undefined })
  }
}

/**
 * Batch-assign folder membership for many sessions at once. For each session:
 * a checked (folderId) entry moves it in (unpinning, same as moveSessionToFolder);
 * an explicit null entry removes it from any folder. Sessions absent from the
 * map are left untouched, so the picker can scope its writes to what the user
 * actually changed.
 */
export async function moveSessionsToFolder(entries: { sessionId: string; folderId: string | null }[]) {
  for (const { sessionId, folderId } of entries) {
    await moveSessionToFolder(sessionId, folderId)
  }
}
