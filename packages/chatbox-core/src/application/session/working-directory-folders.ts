import { resolveSessionMode } from '../../session/mode-policy'
import type { Session, SessionFolder } from '../../types'

function normalizeDirectory(directory: string): string {
  const trimmed = directory.trim()
  // Keep a filesystem root ("/", "C:\") intact; drop trailing separators elsewhere.
  const withoutTrailing = trimmed.replace(/[\\/]+$/, '')
  return withoutTrailing === '' || /^[A-Za-z]:$/.test(withoutTrailing) ? trimmed : withoutTrailing
}

/**
 * The directory a Work Mode session is filed under: its first working
 * directory. Chat sessions and Work Mode sessions without a directory have none.
 */
export function getSessionWorkingDirectory(session: Pick<Session, 'settings'>): string | undefined {
  if (resolveSessionMode(session.settings?.agentMode?.value) !== 'work') return undefined
  const directory = session.settings?.workingDirectories?.find((item) => item.trim().length > 0)
  return directory === undefined ? undefined : normalizeDirectory(directory)
}

function directorySegments(directory: string): string[] {
  return directory.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

/**
 * Display name for a new directory folder: the directory's basename, or
 * `parent/basename` when another folder already uses that name.
 */
export function directoryFolderName(directory: string, folders: readonly SessionFolder[]): string {
  const segments = directorySegments(directory)
  const basename = segments.at(-1) ?? directory
  if (!folders.some((folder) => folder.name === basename) || segments.length < 2) return basename
  return `${segments.at(-2)}/${basename}`
}

export function findDirectoryFolder(
  folders: readonly SessionFolder[],
  directory: string | undefined
): SessionFolder | undefined {
  return directory === undefined ? undefined : folders.find((folder) => folder.workingDirectory === directory)
}
