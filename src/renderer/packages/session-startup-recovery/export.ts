import platform from '@/platform'
import { StorageKeyGenerator } from '@/storage/StoreStorage'

/** Read the retained migration input without invoking migration or schema repair. */
export async function exportPreMigrationSession(sessionId: string): Promise<'exported' | 'unavailable'> {
  const rows = platform.getSessionRowStore()
  await rows.initialize()
  // Once rows are published they are authoritative; the retained input can be stale.
  if (await rows.readExportCommit(sessionId)) return 'unavailable'
  const record: unknown = await platform.getStoreValue(StorageKeyGenerator.session(sessionId))
  if (!record || typeof record !== 'object' || !('id' in record) || record.id !== sessionId) return 'unavailable'
  const json = JSON.stringify(record, null, 2)
  if (await rows.readExportCommit(sessionId)) return 'unavailable'
  await platform.exporter.exportTextFile(`chatbox-recovery-${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`, json)
  return 'exported'
}
