import { SessionMetaRecordSchema } from '@shared/types'
import { z } from 'zod'

export const BACKUP_FORMAT = 'chatbox-backup'
export const BACKUP_FORMAT_VERSION = 2
export const MAX_BACKUP_JSON_ENTRY_BYTES = 128 * 1024 * 1024
export const MAX_BACKUP_RESOURCE_ENTRY_BYTES = 512 * 1024 * 1024

const BackupIdentifierSchema = z.string().min(1)
const BackupPathSchema = z.string().min(1).max(4096)
const BackupStorageKeySchema = z.string().min(1)

export const BackupExportItemSchema = z.enum(['setting', 'key', 'conversations', 'copilot'])
export type BackupExportItem = z.infer<typeof BackupExportItemSchema>

export const BackupChecksumSchema = z.object({
  algorithm: z.literal('sha256'),
  value: z.string().regex(/^[a-f0-9]{64}$/),
})
export type BackupChecksum = z.infer<typeof BackupChecksumSchema>

export const BackupJsonEntrySchema = z.object({
  path: BackupPathSchema,
  size: z.number().int().nonnegative(),
  checksum: BackupChecksumSchema,
})
export type BackupJsonEntry = z.infer<typeof BackupJsonEntrySchema>

export const BackupSessionEntrySchema = BackupJsonEntrySchema.extend({
  id: BackupIdentifierSchema,
  meta: SessionMetaRecordSchema,
  resourceIds: z.array(BackupIdentifierSchema).max(50_000),
})
export type BackupSessionEntry = z.infer<typeof BackupSessionEntrySchema>

export const BackupResourceEntrySchema = BackupJsonEntrySchema.extend({
  id: BackupIdentifierSchema,
  originalStorageKeys: z.array(BackupStorageKeySchema).min(1).max(50_000),
  sessionIds: z.array(BackupIdentifierSchema).max(50_000),
  scope: z.enum(['session', 'shared', 'global']),
  encoding: z.enum(['utf8', 'data-url-base64']),
  mimeType: z.string().min(1),
  kind: z.enum([
    'image',
    'parsed-attachment',
    'raw-attachment',
    'parsed-link',
    'tool-result',
    'avatar',
    'background',
    'copilot-image',
  ]),
  filename: z.string().optional(),
})
export type BackupResourceEntry = z.infer<typeof BackupResourceEntrySchema>

export const BackupWarningSchema = z.object({
  code: z.enum(['session-read-failed', 'resource-read-failed', 'external-resource-skipped', 'rag-rebuild-failed']),
  itemType: z.enum(['session', 'resource']),
  itemId: z.string().optional(),
  message: z.string(),
})
export type BackupWarning = z.infer<typeof BackupWarningSchema>

export const BackupManifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  exportedAt: z.string().datetime(),
  application: z.object({
    name: z.literal('Chatbox'),
    version: z.string(),
    platform: z.string(),
  }),
  exportItems: z.array(BackupExportItemSchema),
  sourceConfigVersion: z.number().int().nonnegative().optional(),
  data: z.object({
    settings: BackupJsonEntrySchema.optional(),
    copilots: BackupJsonEntrySchema.optional(),
    // Key-value map entry (session-settings.json). Besides per-type session
    // settings it also carries the agent persona keys (agent-soul,
    // agent-memories): older importers read this map through a fixed key
    // allowlist, so unknown keys are ignored and both directions stay
    // compatible without a new archive entry or format bump.
    sessionSettings: BackupJsonEntrySchema.optional(),
  }),
  sessions: z.array(BackupSessionEntrySchema).max(50_000),
  resources: z.array(BackupResourceEntrySchema).max(50_000),
  warnings: z.array(BackupWarningSchema).max(50_000),
  stats: z.object({
    sessionCount: z.number().int().nonnegative(),
    resourceCount: z.number().int().nonnegative(),
    deduplicatedResourceCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
  }),
})
export type BackupManifest = z.infer<typeof BackupManifestSchema>

