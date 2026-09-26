import { directoryFolderName, findDirectoryFolder, normalizeWorkingDirectory } from '@chatbox/core/application/session'
import type { SessionFolder } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { guardBackupWrite } from '@/app/backup-operation-guard'
import { rendererApplication } from '@/app/renderer-application'
import { uiStore } from '../uiStore'

/**
 * Creates a project. With `workingDirectory`, Work Mode chats in that directory
 * are filed into it, an empty `name` falls back to the directory's name, and a
 * project that already collects the directory is returned instead of a new one.
 */
export async function createSessionFolder(name: string, workingDirectory?: string): Promise<SessionFolder | null> {
  if (!(await guardBackupWrite())) return null
  const directory = workingDirectory ? normalizeWorkingDirectory(workingDirectory) : undefined
  const id = uuidv4()
  const folders = await rendererApplication.sessions.updateSessionFolders((current) => {
    if (findDirectoryFolder(current, directory)) return null
    const folderName = name || (directory ? directoryFolderName(directory, current) : '')
    if (!folderName) return null
    return [...current, { id, name: folderName, ...(directory ? { workingDirectory: directory } : {}) }]
  })
  const folder = findDirectoryFolder(folders, directory) ?? folders.find((item) => item.id === id) ?? null
  if (folder) uiStore.getState().setSessionFolderCollapsed(folder.id, false)
  return folder
}

export async function renameSessionFolder(folderId: string, name: string): Promise<void> {
  if (!(await guardBackupWrite())) return
  await rendererApplication.sessions.updateSessionFolders((folders) =>
    folders.map((folder) => (folder.id === folderId ? { ...folder, name } : folder))
  )
}

/** Removes the folder; its sessions are listed as unfiled again. */
export async function deleteSessionFolder(folderId: string): Promise<void> {
  if (!(await guardBackupWrite())) return
  await rendererApplication.sessions.updateSessionFolders((folders) =>
    folders.filter((folder) => folder.id !== folderId)
  )
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
