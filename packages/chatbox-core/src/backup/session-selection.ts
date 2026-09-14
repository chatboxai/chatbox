import type { SessionRepositoryPort } from '../ports/session-repository'

export interface BackupSessionOption {
  id: string
  name: string
  hidden: boolean
  archived: boolean
}

export type BackupSessionCatalogSource = Pick<SessionRepositoryPort, 'getAllSessionIds' | 'meta'>

/** Includes orphaned session records without reading any conversation body. */
export async function listBackupSessions(source: BackupSessionCatalogSource): Promise<BackupSessionOption[]> {
  const [metadata, storedIds] = await Promise.all([source.meta.getAllIncludingHidden(), source.getAllSessionIds()])
  const byId = new Map(metadata.map((record) => [record.id, record]))
  return [...new Set([...metadata.map((record) => record.id), ...storedIds])].map((id) => {
    const record = byId.get(id)
    return {
      id,
      name: record?.name?.trim() || id,
      hidden: record?.hidden === true,
      archived: record?.archivedAt !== undefined,
    }
  })
}
