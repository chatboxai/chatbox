/**
 * This module contains all fundamental operations for chat sessions and messages.
 * It uses react-query for caching.
 * */

import NiceModal from '@ebay/nice-modal-react'
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
import i18n from '@/i18n'
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
import {
  assertNoMessageDataUpdate,
  getSessionMetadataSnapshot,
  mergeCachedGeneratingMessages,
  type SessionMetadataUpdate,
} from './chatStore-cache'
import { lastUsedModelStore } from './lastUsedModelStore'
import queryClient from './queryClient'
import { clearSessionActivity } from './sessionActivityStore'
import { getSessionMeta } from './sessionHelpers'
import { settingsStore, useSettingsStore } from './settingsStore'
import { UpdateQueue } from './updateQueue'

export const QueryKeys = {
  ChatSessionsList: ['chat-sessions-list'],
  ArchivedChatSessionsList: ['archived-chat-sessions-list'],
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

export async function listSessionsMetaPage(cursor: number, limit?: number): Promise<SessionMetaPage> {
  const metaStorage = await getMetaStorage()
  return await metaStorage.getPage(cursor, limit)
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
  const items: SessionMetaRecord[] = []
  let cursor: number | null = 0
  while (cursor !== null) {
    const page = await listSessionsMetaPage(cursor)
    items.push(...page.items)
    cursor = page.nextCursor
  }
  return items
}

async function _listArchivedSessionsMetaPage(cursor: number): Promise<SessionMetaPage> {
  const metaStorage = await getMetaStorage()
  return await metaStorage.getArchivedPage(cursor)
}

export async function listArchivedSessionsMetaPage(cursor: number, limit?: number): Promise<SessionMetaPage> {
  const metaStorage = await getMetaStorage()
  return await metaStorage.getArchivedPage(cursor, limit)
}

export async function countSessionsMeta(): Promise<number> {
  const metaStorage = await getMetaStorage()
  return await metaStorage.getTotal()
}

export async function countArchivedSessionsMeta(): Promise<number> {
  const metaStorage = await getMetaStorage()
  return await metaStorage.getArchivedTotal()
}

const listArchivedSessionsMetaQueryOptions = {
  queryKey: QueryKeys.ArchivedChatSessionsList,
  queryFn: ({ pageParam }: { pageParam: number }) => _listArchivedSessionsMetaPage(pageParam),
  getNextPageParam: (lastPage: SessionMetaPage) => lastPage.nextCursor,
  initialPageParam: 0,
  staleTime: Infinity,
}

export async function listArchivedSessionsMeta(): Promise<SessionMetaRecord[]> {
  const items: SessionMetaRecord[] = []
  let cursor: number | null = 0
  while (cursor !== null) {
    const page = await listArchivedSessionsMetaPage(cursor)
    items.push(...page.items)
    cursor = page.nextCursor
  }
  return items
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

export function useArchivedSessionList() {
  const result = useInfiniteQuery(listArchivedSessionsMetaQueryOptions)
  const archivedSessionMetaList = useMemo(() => result.data?.pages.flatMap((p) => p.items), [result.data])
  return {
    archivedSessionMetaList,
    refetch: result.refetch,
    fetchNextPage: result.fetchNextPage,
    hasNextPage: result.hasNextPage,
    isFetchingNextPage: result.isFetchingNextPage,
    isLoading: result.isLoading,
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
}

/** Re-read the first session list page from DB and update cache. Use for bulk operations only. */
export async function refreshSessionListCache() {
  const firstPage = await _listSessionsMetaPage(0)
  queryClient.setQueryData<InfiniteSessionData>(QueryKeys.ChatSessionsList, {
    pages: [firstPage],
    pageParams: [0],
  })
}

async function refreshArchivedSessionListCache() {
  const firstPage = await _listArchivedSessionsMetaPage(0)
  queryClient.setQueryData<InfiniteSessionData>(QueryKeys.ArchivedChatSessionsList, {
    pages: [firstPage],
    pageParams: [0],
  })
}

function updateArchivedSessionListData(updater: (items: SessionMetaRecord[]) => SessionMetaRecord[]) {
  queryClient.setQueryData<InfiniteSessionData>(QueryKeys.ArchivedChatSessionsList, (old) => {
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

function _setSessionCache(
  sessionId: string,
  updated: Session | null,
  options?: { preserveCachedGeneratingMessages?: boolean }
) {
  // 1. update session cache 2. session settings do not use cache now
  if (!options?.preserveCachedGeneratingMessages || !updated) {
    queryClient.setQueryData(QueryKeys.ChatSession(sessionId), updated)
    return
  }
  queryClient.setQueryData(QueryKeys.ChatSession(sessionId), (cached: Session | null | undefined) =>
    mergeCachedGeneratingMessages(updated, cached)
  )
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
  _setSessionCache(session.id, session)

  updateSessionListData((items) => sortSessionRecords([...items, record]))

  return session
}

const sessionUpdateQueues: Record<string, UpdateQueue<Session>> = {}

export async function updateSessionWithMessages(
  sessionId: string,
  updater: Updater<Session>,
  options?: { preserveCachedGeneratingMessages?: boolean }
) {
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
  _setSessionCache(sessionId, updated, options)
  return updated
}

// 这里只能修改messages之外的字段
export async function updateSession(sessionId: string, updater: Updater<SessionMetadataUpdate>) {
  return await updateSessionWithMessages(
    sessionId,
    (session) => {
      if (!session) {
        throw new Error(`Session ${sessionId} not found`)
      }
      const updated = typeof updater === 'function' ? updater(getSessionMetadataSnapshot(session)) : updater
      assertNoMessageDataUpdate(updated)
      return {
        ...session,
        ...updated,
      }
    },
    { preserveCachedGeneratingMessages: true }
  )
}

// only update session cache without touching storage, for performance sensitive usage
export async function updateSessionCache(sessionId: string, updater: Updater<Session>) {
  const session = await getSession(sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found`)
  }
  updateSessionCacheSync(sessionId, updater)
}

export function updateSessionCacheSync(sessionId: string, updater: Updater<Session>) {
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

/**
 * If a session has persisted download artifacts, ask the user to confirm deletion, since
 * those downloadable files will be permanently removed along with the session. Returns
 * false if the user cancels; true otherwise (including when there are no artifacts).
 */
export async function confirmSessionDeletion(id: string): Promise<boolean> {
  if (platform.type !== 'desktop' || !platform.sandboxHasArtifacts) return true
  try {
    const { has } = await platform.sandboxHasArtifacts({ sessionId: id })
    if (!has) return true
    const confirmed = await NiceModal.show('confirm', {
      title: i18n.t('Delete this chat?'),
      message: i18n.t(
        'This chat has downloadable files generated in the sandbox. Deleting it will permanently remove those files.'
      ),
      confirmText: i18n.t('Delete'),
      danger: true,
    })
    return confirmed === true
  } catch {
    return true
  }
}

async function cleanupSessionAttachmentRagEntries(ids: string[], operation: string) {
  if (platform.type !== 'desktop') {
    return
  }
  await runInChunks(ids, 10, async (id) => {
    try {
      await platform.getSessionAttachmentRagController().deleteSessionAttachments(id)
    } catch (error) {
      console.warn(`Failed to cleanup session attachment RAG entries for ${operation}:`, error)
    }
  })
}

function cleanupDeletedSessionRuntimeState(id: string) {
  _setSessionCache(id, null)
  uiStore.getState().clearSessionWebBrowsing(id)
  uiStore.getState().removeSessionKnowledgeBase(id)
  uiStore.getState().clearSessionAgentMode(id)
  cleanupSessionAtomCache(id)
  clearScrollPositionCache(id)
  clearSessionActivity(id)
  delete sessionUpdateQueues[id]
  // Remove persisted download artifacts so deleted session references do not leak files on disk.
  platform.sandboxReset?.({ sessionId: id }).catch(() => {})
  platform.sandboxRemoveArtifacts?.({ sessionId: id }).catch(() => {})
}

export async function deleteSession(id: string) {
  console.debug('chatStore', 'deleteSession', id)
  await cleanupSessionAttachmentRagEntries([id], 'session deletion')
  await storage.removeItem(StorageKeyGenerator.session(id))
  const metaStorage = await getMetaStorage()
  await metaStorage.delete(id)
  updateSessionListData((items) => items.filter((session) => session.id !== id))
  updateArchivedSessionListData((items) => items.filter((session) => session.id !== id))
  cleanupDeletedSessionRuntimeState(id)
}

export async function archiveSession(id: string) {
  await updateSession(id, { hidden: true, archivedAt: Date.now() })
  await refreshArchivedSessionListCache()
}

// 这里刻意逐个走 updateSession，保证完整 session 存储和 meta 存储一致。
// 该实现不针对超大批量归档做性能优化。
export async function archiveSessions(ids: string[]) {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return

  const archivedAt = Date.now()
  const missingSessionIds: string[] = []
  await runInChunks(uniqueIds, 20, async (id) => {
    try {
      await updateSession(id, { hidden: true, archivedAt })
    } catch (error) {
      if (error instanceof Error && error.message === `Session ${id} not found`) {
        missingSessionIds.push(id)
        return
      }
      throw error
    }
  })

  if (missingSessionIds.length > 0) {
    await cleanupSessionAttachmentRagEntries(missingSessionIds, 'stale session meta cleanup')
    const metaStorage = await getMetaStorage()
    await metaStorage.deleteMany(missingSessionIds)
    for (const id of missingSessionIds) {
      cleanupDeletedSessionRuntimeState(id)
    }
  }

  await refreshSessionListCache()
  await refreshArchivedSessionListCache()
}

export async function restoreSession(id: string) {
  await updateSession(id, { hidden: false, archivedAt: undefined })
  await refreshSessionListCache()
  updateArchivedSessionListData((items) => items.filter((session) => session.id !== id))
}

export async function deleteSessions(ids: string[]) {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return

  await cleanupSessionAttachmentRagEntries(uniqueIds, 'session deletion')

  await runInChunks(uniqueIds, 20, async (id) => {
    await storage.removeItem(StorageKeyGenerator.session(id))
  })

  const metaStorage = await getMetaStorage()
  await metaStorage.deleteMany(uniqueIds)
  await refreshSessionListCache()
  updateArchivedSessionListData((items) => items.filter((session) => !uniqueIds.includes(session.id)))

  for (const id of uniqueIds) {
    cleanupDeletedSessionRuntimeState(id)
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
      // Insert after the previous message, skipping any compaction summaries
      // anchored to it: a summary sits immediately after its boundary message
      // and nothing may come between the pair (see buildCompactionCommitPatch).
      const afterAnchoredSummaries = (messages: Message[], previousIndex: number): number => {
        let index = previousIndex + 1
        while (index < messages.length && messages[index].isSummary) {
          index += 1
        }
        return index
      }

      // try to find insert position in message list
      let previousIndex = session.messages.findIndex((m) => m.id === previousId)

      if (previousIndex >= 0) {
        const insertIndex = afterAnchoredSummaries(session.messages, previousIndex)
        return {
          ...session,
          messages: [...session.messages.slice(0, insertIndex), message, ...session.messages.slice(insertIndex)],
        } satisfies Session
      }

      // try to find insert position in threads
      if (session.threads) {
        for (const thread of session.threads) {
          previousIndex = thread.messages.findIndex((m) => m.id === previousId)
          if (previousIndex >= 0) {
            const insertIndex = afterAnchoredSummaries(thread.messages, previousIndex)
            return {
              ...session,
              threads: session.threads.map((th) => {
                if (th.id === thread.id) {
                  return {
                    ...thread,
                    messages: [
                      ...thread.messages.slice(0, insertIndex),
                      message,
                      ...thread.messages.slice(insertIndex),
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
  const update = (session: Session | null | undefined): Session => {
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

    if (session.messageForksHash) {
      for (const [forkMessageId, fork] of Object.entries(session.messageForksHash)) {
        const listIndex = fork.lists.findIndex((list) => list.messages.some((message) => message.id === messageId))
        if (listIndex < 0) {
          continue
        }

        return {
          ...session,
          messageForksHash: {
            ...session.messageForksHash,
            [forkMessageId]: {
              ...fork,
              lists: fork.lists.map((list, index) =>
                index === listIndex
                  ? {
                      ...list,
                      messages: updateMessages(list.messages),
                    }
                  : list
              ),
            },
          },
        } satisfies Session
      }
    }

    return session
  }

  if (onlyUpdateCache) {
    await updateSessionCache(sessionId, update)
    return
  }

  await updateSessionWithMessages(sessionId, update, { preserveCachedGeneratingMessages: true })
}

export async function removeMessage(sessionId: string, messageId: string) {
  // Messages can be deleted while other replies stream; their cache-only chunk
  // updates must survive this full-session write. Preserving never resurrects
  // the removed message: the merge only maps over messages that still exist.
  return await updateSessionWithMessages(
    sessionId,
    (session) => {
      if (!session) {
        throw new Error(`session ${sessionId} not found`)
      }

      const messageToDelete =
        session.messages.find((m) => m.id === messageId) ??
        session.threads?.flatMap((thread) => thread.messages).find((m) => m.id === messageId) ??
        Object.values(session.messageForksHash ?? {})
          .flatMap((fork) => fork.lists)
          .flatMap((list) => list.messages)
          .find((m) => m.id === messageId)
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
        removeMessageFromSavedForks(session.messageForksHash, messageId),
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
    },
    { preserveCachedGeneratingMessages: true }
  )
}

function removeMessageFromSavedForks(
  messageForksHash: Session['messageForksHash'],
  messageId: string
): Session['messageForksHash'] {
  if (!messageForksHash) {
    return undefined
  }

  const nextHash: NonNullable<Session['messageForksHash']> = {}
  for (const [forkMessageId, fork] of Object.entries(messageForksHash)) {
    const removedListIndex = fork.lists.findIndex((list) => list.messages.some((message) => message.id === messageId))
    if (removedListIndex < 0) {
      nextHash[forkMessageId] = fork
      continue
    }

    const removedBranchBecomesEmpty =
      removedListIndex !== fork.position && fork.lists[removedListIndex].messages.length === 1
    const updatedLists = fork.lists
      .map((list) => ({
        ...list,
        messages: list.messages.filter((message) => message.id !== messageId),
      }))
      .filter((list, index) => index === fork.position || list.messages.length > 0)

    if (updatedLists.length <= 1) {
      continue
    }

    nextHash[forkMessageId] = {
      ...fork,
      position: removedBranchBecomesEmpty && removedListIndex < fork.position ? fork.position - 1 : fork.position,
      lists: updatedLists,
    }
  }

  return Object.keys(nextHash).length > 0 ? nextHash : undefined
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
      // Skip junk session entries (e.g. empty `{}` objects or `session:undefined`)
      // that have no id — they cannot become valid meta records.
      if (session && session.id) {
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
