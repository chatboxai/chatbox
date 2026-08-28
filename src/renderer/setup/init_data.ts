import { CurrentSessionRepository } from '@/adapters/CurrentSessionRepository'
import { defaultSessionsForCN, defaultSessionsForEN } from '@/packages/initial_data'
import platform from '@/platform'
import { getMetaStorage, getSessionMeta } from '@/stores/sessionHelpers'
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
  const sessionRepository = new CurrentSessionRepository({ metaStorage })

  for (const session of defaultSessions) {
    await sessionRepository.setSession(session)
  }

  const records = createSessionMetaRecordsFromLegacyList(defaultSessions.map(getSessionMeta))

  await metaStorage.createMany(records)
}
