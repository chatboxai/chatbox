import type { ResourceReference } from './resources'
import type { BackupManifest } from './types'

export function validateResourceReferences(
  manifest: Pick<BackupManifest, 'resources' | 'warnings' | 'sessions'>,
  references: Iterable<ResourceReference>
): Set<string> {
  const resources = new Map(
    manifest.resources.flatMap((resource) => resource.originalStorageKeys.map((key) => [key, resource] as const))
  )
  const missing = new Set(
    manifest.warnings
      .filter((warning) => warning.code === 'resource-read-failed' && warning.itemType === 'resource')
      .flatMap((warning) => (warning.itemId ? [warning.itemId] : []))
  )
  const usedMissing = new Set<string>()
  const sessions = new Map(manifest.sessions.map((session) => [session.id, session]))
  for (const reference of references) {
    const resource = resources.get(reference.storageKey)
    if (!resource) {
      if (!missing.has(reference.storageKey)) throw new Error('Backup contains an undeclared resource reference')
      usedMissing.add(reference.storageKey)
    } else if (
      reference.sessionId &&
      (!resource.sessionIds.includes(reference.sessionId) ||
        !sessions.get(reference.sessionId)?.resourceIds.includes(resource.id))
    ) {
      throw new Error('Backup resource ownership does not match its references')
    }
  }
  return usedMissing
}
