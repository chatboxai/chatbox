/**
 * This module contains all fundamental operations for chat sessions and messages.
 * It uses react-query for caching.
 * */

import {
  type Message,
  type Session,
  type SessionMeta,
  type SessionMetaPage,
  type SessionMetaRecord,
  type SessionSettings,
  SessionSettingsSchema,
  type Updater,
  type UpdaterFn,
} from '@shared/types'
import { type InfiniteData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import compact from 'lodash/compact'
import isEmpty from 'lodash/isEmpty'
import { useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import platform from '@/platform'
import storage, { StorageKey } from '@/storage'
import type { SessionMetaStorage } from '@/storage/SessionMetaStorage'
import { sortSessionRecords } from '@/storage/SessionMetaStorage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as defaults from '../../shared/defaults'
import { getLogger } from '../lib/utils'
import { migrateSession } from '../utils/session-utils'
import { uiStore } from './uiStore'

const log = getLogger('chat-store')

import { clearScrollPositionCache } from '@/components/chat/MessageList'
import { cleanupSessionAtomCache } from './atoms/throttleWriteSessionAtom'
import { lastUsedModelStore } from './lastUsedModelStore'
import queryClient from './queryClient'
import { getSessionMeta } from './sessionHelpers'
import { settingsStore, useSettingsStore } from './settingsStore'
import { UpdateQueue } from './updateQueue'

export const QueryKeys = {
  ChatSessionsList: ['chat-sessions-list'],
  ChatSession: (id: string) => ['chat-session', id],
  ChatSessionSettings: (id: string) => ['chat-session-settings', id],
}

// MARK: session meta storage

let _metaStorage: SessionMetaStorage | null = null

export async function getMetaStorage(): Promise<SessionMetaStorage> {
  if (!_metaStorage) {
    _metaStorage = platform.getSessionMetaStorage()
    await _metaStorage.initialize()
  }
  return _metaStorage
}

// MARK: session list operations

type InfiniteSessionData = InfiniteData<SessionMetaPage, number>

async function _listSessionsMetaPage(cursor: number): Promise<SessionMetaPage> {
  console.debug('chatStore', 'listSessionsMetaPage', cursor)
  try {
    const metaStorage = await getMetaStorage()
    return await metaStorage.getPage(cursor)
  } catch (error) {
    log.error('Failed to read session list page from DB:', error)
    throw error
  }
}

const listSessionsMetaQueryOptions = {
  queryKey: QueryKeys.ChatSessionsList,
  queryFn: ({ pageParam }: { pageParam: number }) => _listSessionsMetaPage(pageParam),
  getNextPageParam: (lastPage: SessionMetaPage) => lastPage.nextCursor,
  initialPageParam: 0,
  staleTime: Infinity,
}

/** Get all currently cached session metas (flattened from loaded pages). */
export function getCachedSessionsMeta(): SessionMetaRecord[] {
  const data = queryClient.getQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList)
  if (!data) return []
  return data.pages.flatMap((p) => p.items)
}

/** Get all session metas. Returns cached data if available, otherwise fetches first page. */
export async function listSessionsMeta(): Promise<SessionMetaRecord[]> {
  const cached = getCachedSessionsMeta()
  if (cached.length > 0) return cached
  const data = await queryClient.fetchInfiniteQuery(listSessionsMetaQueryOptions)
  return data.pages.flatMap((p) => p.items)
}

/** Get all session metas from storage, bypassing the paginated cache. */
export async function listAllSessionsMeta(): Promise<SessionMetaRecord[]> {
  const metaStorage = await getMetaStorage()
  return await metaStorage.getAll()
}

export function useSessionList() {
  const result = useInfiniteQuery(listSessionsMetaQueryOptions)
  const sessionMetaList = useMemo(() => result.data?.pages.flatMap((p) => p.items), [result.data])
  return {
    sessionMetaList,
    refetch: result.refetch,
    fetchNextPage: result.fetchNextPage,
    hasNextPage: result.hasNextPage,
    isFetchingNextPage: result.isFetchingNextPage,
  }
}

/**
 * Update the paginated session list cache.
 * Flattens all loaded pages, applies the updater, then re-packs into a single page
 * preserving the nextCursor for further pagination.
 */
export function updateSessionListData(updater: (items: SessionMetaRecord[]) => SessionMetaRecord[]) {
  queryClient.setQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList, (old) => {
    if (!old || !old.pages.length) return old
    const allItems = old.pages.flatMap((p) => p.items)
    const updated = updater(allItems)
    const lastPage = old.pages[old.pages.length - 1]
    const delta = updated.length - allItems.length
    return {
      pages: [
        {
          items: updated,
          nextCursor: lastPage.nextCursor !== null ? lastPage.nextCursor + delta : null,
          total: (lastPage.total || 0) + delta,
        },
      ],
      pageParams: [0],
    }
  })
  // Keep the file-explorer per-group views in sync with any optimistic global-list change.
  invalidateSessionLists()
}

