/**
 * This module contains all fundamental operations for chat sessions and messages.
 * It uses react-query for caching.
 * */

import { useQuery } from '@tanstack/react-query'
import compact from 'lodash/compact'
import isEmpty from 'lodash/isEmpty'
import { useMemo } from 'react'
import {
  type Message,
  type Session,
  type SessionMeta,
  type SessionSettings,
  SessionSettingsSchema,
  type Updater,
  type UpdaterFn,
} from 'src/shared/types'
import { v4 as uuidv4 } from 'uuid'
import storage, { StorageKey } from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as defaults from '../../shared/defaults'
import { migrateSession, sortSessions } from '../utils/session-utils'
import { lastUsedModelStore } from './lastUsedModelStore'
import queryClient from './queryClient'
import { getSessionMeta } from './sessionHelpers'
import { settingsStore, useSettingsStore } from './settingsStore'
import { UpdateQueue } from './updateQueue'

const QueryKeys = {
  ChatSessionsList: ['chat-sessions-list'],
  ChatSession: (id: string) => ['chat-session', id],
}

// MARK: session list operations

// list sessions meta
async function _listSessionsMeta(): Promise<SessionMeta[]> {
  console.debug('chatStore', 'listSessionsMeta')
  const sessionMetaList = await storage.getItem<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  // session list showing order: reversed, pinned at top
  return sessionMetaList
}

const listSessionsMetaQueryOptions = {
  queryKey: QueryKeys.ChatSessionsList,
  queryFn: () => _listSessionsMeta().then(sortSessions),
  staleTime: Infinity,
}

export async function listSessionsMeta() {
  return await queryClient.fetchQuery(listSessionsMetaQueryOptions)
}

export function useSessionList() {
  const { data: sessionMetaList, refetch } = useQuery({ ...listSessionsMetaQueryOptions })
  return { sessionMetaList, refetch }
}

let sessionListUpdateQueue: UpdateQueue<SessionMeta[]> | null = null

export async function updateSessionList(updater: UpdaterFn<SessionMeta[]>) {
  if (!sessionListUpdateQueue) {
    sessionListUpdateQueue = new UpdateQueue<SessionMeta[]>(
      () => _listSessionsMeta(),
      async (sessions) => {
        await storage.setItemNow(StorageKey.ChatSessionsList, sessions)
      }
    )
  }
  console.debug('chatStore', 'updateSessionList', updater)
  const result = await sessionListUpdateQueue.set(updater)
  queryClient.setQueryData(QueryKeys.ChatSessionsList, sortSessions(result))
}

// MARK: session operations

// get session
async function _getSessionById(id: string): Promise<Session | null> {
  console.debug('chatStore', 'getSessionById', id)
  const session = await storage.getItem<Session | null>(StorageKeyGenerator.session(id), null)
  if (!session) {
    return null
  }
  return migrateSession(session)
}

const getSessionQueryOptions = (sessionId: string) => ({
  queryKey: QueryKeys.ChatSession(sessionId),
  queryFn: () => _getSessionById(sessionId),
  staleTime: Infinity,
})

export async function getSession(sessionId: string) {
  return await queryClient.fetchQuery(getSessionQueryOptions(sessionId))
}

export function useSession(sessionId: string | null) {
  const { data: session, ...rest } = useQuery({
    ...getSessionQueryOptions(sessionId!),
    enabled: !!sessionId,
  })
  return { session, ...rest }
}

function _setSessionCache(sessionId: string, updated: Session | null) {
  // 1. update session cache 2. session settings do not use cache now
  queryClient.setQueryData(QueryKeys.ChatSession(sessionId), updated)
}

// create session
export async function createSession(newSession: Omit<Session, 'id'>, previousId?: string) {
  console.debug('chatStore', 'createSession', newSession)
  const { chat: lastUsedChatModel, picture: lastUsedPictureModel } = lastUsedModelStore.getState()
  const session = {
    ...newSession,
    id: uuidv4(),
    settings: {
      ...(newSession.type === 'picture' ? lastUsedPictureModel : lastUsedChatModel),
      ...newSession.settings,
    },
  }
  await storage.setItemNow(StorageKeyGenerator.session(session.id), session)
  const sMeta = getSessionMeta(session)
  await updateSessionList((sessions) => {
    if (!sessions) {
      throw new Error('Session list not found')
    }
    if (previousId) {
      let previouseSessionIndex = sessions.findIndex((s) => s.id === previousId)
      if (previouseSessionIndex < 0) {
        previouseSessionIndex = sessions.length - 1
      }
      return [...sessions.slice(0, previouseSessionIndex + 1), sMeta, ...sessions.slice(previouseSessionIndex + 1)]
    }
    return [...sessions, sMeta]
  })
  return session
}

