/**
 * stamp-persist.ts — StampStore 落盘
 *
 * StampStore 本体是内存 Map。不落盘的后果不是"重启后少点缓存"，而是：
 * 历史消息里的 `#STAMP xxx` 标记会随会话一起保存，重启后这些标记仍在上下文里，
 * 但 store 是空的——模型按提示词去调 retrieve_by_stamp，必然拿到"戳不存在"。
 * 长程任务跨重启直接断掉，而且是静默断掉。
 *
 * 存储走主进程的 setStoreBlob/getStoreBlob（文件级，userData/chatbox-blobs/），
 * 不用 localStorage：原文含完整工具结果，几个长任务块就能超过 5MB 配额。
 */

import type { StampStoreLike } from './pipeline'

const BLOB_KEY = 'context-amplifier-stamps'
/** 写盘防抖窗口。压缩流水线在一轮里会多次 add，攒到一起写一次。 */
const FLUSH_DELAY_MS = 2000
/**
 * 落盘条数上限。超出时丢弃最旧的条目——不设上限的话，一个跑了几百轮的
 * 会话会把完整工具原文全量写盘，文件涨到几百 MB，启动读取阻塞界面。
 */
const MAX_ENTRIES = 400

interface PersistedEntry {
  stamp: string
  fullMessages: unknown[]
  summary: string
  status: string
  meta?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

interface PersistedShape {
  version: 1
  entries: PersistedEntry[]
}

type InvokeFn = (channel: string, ...args: unknown[]) => Promise<unknown>

function getInvoke(): InvokeFn | null {
  if (typeof window === 'undefined') return null
  const api = (window as unknown as { electronAPI?: { invoke?: InvokeFn } }).electronAPI
  return typeof api?.invoke === 'function' ? api.invoke : null
}

/** 内部访问 StampStore 的私有 Map。持久化需要遍历全部条目，公开 API 只给了 stamps()。 */
function entriesOf(store: StampStoreLike): PersistedEntry[] {
  const result: PersistedEntry[] = []
  for (const stamp of store.stamps()) {
    const entry = store.get(stamp) as PersistedEntry | null
    if (entry) result.push(entry)
  }
  return result
}

let flushTimer: ReturnType<typeof setTimeout> | null = null
let pendingStore: StampStoreLike | null = null
let loaded = false

/**
 * 从磁盘恢复。只在应用启动时调一次；重复调用会被 loaded 标志挡掉，
 * 避免覆盖本轮已经产生的新块。
 */
export async function restoreStampStore(store: StampStoreLike): Promise<number> {
  if (loaded) return 0
  loaded = true

  const invoke = getInvoke()
  if (!invoke) return 0

  try {
    const raw = await invoke('getStoreBlob', BLOB_KEY)
    if (typeof raw !== 'string' || !raw.trim()) return 0

    const parsed = JSON.parse(raw) as PersistedShape
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      console.warn('[StampPersist] 存档格式不识别，忽略')
      return 0
    }

    let restored = 0
    for (const entry of parsed.entries) {
      if (!entry?.stamp || !Array.isArray(entry.fullMessages)) continue
      store.add(entry.stamp, entry.fullMessages, entry.summary ?? '', entry.status ?? 'pending', entry.meta ?? {})
      restored++
    }
    console.log(`[StampPersist] 恢复 ${restored} 个任务块`)
    return restored
  } catch (error) {
    // 存档损坏不应该让应用起不来：放大器退回空 store 继续工作
    console.warn('[StampPersist] 恢复失败，从空 store 开始:', error instanceof Error ? error.message : error)
    return 0
  }
}

/** 请求写盘（防抖）。压缩流水线每次 add 之后调用。 */
export function scheduleStampFlush(store: StampStoreLike): void {
  pendingStore = store
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const target = pendingStore
    pendingStore = null
    if (target) void flushStampStore(target)
  }, FLUSH_DELAY_MS)
}

/** 立即写盘。 */
export async function flushStampStore(store: StampStoreLike): Promise<boolean> {
  const invoke = getInvoke()
  if (!invoke) return false

  try {
    const all = entriesOf(store)
    // 按更新时间保留最近的 MAX_ENTRIES 条。ARCHIVE 块也在其中——它们不进
    // 上下文，但正是最需要能被召回的部分。
    const kept = all
      .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
      .slice(0, MAX_ENTRIES)

    const payload: PersistedShape = { version: 1, entries: kept }
    await invoke('setStoreBlob', BLOB_KEY, JSON.stringify(payload))
    if (all.length > kept.length) {
      console.warn(`[StampPersist] 落盘 ${kept.length} 块，丢弃最旧的 ${all.length - kept.length} 块`)
    }
    return true
  } catch (error) {
    console.warn('[StampPersist] 写盘失败:', error instanceof Error ? error.message : error)
    return false
  }
}