/** Re-read the first session list page from DB and update cache. Use for bulk operations only. */
export async function refreshSessionListCache() {
  const firstPage = await _listSessionsMetaPage(0)
  queryClient.setQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList, {
    pages: [firstPage],
    pageParams: [0],
  })
  invalidateSessionLists()
}

// MARK: group-scoped session list (file-explorer view)

const UNGROUPED_QUERY_KEY = '__ungrouped__'

/** Query key for one group's paginated sessions (groupId null = ungrouped root). */
export const groupSessionsQueryKey = (groupId: string | null) =>
  ['chat-sessions-list', 'group', groupId ?? UNGROUPED_QUERY_KEY] as const

async function _listSessionsByGroupPage(groupId: string | null, cursor: number | null): Promise<SessionMetaPage> {
  const metaStorage = await getMetaStorage()
  return await metaStorage.getPageByGroup(groupId, cursor)
}

function groupSessionsQueryOptions(groupId: string | null) {
  return {
    queryKey: groupSessionsQueryKey(groupId),
    queryFn: ({ pageParam }: { pageParam: number | null }) => _listSessionsByGroupPage(groupId, pageParam),
    getNextPageParam: (lastPage: SessionMetaPage) => lastPage.nextCursor,
    initialPageParam: null as number | null,
    staleTime: Infinity,
  }
}

/** Real-paginated sessions for one group (null = ungrouped root) — the file-explorer main panel. */
export function useSessionListByGroup(groupId: string | null) {
  const result = useInfiniteQuery(groupSessionsQueryOptions(groupId))
  const sessionMetaList = useMemo(() => result.data?.pages.flatMap((p) => p.items), [result.data])
  return {
    sessionMetaList,
    total: result.data?.pages[0]?.total ?? 0,
    refetch: result.refetch,
    fetchNextPage: result.fetchNextPage,
    hasNextPage: result.hasNextPage,
    isFetchingNextPage: result.isFetchingNextPage,
    isLoading: result.isLoading,
  }
}

/** Direct-session count for a group (null = ungrouped) — used for tree/rail badges. */
export function useGroupSessionCount(groupId: string | null) {
  const { data } = useQuery({
    queryKey: ['chat-sessions-list', 'group-count', groupId ?? UNGROUPED_QUERY_KEY],
    queryFn: async () => (await getMetaStorage()).getTotalByGroup(groupId),
    staleTime: Infinity,
  })
  return data ?? 0
}

/** All starred sessions across groups, newest first — backs the virtual "Starred" pseudo-group. */
export function useStarredSessions() {
  const { data } = useQuery({
    queryKey: ['chat-sessions-list', 'starred'],
    queryFn: async () => {
      const all = await (await getMetaStorage()).getAll()
      return all.filter((s) => s.starred)
    },
    staleTime: Infinity,
  })
  return { sessionMetaList: data, total: data?.length ?? 0 }
}

/** Refresh the per-group explorer queries (group lists + counts + starred) after a session mutation.
 * The global infinite list keeps its own optimistic updates, so it is intentionally left untouched. */
export function invalidateSessionLists() {
  void queryClient.invalidateQueries({ queryKey: ['chat-sessions-list', 'group'] })
  void queryClient.invalidateQueries({ queryKey: ['chat-sessions-list', 'group-count'] })
  void queryClient.invalidateQueries({ queryKey: ['chat-sessions-list', 'starred'] })
}

// MARK: session operations

// get session
async function _getSessionById(id: string): Promise<Session | null> {
  console.debug('chatStore', 'getSessionById', id)
  const storageKey = StorageKeyGenerator.session(id)
  try {
    const session = await storage.getItem<Session | null>(storageKey, null)
    if (!session) {
      return null
    }
    return migrateSession(session)
  } catch (error) {
    log.error(`Failed to read session from storage (key: ${storageKey}, sessionId: ${id}):`, error)
    // Re-throw to prevent incorrect state
    throw error
  }
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

async function runInChunks<T>(items: T[], chunkSize: number, worker: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += chunkSize) {
    await Promise.all(items.slice(i, i + chunkSize).map((item) => worker(item)))
  }
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

  const metaStorage = await getMetaStorage()
  let sortOrder = Date.now()
  if (previousId) {
    const currentList = getCachedSessionsMeta()
    const prevIndex = currentList.findIndex((s) => s.id === previousId)
    if (prevIndex >= 0) {
      const prevSortOrder = currentList[prevIndex].sortOrder
      const nextSortOrder =
        prevIndex + 1 < currentList.length ? currentList[prevIndex + 1].sortOrder : prevSortOrder - 2000
      sortOrder = (prevSortOrder + nextSortOrder) / 2
    }
  }

  const record: SessionMetaRecord = {
    ...getSessionMeta(session),
    sortOrder,
    createdAt: Date.now(),
  }
  await metaStorage.create(record)

  updateSessionListData((items) => sortSessionRecords([...items, record]))

  return session
}