const sessionUpdateQueues: Record<string, UpdateQueue<Session>> = {}

export async function updateSessionWithMessages(sessionId: string, updater: Updater<Session>) {
  console.debug('chatStore', 'updateSession', sessionId, updater)
  if (!sessionUpdateQueues[sessionId]) {
    // do not use await here to avoid data race
    sessionUpdateQueues[sessionId] = new UpdateQueue<Session>(
      () => getSession(sessionId),
      async (session) => {
        if (session) {
          console.debug('chatStore', 'persist session', sessionId)
          await storage.setItemNow(StorageKeyGenerator.session(sessionId), session)
        }
      }
    )
  }
  let needUpdateSessionList = true
  const updated = await sessionUpdateQueues[sessionId].set((prev) => {
    if (!prev) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (typeof updater === 'function') {
      return updater(prev)
    } else {
      if (isEmpty(getSessionMeta(updater as SessionMeta))) {
        needUpdateSessionList = false
      }
      return { ...prev, ...updater }
    }
  })
  if (needUpdateSessionList) {
    await updateSessionList((sessions) => {
      if (!sessions) {
        throw new Error('Session list not found')
      }
      return sessions.map((session) => (session.id === sessionId ? getSessionMeta(updated) : session))
    })
  }
  _setSessionCache(sessionId, updated)
  return updated
}

// 这里只能修改messages之外的字段
export async function updateSession(sessionId: string, updater: Updater<Omit<Session, 'messages'>>) {
  return await updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }
    const updated = typeof updater === 'function' ? updater(session) : updater
    return {
      ...session,
      ...updated,
    }
  })
}