export function validateBackupManifestGraph(manifest: BackupManifest): void {
  const resourceIds = new Set<string>()
  const resourceKeys = new Set<string>()
  const sessionIds = new Set<string>()
  for (const session of manifest.sessions) {
    if (sessionIds.has(session.id)) throw new Error(`Duplicate session id in manifest: ${session.id}`)
    sessionIds.add(session.id)
    if (session.meta.id !== session.id) throw new Error(`Session metadata id does not match: ${session.id}`)
  }
  for (const resource of manifest.resources) {
    if (resourceIds.has(resource.id)) throw new Error(`Duplicate resource id in manifest: ${resource.id}`)
    resourceIds.add(resource.id)
    const ownResourceKeys = new Set<string>()
    for (const key of resource.originalStorageKeys) {
      if (ownResourceKeys.has(key)) throw new Error(`Resource contains a duplicate storage key: ${resource.id}`)
      ownResourceKeys.add(key)
      if (resourceKeys.has(key)) throw new Error(`Duplicate resource storage key in manifest: ${key}`)
      resourceKeys.add(key)
    }
    const ownSessionIds = new Set<string>()
    for (const sessionId of resource.sessionIds) {
      if (ownSessionIds.has(sessionId)) throw new Error(`Resource contains a duplicate session id: ${resource.id}`)
      ownSessionIds.add(sessionId)
      if (!sessionIds.has(sessionId)) throw new Error(`Resource references an unknown session: ${sessionId}`)
    }
    if (resource.scope === 'session' && resource.sessionIds.length !== 1) {
      throw new Error(`Session-scoped resource must reference exactly one session: ${resource.id}`)
    }
    if (resource.scope === 'global' && resource.sessionIds.length !== 0) {
      throw new Error(`Global resource must not reference a session: ${resource.id}`)
    }
  }
  const resourcesById = new Map(manifest.resources.map((resource) => [resource.id, resource]))
  const sessionsById = new Map(manifest.sessions.map((session) => [session.id, session]))
  for (const session of manifest.sessions) {
    const ownResourceIds = new Set<string>()
    for (const resourceId of session.resourceIds) {
      if (ownResourceIds.has(resourceId)) throw new Error(`Session contains a duplicate resource id: ${session.id}`)
      ownResourceIds.add(resourceId)
      if (!resourceIds.has(resourceId)) throw new Error(`Session references an unknown resource: ${resourceId}`)
      if (!resourcesById.get(resourceId)?.sessionIds.includes(session.id)) {
        throw new Error(`Session/resource mapping is inconsistent: ${session.id}/${resourceId}`)
      }
    }
  }
  for (const resource of manifest.resources) {
    for (const sessionId of resource.sessionIds) {
      const session = sessionsById.get(sessionId)
      if (!session?.resourceIds.includes(resource.id)) {
        throw new Error(`Resource/session mapping is inconsistent: ${resource.id}/${sessionId}`)
      }
    }
  }
  if (
    manifest.stats.sessionCount !== manifest.sessions.length ||
    manifest.stats.resourceCount !== manifest.resources.length ||
    manifest.stats.warningCount !== manifest.warnings.length
  ) {
    throw new Error('Backup manifest statistics do not match its entries')
  }
}

export interface BackupProgress {
  phase: 'preparing' | 'sessions' | 'resources' | 'packing' | 'reading' | 'validating' | 'restoring'
  current: number
  total: number
  label?: string
}

export interface BackupStorage {
  getAllKeys(): Promise<string[]>
  getItem<T>(key: string, initialValue: T): Promise<T>
  setItemNow<T>(key: string, value: T): Promise<void>
  removeItem(key: string): Promise<void>
  getBlob(key: string): Promise<string | null>
  setBlob(key: string, value: string): Promise<void>
  delBlob(key: string): Promise<void>
}

export interface BackupMetaStorage {
  getAllIncludingHidden(): Promise<z.infer<typeof SessionMetaRecordSchema>[]>
  getById(id: string): Promise<z.infer<typeof SessionMetaRecordSchema> | null>
  create(record: z.infer<typeof SessionMetaRecordSchema>): Promise<void>
  update(
    id: string,
    updates: Partial<z.infer<typeof SessionMetaRecordSchema>>
  ): Promise<z.infer<typeof SessionMetaRecordSchema> | null>
  delete(id: string): Promise<void>
}