const sessionUpdateQueues: Record<string, UpdateQueue<Session>> = {}

export async function updateSessionWithMessages(sessionId: string, updater: Updater<Session>) {
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
    const newMeta = getSessionMeta(updated)
    const metaStorage = await getMetaStorage()
    await metaStorage.update(sessionId, newMeta)
    updateSessionListData((items) =>
      sortSessionRecords(items.map((s) => (s.id === sessionId ? { ...s, ...newMeta } : s)))
    )
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
  if (platform.type === 'desktop') {
    try {
      await platform.getSessionAttachmentRagController().deleteSessionAttachments(id)
    } catch (error) {
      console.warn('Failed to cleanup session attachment RAG entries for session deletion:', error)
    }
  }
  await storage.removeItem(StorageKeyGenerator.session(id))
  _setSessionCache(id, null)
  const metaStorage = await getMetaStorage()
  await metaStorage.delete(id)
  updateSessionListData((items) => items.filter((session) => session.id !== id))
  // Clean up UI state and caches to prevent memory leaks
  uiStore.getState().clearSessionWebBrowsing(id)
  uiStore.getState().removeSessionKnowledgeBase(id)
  cleanupSessionAtomCache(id)
  clearScrollPositionCache(id)
  delete sessionUpdateQueues[id]
}

export async function deleteSessions(ids: string[]) {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return

  if (platform.type === 'desktop') {
    await runInChunks(uniqueIds, 10, async (id) => {
      try {
        await platform.getSessionAttachmentRagController().deleteSessionAttachments(id)
      } catch (error) {
        console.warn('Failed to cleanup session attachment RAG entries for session deletion:', error)
      }
    })
  }

  await runInChunks(uniqueIds, 20, async (id) => {
    await storage.removeItem(StorageKeyGenerator.session(id))
  })

  for (const id of uniqueIds) {
    _setSessionCache(id, null)
  }

  const metaStorage = await getMetaStorage()
  await metaStorage.deleteMany(uniqueIds)
  await refreshSessionListCache()

  for (const id of uniqueIds) {
    uiStore.getState().clearSessionWebBrowsing(id)
    uiStore.getState().removeSessionKnowledgeBase(id)
    cleanupSessionAtomCache(id)
    clearScrollPositionCache(id)
    delete sessionUpdateQueues[id]
  }
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

    const messageToDelete = session.messages.find((m) => m.id === messageId)
    const isSummaryMessage = messageToDelete?.isSummary === true

    const newMessages = session.messages.filter((m) => m.id !== messageId)
    const newThreads = session.threads?.map((thread) => ({
      ...thread,
      messages: thread.messages.filter((m) => m.id !== messageId),
      compactionPoints: isSummaryMessage
        ? thread.compactionPoints?.filter((cp) => cp.summaryMessageId !== messageId)
        : thread.compactionPoints,
    }))

    const newCompactionPoints = isSummaryMessage
      ? session.compactionPoints?.filter((cp) => cp.summaryMessageId !== messageId)
      : session.compactionPoints

    // Clean up empty fork branches after message removal and auto-switch if needed
    const { messages: finalMessages, messageForksHash: newMessageForksHash } = cleanupEmptyForkBranches(
      session.messageForksHash,
      newMessages,
      newThreads
    )

    return {
      ...session,
      messages: finalMessages,
      threads: newThreads,
      messageForksHash: newMessageForksHash,
      compactionPoints: newCompactionPoints,
    }
  })
}

/**
 * Clean up empty fork branches after message removal.
 * If the current branch (messages after forkMessageId) is empty, remove it from the fork
 * and automatically switch to another branch by loading its messages.
 */
