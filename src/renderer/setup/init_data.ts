import { getLogger } from '@/lib/utils'
import { defaultSessionsForCN, defaultSessionsForEN } from '@/packages/initial_data'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKey, StorageKeyGenerator } from '@/storage/StoreStorage'
import * as chatStore from '@/stores/chatStore'
import { getSessionMeta } from '@/stores/sessionHelpers'

const log = getLogger('init-data')

export async function initData() {
  // 恢复孤立的历史会话（session:* 存在但不在 chat-sessions-list 中的情况）
  await tryRecoverOrphanedSessions()
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

async function tryRecoverOrphanedSessions(): Promise<void> {
  try {
    const allKeys = await storage.getAllKeys()
    const sessionKeys = allKeys.filter(
      (k: string) =>
        k.startsWith('session:') &&
        !k.startsWith('session:new') &&
        !k.startsWith('session:chatbox-chat-demo')
    )

    if (sessionKeys.length === 0) {
      return
    }

    // 获取当前会话列表
    const currentList = await chatStore.listSessionsMeta()
    const currentIds = new Set(currentList.map((s: any) => s.id))

    // 找到不在当前列表中的孤立会话
    const orphanedKeys = sessionKeys.filter((k: string) => {
      const id = k.replace('session:', '')
      return !currentIds.has(id)
    })

    if (orphanedKeys.length === 0) {
      return
    }

    log.info(`Found ${orphanedKeys.length} orphaned session keys, recovering...`)

    const recoveredMetas = [] as any[]
    for (const key of orphanedKeys) {
      try {
        const session = await platform.getStoreValue(key)
        if (session && session.id) {
          recoveredMetas.push(getSessionMeta(session))
        }
      } catch (err) {
        log.warn(`Failed to read orphaned session key: ${key}`, err)
      }
    }

    if (recoveredMetas.length === 0) {
      return
    }

    log.info(`Recovered ${recoveredMetas.length} orphaned sessions`)
    // 合并到现有列表
    const mergedList = [...currentList, ...recoveredMetas]
    await storage.setItemNow(StorageKey.ChatSessionsList, mergedList)
    await chatStore.updateSessionList(() => mergedList)
  } catch (error) {
    log.error('Failed to recover orphaned sessions:', error)
  }
}

async function initPresetSessions() {
  const lang = await platform.getLocale().catch((e) => 'en')

  const defaultSessions = lang.startsWith('zh') ? defaultSessionsForCN : defaultSessionsForEN

  for (const session of defaultSessions) {
    await storage.setItemNow(StorageKeyGenerator.session(session.id), session)
  }

  const sessionList = defaultSessions.map(getSessionMeta)

  await storage.setItemNow(StorageKey.ChatSessionsList, sessionList)

  return sessionList
}
