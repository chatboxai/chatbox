import { atom } from 'jotai'
import { atomWithStorage, selectAtom } from 'jotai/utils'
import { Message, Session, SessionMeta, SessionThreadBrief } from '../../../shared/types'
import storage, { StorageKey } from '../../storage'
import { migrateMessage } from '../../utils/message'
import { migrateSession, sortSessions } from '../../utils/session-utils'
import { mergeSettings } from '../sessionActions'
import { settingsAtom } from './settingsAtoms'
import { createSessionAtom } from './throttleWriteSessionAtom'

// sessions


export const sessionsListAtom = atomWithStorage<SessionMeta[]>(StorageKey.ChatSessionsList, [], storage)
export const sortedSessionsListAtom = atom((get) => sortSessions(get(sessionsListAtom)))

// current session and messages

// 缓存在 localStorage，不对外暴露，属于内部状态
const _currentSessionIdCachedAtom = atomWithStorage<string | null>('_currentSessionIdCachedAtom', null)
export const currentSessionIdAtom = atom(
  (get) => {
    const idCached = get(_currentSessionIdCachedAtom)
    const sessions = get(sortedSessionsListAtom)
    if (idCached && sessions.some((session) => session.id === idCached)) {
      return idCached
    }
    return sessions[0]?.id
  },
  (_get, set, update: string | null) => {
    set(_currentSessionIdCachedAtom, update)
  }
)

export const currentSessionAtom = atom(async (get) => {
  const id = get(currentSessionIdAtom)
  const sessions = await get(sessionsListAtom)
  let currentMeta = sessions.find((session) => session?.id === id)

  if (!currentMeta) {
    const sorted = get(sortedSessionsListAtom)
    currentMeta = sorted[0]
  }
  if (!currentMeta) {
    return null
  }
  let session = get(createSessionAtom(currentMeta.id))

  if (!session) {
    console.error(`Session ${currentMeta.id} not found`)
    return null
  }
  return migrateSession(session)
})

export const currentSessionNameAtom = selectAtom(currentSessionAtom, (s) => s?.name ?? '')
export const currentSessionPicUrlAtom = selectAtom(currentSessionAtom, (s) => s?.picUrl)
export const currentSessionAssistantAvatarKeyAtom = selectAtom(currentSessionAtom, (s) => s?.assistantAvatarKey)

// 当前消息列表（包含历史主题下的消息）
export const currentMessageListAtom = atom((get) => {
  const s = get(currentSessionAtom)
  if (!s) return []

  let messageContext: Message[] = []
  if (s.threads) {
    for (const thread of s.threads) {
      messageContext = messageContext.concat(thread.messages)
    }
  }
  if (s.messages) {
    messageContext = messageContext.concat(s.messages)
  }
  return messageContext.map(migrateMessage)
})

export const currentThreadHistoryHashAtom = atom((get) => {
  const s = get(currentSessionAtom)
  if (!s) return {}

  const ret: { [firstMessageId: string]: SessionThreadBrief } = {}
  if (s.threads) {
    for (const thread of s.threads) {
      if (!thread.messages || thread.messages.length === 0) {
        continue
      }
      ret[thread.messages[0].id] = {
        id: thread.id,
        name: thread.name,
        createdAt: thread.createdAt,
        createdAtLabel: new Date(thread.createdAt).toLocaleString(),
        firstMessageId: thread.messages[0].id,
        messageCount: thread.messages.length,
      }
    }
    if (s.messages && s.messages.length > 0) {
      ret[s.messages[0].id] = {
        id: s.id,
        name: s.threadName || '',
        firstMessageId: s.messages[0].id,
        messageCount: s.messages.length,
      }
    }
  }
  return ret
})

export const currentSessionSettingsAtom = selectAtom(currentSessionAtom, (session) => session?.settings)
export const currentSessionTypeAtom = selectAtom(currentSessionAtom, (session) => session?.type || 'chat') // 老版本 chat 可能是 undefined

export const currentMergedSettingsAtom = atom((get) => {
  const sessionSettings = get(currentSessionSettingsAtom)
  const globalSettings = get(settingsAtom) // Ensure settingsAtom is imported correctly
  if (!sessionSettings) {
    return globalSettings
  }
  const sessionType = get(currentSessionTypeAtom)
  return mergeSettings(globalSettings, sessionSettings, sessionType)
})

// Related UI state
export const sessionCleanDialogAtom = atom<Session | null>(null) // 清空会话的弹窗
export const showThreadHistoryDrawerAtom = atom<boolean | string>(false) // 显示会话历史主题的抽屉
