import type { SessionFolder } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { guardBackupWrite } from '@/app/backup-operation-guard'
import { rendererApplication } from '@/app/renderer-application'
import { uiStore } from '../uiStore'

export async function createSessionFolder(name: string): Promise<SessionFolder | null> {
  if (!(await guardBackupWrite())) return null
  const folder: SessionFolder = { id: uuidv4(), name }
  const folders = await rendererApplication.sessions.listSessionFolders()
  await rendererApplication.sessions.saveSessionFolders([...folders, folder])
  return folder
}

export async function renameSessionFolder(folderId: string, name: string): Promise<void> {
  if (!(await guardBackupWrite())) return
  const folders = await rendererApplication.sessions.listSessionFolders()
  await rendererApplication.sessions.saveSessionFolders(
    folders.map((folder) => (folder.id === folderId ? { ...folder, name } : folder))
  )
}

/** Removes the folder; its sessions are listed as unfiled again. */
export async function deleteSessionFolder(folderId: string): Promise<void> {
  if (!(await guardBackupWrite())) return
  const folders = await rendererApplication.sessions.listSessionFolders()
  await rendererApplication.sessions.saveSessionFolders(folders.filter((folder) => folder.id !== folderId))
  uiStore.getState().setSessionFolderCollapsed(folderId, false)
}

/**
 * Files a session into `folderId` (or unfiles it with `undefined`) and expands
 * the target folder so the moved session stays visible.
 */
export async function moveSessionToFolder(sessionId: string, folderId: string | undefined): Promise<void> {
  if (!(await guardBackupWrite())) return
  await rendererApplication.sessions.moveSessionToFolder(sessionId, folderId)
  if (folderId) uiStore.getState().setSessionFolderCollapsed(folderId, false)
}