function cleanupEmptyForkBranches(
  messageForksHash: Session['messageForksHash'],
  messages: Message[],
  threads: Session['threads']
): { messages: Message[]; messageForksHash: Session['messageForksHash'] } {
  if (!messageForksHash) {
    return { messages, messageForksHash }
  }

  let resultHash: Session['messageForksHash'] = messageForksHash
  let resultMessages = messages

  for (const [forkMessageId, forkEntry] of Object.entries(messageForksHash)) {
    // Check if fork point exists in messages
    const forkIndexInMessages = resultMessages.findIndex((m) => m.id === forkMessageId)

    if (forkIndexInMessages >= 0) {
      // Fork is in main messages - check if tail is empty fork point 是 user msg，之后的 bot msg 是具体的分叉
      // 当用户这条消息(fork point)是最后一条消息，后面没了 bot msg，则当前分支是空的
      const currentBranchIsEmpty = forkIndexInMessages === resultMessages.length - 1

      if (currentBranchIsEmpty) {
        // Remove current branch from lists
        const remainingLists = forkEntry.lists.filter((_, index) => index !== forkEntry.position)

        if (remainingLists.length <= 1) {
          // Only one or zero branches left - remove the fork and load remaining messages
          const remainingBranchMessages = remainingLists[0]?.messages ?? []
          // Append remaining branch messages after the fork point
          resultMessages = resultMessages.slice(0, forkIndexInMessages + 1).concat(remainingBranchMessages)
          // Remove this fork from hash
          const { [forkMessageId]: _removed, ...rest } = resultHash ?? {}
          resultHash = Object.keys(rest).length ? rest : undefined
        } else {
          // Multiple branches remain - switch to nearest position and load its messages
          const newPosition = Math.min(forkEntry.position, remainingLists.length - 1)
          const newBranchMessages = remainingLists[newPosition]?.messages ?? []

          // Load the new branch's messages
          resultMessages = resultMessages.slice(0, forkIndexInMessages + 1).concat(newBranchMessages)

          // Clear the messages from the loaded branch (since they're now in main messages)
          const updatedLists = remainingLists.map((list, index) =>
            index === newPosition ? { ...list, messages: [] } : list
          )

          resultHash = {
            ...resultHash,
            [forkMessageId]: {
              ...forkEntry,
              position: newPosition,
              lists: updatedLists,
            },
          }
        }
      }
    } else if (threads) {
      // Fork might be in threads - just update the hash without modifying main messages
      for (const thread of threads) {
        const forkIndexInThread = thread.messages.findIndex((m) => m.id === forkMessageId)
        if (forkIndexInThread >= 0) {
          const currentBranchIsEmpty = forkIndexInThread === thread.messages.length - 1
          if (currentBranchIsEmpty) {
            const remainingLists = forkEntry.lists.filter((_, index) => index !== forkEntry.position)
            if (remainingLists.length <= 1) {
              const { [forkMessageId]: _removed, ...rest } = resultHash ?? {}
              resultHash = Object.keys(rest).length ? rest : undefined
            } else {
              const newPosition = Math.min(forkEntry.position, remainingLists.length - 1)
              resultHash = {
                ...resultHash,
                [forkMessageId]: {
                  ...forkEntry,
                  position: newPosition,
                  lists: remainingLists,
                },
              }
            }
          }
          break
        }
      }
    }
  }

  return { messages: resultMessages, messageForksHash: resultHash }
}

// MARK: system-managed sessions

// Ensure the persistent system-managed AI Manager session exists.
// Idempotent: parallel/repeat invocations always yield exactly one stored session
// (storage.setItemNow overwrites the same key; updateSessionList dedupes by id).
// We read directly from storage rather than via getSession() to bypass the
// react-query cache, which keeps `null` results around indefinitely (staleTime: Infinity).
export async function ensureManagerSession(): Promise<void> {
  const storageKey = StorageKeyGenerator.session(defaults.SESSION_MANAGER_ID)
  const existing = await storage.getItem<Session | null>(storageKey, null)
  if (existing) {
    return
  }
  const session: Session = {
    id: defaults.SESSION_MANAGER_ID,
    name: 'AI Manager',
    type: 'chat',
    system: true,
    hidden: true, // keep it out of the standard session list (upstream filters by `hidden`); surfaced via a dedicated entry
    messages: [],
    settings: {},
  }
  await storage.setItemNow(storageKey, session)
  const metaStorage = await getMetaStorage()
  const existingMeta = await metaStorage.getById(defaults.SESSION_MANAGER_ID)
  if (!existingMeta) {
    await metaStorage.create({
      ...getSessionMeta(session),
      sortOrder: Date.now(),
      createdAt: Date.now(),
    })
  }
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

  // Build SessionMetaRecord entries with sortOrder based on message timestamp
  const now = Date.now()
  const records: SessionMetaRecord[] = sessionsWithTimestamp.map((item, i) => ({
    ...item.meta,
    sortOrder: item.timestamp || now - (sessionsWithTimestamp.length - i) * 1000,
    createdAt: item.timestamp || now - (sessionsWithTimestamp.length - i) * 1000,
  }))

  // Write to new DB (clear first to remove orphaned records)
  const metaStorage = await getMetaStorage()
  await metaStorage.clear()
  await metaStorage.createMany(records)
  await refreshSessionListCache()

  console.debug('chatStore', 'recoverSessionList', `Recovered ${records.length} sessions, ${failedKeys.length} failed`)

  return { recovered: records.length, failed: failedKeys.length }
}
