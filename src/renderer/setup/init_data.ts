import platform from '@/platform'
import { backfillPresetSessions } from '@/setup/preset_sessions'
import storage from '@/storage'
import * as chatStore from '@/stores/chatStore'

export async function initData() {
  await initSessionsIfNeeded()
}

async function initSessionsIfNeeded() {
  // 已经做过 migration，只需要检查是否存在 sessionList
  const sessionList = await chatStore.listSessionsMeta()
  if (sessionList.length > 0) {
    return
  }

  const newSessionList = await initPresetSessions()

  await chatStore.updateSessionList(() => {
    return newSessionList
  })
}

async function initPresetSessions() {
  const lang = await platform.getLocale().catch((e) => 'en')
  return backfillPresetSessions(
    {
      getData: storage.getItem.bind(storage),
      setData: storage.setItemNow.bind(storage),
    },
    lang
  )
}
