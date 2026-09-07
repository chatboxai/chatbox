import { defaultSessionsForCN, defaultSessionsForEN } from '@/packages/initial_data'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { getMetaStorage } from '@/stores/sessionHelpers'
import { getSessionMeta } from '@/stores/sessionHelpers'
import { createSessionMetaRecordsFromLegacyList } from '@/utils/session-utils'

export async function initData() {
  await initSessionsIfNeeded()
}

async function initSessionsIfNeeded() {
  const metaStorage = await getMetaStorage()
  const total = await metaStorage.getAllTotal()
  if (total > 0) {
    return
  }

  const lang = await platform.getLocale().catch(() => 'en')
  const defaultSessions = lang.startsWith('zh') ? defaultSessionsForCN : defaultSessionsForEN

  for (const session of defaultSessions) {
    await storage.setItemNow(StorageKeyGenerator.session(session.id), session)
  }

  const records = createSessionMetaRecordsFromLegacyList(defaultSessions.map(getSessionMeta))

  await metaStorage.createMany(records)
}
