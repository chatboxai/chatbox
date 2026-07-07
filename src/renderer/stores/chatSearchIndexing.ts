import { CHAT_SEARCH_BACKFILL_META_KEY } from '@shared/chat-search'
import type { Session } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { getLogger } from '../lib/utils'

const log = getLogger('chat-search-indexing')

// 流式生成期间 persistStreamingMessage 每 ~2s 落盘一次；这里对每个会话做 trailing
// debounce，只在安静期把最终内容推给主进程索引，避免在热路径上反复重建整会话的 FTS 行。
const SYNC_DEBOUNCE_MS = 2500
const BACKFILL_START_DELAY_MS = 8000
const BACKFILL_YIELD_MS = 15

const pendingSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingSessions = new Map<string, Session>()

/** 与 sessionHelpers 的搜索范围保持一致：messages + threads（不含 forks 的隐藏分支）。 */
export function extractSessionSearchEntries(session: Session): { messageId: string; text: string }[] {
  const entries: { messageId: string; text: string }[] = []
  const push = (messages: Session['messages']) => {
    for (const message of messages || []) {
      const text = getMessageText(message)
      if (text.trim().length > 0) {
        entries.push({ messageId: message.id, text })
      }
    }
  }
  push(session.messages)
  for (const thread of session.threads || []) {
    push(thread.messages)
  }
  return entries
}

async function flushSessionSync(sessionId: string) {
  pendingSyncTimers.delete(sessionId)
  const session = pendingSessions.get(sessionId)
  pendingSessions.delete(sessionId)
  if (!session) {
    return
  }
  try {
    await platform.chatSearchUpsertSession(sessionId, extractSessionSearchEntries(session))
  } catch (error) {
    // 索引是派生数据：失败只影响搜索的新鲜度，不影响聊天本身
    log.error(`chat-search sync failed for session ${sessionId}:`, error)
  }
}

/** Hooked into the session persist choke point (chatStore.updateSessionWithMessages). */
export function scheduleChatSearchSync(session: Session) {
  pendingSessions.set(session.id, session)
  const existing = pendingSyncTimers.get(session.id)
  if (existing) {
    clearTimeout(existing)
  }
  pendingSyncTimers.set(
    session.id,
    setTimeout(() => {
      void flushSessionSync(session.id)
    }, SYNC_DEBOUNCE_MS)
  )
}

export function deleteChatSearchSessions(sessionIds: string[]) {
  for (const id of sessionIds) {
    const timer = pendingSyncTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      pendingSyncTimers.delete(id)
      pendingSessions.delete(id)
    }
  }
  platform.chatSearchDeleteSessions(sessionIds).catch((error) => {
    log.error('chat-search delete failed:', error)
  })
}

let backfillDone: boolean | null = null
let backfillStarted = false

/** Whether the FTS index covers all sessions (i.e. the query path may use it). */
export async function isChatSearchReady(): Promise<boolean> {
  if (backfillDone === true) {
    return true
  }
  try {
    backfillDone = (await platform.chatSearchGetMeta(CHAT_SEARCH_BACKFILL_META_KEY)) === 'true'
  } catch {
    return false
  }
  return backfillDone
}

/**
 * One-time backfill of all existing sessions into the FTS index. Runs in the
 * background after boot; incremental sync (scheduleChatSearchSync) keeps the
 * index current afterwards. Re-runs from scratch when the schema version bumps
 * (the meta key is version-namespaced).
 */
export function ensureChatSearchBackfill() {
  if (backfillStarted) {
    return
  }
  backfillStarted = true

  setTimeout(() => {
    void (async () => {
      try {
        if (await isChatSearchReady()) {
          return
        }
        // 延迟导入，避免模块加载顺序问题（chatStore 也导入本模块）
        const { listAllSessionsMeta } = await import('@/stores/chatStore')
        const metas = await listAllSessionsMeta()
        log.info(`chat-search backfill: indexing ${metas.length} sessions`)
        let indexed = 0
        for (const meta of metas) {
          try {
            const session = await storage.getItem<Session | null>(StorageKeyGenerator.session(meta.id), null)
            if (session) {
              await platform.chatSearchUpsertSession(session.id, extractSessionSearchEntries(session))
              indexed++
            }
          } catch (error) {
            // 单个会话读取失败（如超大 IndexedDB 值）不阻断整体回填
            log.error(`chat-search backfill: failed to index session ${meta.id}:`, error)
          }
          await new Promise((resolve) => setTimeout(resolve, BACKFILL_YIELD_MS))
        }
        await platform.chatSearchSetMeta(CHAT_SEARCH_BACKFILL_META_KEY, 'true')
        backfillDone = true
        log.info(`chat-search backfill: done (${indexed}/${metas.length} sessions indexed)`)
      } catch (error) {
        backfillStarted = false // allow a retry on next trigger
        log.error('chat-search backfill failed:', error)
      }
    })()
  }, BACKFILL_START_DELAY_MS)
}