// only update session cache without touching storage, for performance sensitive usage
export async function updateSessionCache(sessionId: string, updater: Updater<Session>) {
  console.debug('chatStore', 'updateSessionCache', sessionId, updater)
  const session = await getSession(sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found`)
  }
  queryClient.setQueryData(QueryKeys.ChatSession(sessionId), (old: Session | undefined | null) => {
    if (!old) {
      return old
    }
    if (typeof updater === 'function') {
      return updater(old)
    } else {
      return { ...old, ...updater }
    }
  })
}

export async function deleteSession(id: string) {
  console.debug('chatStore', 'deleteSession', id)
  await storage.removeItem(StorageKeyGenerator.session(id))
  _setSessionCache(id, null)
  await updateSessionList((sessions) => {
    if (!sessions) {
      throw new Error('Session list not found')
    }
    return sessions.filter((session) => session.id !== id)
  })
}

// MARK: session settings operations

function mergeDefaultSessionSettings(session: Session): SessionSettings {
  if (session.type === 'picture') {
    return SessionSettingsSchema.parse({
      ...defaults.pictureSessionSettings(),
      ...session.settings,
    })
  } else {
    return SessionSettingsSchema.parse({
      ...defaults.chatSessionSettings(),
      ...session.settings,
    })
  }
}
// session settings is copied from global settings when session is created, so no need to merge global settings here
export function useSessionSettings(sessionId: string | null) {
  const { session } = useSession(sessionId)
  const globalSettings = useSettingsStore((state) => state)

  const sessionSettings = useMemo(() => {
    if (!session) {
      return SessionSettingsSchema.parse(globalSettings)
    }
    return mergeDefaultSessionSettings(session)
  }, [session, globalSettings])

  return { sessionSettings }
}

export async function getSessionSettings(sessionId: string) {
  const session = await getSession(sessionId)
  if (!session) {
    const globalSettings = settingsStore.getState().getSettings()
    return SessionSettingsSchema.parse(globalSettings)
  }
  return mergeDefaultSessionSettings(session)
}

// MARK: message operations

// list messages
export async function listMessages(sessionId?: string | null): Promise<Message[]> {
  console.debug('chatStore', 'listMessages', sessionId)
  if (!sessionId) {
    return []
  }
  const session = await getSession(sessionId)
  if (!session) {
    return []
  }
  return session.messages
}

export async function insertMessage(sessionId: string, message: Message, previousId?: string) {
  await updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error(`session ${sessionId} not found`)
    }

    if (previousId) {
      // try to find insert position in message list
      let previousIndex = session.messages.findIndex((m) => m.id === previousId)

      if (previousIndex >= 0) {
        return {
          ...session,
          messages: [
            ...session.messages.slice(0, previousIndex + 1),
            message,
            ...session.messages.slice(previousIndex + 1),
          ],
        } satisfies Session
      }

      // try to find insert position in threads
      if (session.threads) {
        for (const thread of session.threads) {
          previousIndex = thread.messages.findIndex((m) => m.id === previousId)
          if (previousIndex >= 0) {
            return {
              ...session,
              threads: session.threads.map((th) => {
                if (th.id === thread.id) {
                  return {
                    ...thread,
                    messages: [
                      ...thread.messages.slice(0, previousIndex + 1),
                      message,
                      ...thread.messages.slice(previousIndex + 1),
                    ],
                  }
                }
                return th
              }),
            } satisfies Session
          }
        }
      }
    }
    // no previous message, insert to tail of current thread
    return {
      ...session,
      messages: [...session.messages, message],
    } satisfies Session
  })
}

export async function updateMessageCache(sessionId: string, messageId: string, updater: Updater<Message>) {
  return await updateMessage(sessionId, messageId, updater, true)
}

export async function updateMessages(sessionId: string, updater: Updater<Message[]>) {
  return await updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error(`session ${sessionId} not found`)
    }
    const updated = compact(typeof updater === 'function' ? updater(session.messages) : updater)
    return {
      ...session,
      messages: updated,
    }
  })
}

export async function updateMessage(
  sessionId: string,
  messageId: string,
  updater: Updater<Message>,
  onlyUpdateCache?: boolean
) {
  const updateFn = onlyUpdateCache ? updateSessionCache : updateSessionWithMessages

  await updateFn(sessionId, (session) => {
    if (!session) {
      throw new Error(`session ${sessionId} not found`)
    }

    const updateMessages = (messages: Message[]) => {
      return messages.map((m) => {
        if (m.id !== messageId) {
          return m
        }
        const updated = typeof updater === 'function' ? updater(m) : updater
        return {
          ...m,
          ...updated,
        } satisfies Message
      })
    }
    const message = session.messages.find((m) => m.id === messageId)
    if (message) {
      return {
        ...session,
        messages: updateMessages(session.messages),
      }
    }

    // try find message in threads
    if (session.threads) {
      for (const thread of session.threads) {
        const message = thread.messages.find((m) => m.id === messageId)
        if (message) {
          return {
            ...session,
            threads: session.threads.map((th) => {
              if (th.id !== thread.id) {
                return th
              }
              return {
                ...th,
                messages: updateMessages(th.messages),
              }
            }),
          } satisfies Session
        }
      }
    }

    return session
  })
}

export async function removeMessage(sessionId: string, messageId: string) {
  return await updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error(`session ${sessionId} not found`)
    }
    return {
      ...session,
      messages: session.messages.filter((m) => m.id !== messageId),
      threads: session.threads?.map((thread) => {
        return {
          ...thread,
          messages: thread.messages.filter((m) => m.id !== messageId),
        }
      }),
    }
  })
}

// MARK: data recovery operations

/**
 * Recover session list by scanning all session: prefixed keys in storage
 * This will clear the current session list and rebuild it from all found sessions
 */
export async function recoverSessionList() {
  console.debug('chatStore', 'recoverSessionList')

  // Get all storage keys
  const allKeys = await storage.getAllKeys()

  // Filter keys that match the session: prefix
  const sessionKeys = allKeys.filter((key) => key.startsWith('session:'))

  // Fetch all sessions with their first message timestamp
  const sessionsWithTimestamp: Array<{ meta: SessionMeta; timestamp: number }> = []
  const failedKeys: string[] = []

  for (const key of sessionKeys) {
    try {
      const session = await storage.getItem<Session | null>(key, null)
      if (session) {
        const migratedSession = migrateSession(session)
        const firstMessageTimestamp = migratedSession.messages[0]?.timestamp || 0
        sessionsWithTimestamp.push({
          meta: getSessionMeta(migratedSession),
          timestamp: firstMessageTimestamp,
        })
      }
    } catch (error) {
      // Handle cases where IndexedDB fails to read large values
      // This can happen with "DataError: Failed to read large IndexedDB value" in some browsers
      console.error(`Failed to read session "${key}":`, error)
      failedKeys.push(key)
    }
  }

  if (failedKeys.length > 0) {
    console.warn(`chatStore: Failed to recover ${failedKeys.length} sessions due to read errors`)
  }

  // Sort by first message timestamp (older first)
  sessionsWithTimestamp.sort((a, b) => a.timestamp - b.timestamp)

  // Extract sorted session metas
  const recoveredSessionMetas = sessionsWithTimestamp.map((item) => item.meta)

  await storage.setItemNow(StorageKey.ChatSessionsList, recoveredSessionMetas)

  // Update the query cache, apply additional sorting rules (pinned sessions, etc.)
  queryClient.setQueryData(QueryKeys.ChatSessionsList, sortSessions(recoveredSessionMetas))

  console.debug(
    'chatStore',
    'recoverSessionList',
    `Recovered ${recoveredSessionMetas.length} sessions, ${failedKeys.length} failed`
  )

  return { recovered: recoveredSessionMetas.length, failed: failedKeys.length }
}
