import type { Session } from '@shared/types'
import { MAX_BACKUP_JSON_ENTRY_BYTES, MAX_BACKUP_RESOURCE_ENTRY_BYTES } from './types'

export const BACKUP_MANIFEST_PATH = 'manifest.json'
export const BACKUP_SETTINGS_PATH = 'settings.json'
export const BACKUP_COPILOTS_PATH = 'copilots.json'
export const BACKUP_SESSION_SETTINGS_PATH = 'session-settings.json'

export function isBackupSessionPath(path: string): boolean {
  return /^sessions\/[^/]+\/session\.json$/.test(path)
}

export function isBackupResourcePath(path: string): boolean {
  return path.startsWith('resources/') || /^sessions\/[^/]+\/resources\/.+/.test(path)
}

export function isBackupJsonPath(path: string): boolean {
  return (
    path === BACKUP_MANIFEST_PATH ||
    path === BACKUP_SETTINGS_PATH ||
    path === BACKUP_COPILOTS_PATH ||
    path === BACKUP_SESSION_SETTINGS_PATH ||
    isBackupSessionPath(path)
  )
}

export function backupEntryByteLimit(path: string): number {
  return isBackupJsonPath(path) ? MAX_BACKUP_JSON_ENTRY_BYTES : MAX_BACKUP_RESOURCE_ENTRY_BYTES
}

export function isBackupSession(value: unknown): value is Session {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof value.id === 'string' &&
      value.id.length > 0 &&
      'name' in value &&
      typeof value.name === 'string' &&
      'messages' in value &&
      Array.isArray(value.messages)
  )
}
