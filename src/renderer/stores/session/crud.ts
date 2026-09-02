import { getGenerationControlMessages } from '@chatbox/core/session/generation-state'
import { areSessionsInSamePinGroup } from '@chatbox/core/utils/session-sort'
import {
  copyMessageForksWithMapping,
  copyMessagesWithMapping,
  copyThreadsWithMapping,
  createMessage,
  remapCompactionPoints,
  type Session,
  type SessionMeta,
} from '@shared/types'
import { getDefaultStore } from 'jotai'
import { omit } from 'lodash'
import { rendererApplication } from '@/app/renderer-application'
import platform from '@/platform'
import { navigateToDynamicPath, router } from '@/router'
import { sortSessionRecords } from '@/storage/SessionMetaStorage'
import * as atoms from '../atoms'
import * as scrollActions from '../scrollActions'
import { clearSessionActivity } from '../sessionActivityStore'
import { getMetaStorage, initEmptyChatSession } from '../sessionHelpers'

// Lazy import: message-queue.ts imports session modules that lead back here,
// so a static import would be circular.
async function clearMessageQueues(sessionIds: string[]): Promise<void> {
  const { clearQueue } = await import('./message-queue')
  for (const sessionId of sessionIds) clearQueue(sessionId)
}

/**
 * Abort every in-flight generation of a session: registered runtimes first,
 * then `generating` placeholders the runtime has not registered yet (their
 * abort lands as a pendingAbort tombstone). Abort-only on purpose — callers
 * that keep the session (clear) finalize through the runtime's own paths, and
 * callers that delete it have nothing left to persist to.
 */
function abortSessionGenerations(sessionId: string, session: Session | null | undefined, reason: string): void {
  const activeRuntimeIds = rendererApplication.generationRuntime.getActiveMessageIds(sessionId)
  for (const messageId of activeRuntimeIds) {
    rendererApplication.generationRuntime.requestAbort(sessionId, messageId, reason)
  }
  if (!session) return
  for (const message of getGenerationControlMessages(session, activeRuntimeIds)) {
    if (message.generating && !activeRuntimeIds.has(message.id)) {
      rendererApplication.generationRuntime.requestAbort(sessionId, message.id, reason)
    }
  }
}

function abortGenerationsBeforeDeletion(sessionId: string): void {
  // Deletion must stop in-flight work before the session disappears: a
  // generation still preparing its request (attachments, OCR, tools) would
  // otherwise dispatch a billable provider call for a deleted conversation.
  // (The removed request-snapshot checkpoint used to fail that dispatch as a
  // side effect of its pre-dispatch persist.)
  //
  // The placeholder scan reads the cache only, never a fetch: bulk deletion
  // (delete-all-archived) would otherwise pull every session's full message
  // list into the query cache before the first delete, and those entries stay
  // resident until the deletion completes. An unregistered `generating`
  // placeholder can only exist for a session this renderer is generating in,
  // and such a session is always cached — a cache miss has nothing to abort
  // beyond the registered runtimes handled above.
  abortSessionGenerations(
    sessionId,
    rendererApplication.sessionQueryBridge.getCachedSession(sessionId),
    'session-deleted'
  )
}

export async function deleteSession(sessionId: string): Promise<void> {
  abortGenerationsBeforeDeletion(sessionId)
  // Clear only after the deletion succeeded: queued messages are the sole copy
  // of the user's text, and a failed deletion leaves the session (and queue) alive.
  await rendererApplication.sessions.deleteSession(sessionId)
  await clearMessageQueues([sessionId])
}

export async function deleteSessions(sessionIds: string[]): Promise<void> {
  for (const sessionId of sessionIds) {
    abortGenerationsBeforeDeletion(sessionId)
  }
  await rendererApplication.sessions.deleteSessions(sessionIds)
  await clearMessageQueues(sessionIds)
}

export async function deleteAllArchivedSessions(): Promise<void> {
  const archived = await rendererApplication.sessions.listArchivedSessionsMeta()
  const sessionIds = archived.map((session) => session.id)
  if (sessionIds.length === 0) {
    return
  }
  await deleteSessions(sessionIds)
}

export async function refreshSessionListCache(): Promise<void> {
  rendererApplication.sessionQueryBridge.resetSessionList(await rendererApplication.sessions.listSessionsMetaPage(0))
}

/**
 * Create a new session and switch to it
 */
async function create(newSession: Omit<Session, 'id'>) {
  const session = await rendererApplication.sessions.createSession(newSession)
  switchCurrentSession(session.id)
  return session
}

/**
 * Create a new empty session
 */
export function createEmpty(type: 'chat') {
  if (type !== 'chat') {
    throw new Error('Legacy picture sessions can no longer be created')
  }
  return create(initEmptyChatSession())
}

/**
 * Copy a session (internal helper)
 */
async function copySession(
  sourceMeta: SessionMeta & {
    name?: Session['name']
    messages?: Session['messages']
    threads?: Session['threads']
    threadName?: Session['threadName']
    messageForksHash?: Session['messageForksHash']
    compactionPoints?: Session['compactionPoints']
    settings?: Session['settings']
  },
  options?: {
    appendForkMarker?: boolean
  }
) {
  const source = await rendererApplication.sessionQueryBridge.getSession(sourceMeta.id)
  if (!source) {
    throw new Error(`Session ${sourceMeta.id} not found`)
  }

  const sourceMessages = sourceMeta.messages ?? source.messages
  const messagesToCopy = options?.appendForkMarker
    ? sourceMessages.filter((message) => !message.isForkMarker)
    : sourceMessages

  // Copy messages and get ID mapping
  const { messages: newMessages, idMapping } = copyMessagesWithMapping(messagesToCopy)

  const sourceThreads = 'threads' in sourceMeta ? sourceMeta.threads : source.threads
  const { threads: copiedThreads, idMapping: combinedIdMapping } = copyThreadsWithMapping(sourceThreads, idMapping)
  const sourceMessageForksHash =
    'messageForksHash' in sourceMeta ? sourceMeta.messageForksHash : source.messageForksHash
  const { messageForksHash: newMessageForksHash, idMapping: fullIdMapping } = copyMessageForksWithMapping(
    sourceMessageForksHash,
    combinedIdMapping
  )

  // Remap compaction points with the full mapping (active messages, threads
  // and fork-list messages): a compacted branch may be switched inactive, so
  // its boundary/summary can live inside a saved fork list — including fork
  // lists reachable only from archived threads.
  const newThreads = copiedThreads?.map((thread) => ({
    ...thread,
    compactionPoints: remapCompactionPoints(thread.compactionPoints, fullIdMapping, 'copySession'),
  }))

  // Use sourceMeta.compactionPoints if explicitly provided (e.g., from thread),
  // otherwise fall back to source session's compactionPoints
  const sourceCompactionPoints =
    'compactionPoints' in sourceMeta ? sourceMeta.compactionPoints : source.compactionPoints

  const newCompactionPoints = remapCompactionPoints(sourceCompactionPoints, fullIdMapping, 'copySession')

  const copiedMessages = [...newMessages]
  if (options?.appendForkMarker) {
    copiedMessages.push({
      ...createMessage('assistant'),
      isForkMarker: true,
      forkedFromSessionId: source.id,
    })
  }

  const newSession = {
    ...omit(source, 'id', 'messages', 'threads', 'messageForksHash', 'compactionPoints'),
    ...(sourceMeta.name ? { name: sourceMeta.name } : {}),
    messages: copiedMessages,
    threads: newThreads,
    messageForksHash: newMessageForksHash,
    compactionPoints: newCompactionPoints?.length ? newCompactionPoints : undefined,
    ...('threadName' in sourceMeta ? { threadName: sourceMeta.threadName ?? '' } : {}),
    // Explicit settings override (e.g. a promoted thread carrying its own
    // frozen persona snapshot); otherwise the source session's settings apply.
    ...('settings' in sourceMeta ? { settings: sourceMeta.settings } : {}),
  }
  return await rendererApplication.sessions.createSession(newSession, source.id)
}

/**
 * Copy session and switch to it
 */
export async function copyAndSwitchSession(source: SessionMeta) {
  const newSession = await copySession(source, { appendForkMarker: true })
  switchCurrentSession(newSession.id)
}

/**
 * Switch current session by id
 */
export function switchCurrentSession(sessionId: string) {
  const store = getDefaultStore()
  store.set(atoms.currentSessionIdAtom, sessionId)
  navigateToDynamicPath({
    to: `/session/${sessionId}`,
  })
  scrollActions.clearAutoScroll()
}

/**
 * Reorder sessions in the list using fractional indexing.
 * Computes a new sortOrder for the moved item based on its new neighbors.
 */
export async function reorderSessions(oldIndex: number, newIndex: number) {
  console.debug('sessionActions', 'reorderSessions', oldIndex, newIndex)
  const sessions = await rendererApplication.sessionQueryBridge.listSessionsMeta()
  const movedSession = sessions[oldIndex]
  if (!movedSession || oldIndex === newIndex) return
  const reorderedSessions = [...sessions]
  reorderedSessions.splice(oldIndex, 1)
  reorderedSessions.splice(newIndex, 0, movedSession)
  const targetSession = reorderedSessions[newIndex]
  const nextStarred = targetSession?.starred ?? movedSession.starred

  const comparableReordered = reorderedSessions.filter((s) => areSessionsInSamePinGroup(s, movedSession))
  const targetGroupIndex = comparableReordered.findIndex((s) => s.id === movedSession.id)
  const before = comparableReordered[targetGroupIndex - 1]
  const after = comparableReordered[targetGroupIndex + 1]

  let newSortOrder: number
  if (targetGroupIndex < 0 || reorderedSessions.length === 0) {
    return
  } else if (!before && !after) {
    newSortOrder = Date.now()
  } else if (!before) {
    newSortOrder = after.sortOrder + 1000
  } else if (!after) {
    newSortOrder = before.sortOrder - 1000
  } else {
    newSortOrder = (before.sortOrder + after.sortOrder) / 2
  }

  if (nextStarred !== movedSession.starred) {
    await rendererApplication.sessions.updateSession(movedSession.id, { starred: nextStarred })
  }

  const metaStorage = await getMetaStorage()
  await metaStorage.update(movedSession.id, { sortOrder: newSortOrder, starred: nextStarred })
  rendererApplication.sessionQueryBridge.updateSessionListData((items) => {
    const updated = items.map((s) =>
      s.id === movedSession.id ? { ...s, sortOrder: newSortOrder, starred: nextStarred } : s
    )
    return sortSessionRecords(updated)
  })
}

/**
 * Switch to session by sorted index
 */
export async function switchToIndex(index: number) {
  const sessions = await rendererApplication.sessionQueryBridge.listSessionsMeta()
  const target = sessions[index]
  if (!target) {
    return
  }
  switchCurrentSession(target.id)
}

/**
 * Switch to next/previous session in sorted order
 */
export async function switchToNext(reversed?: boolean) {
  const sessions = await rendererApplication.sessionQueryBridge.listSessionsMeta()
  if (!sessions) {
    return
  }
  const store = getDefaultStore()
  const currentSessionId = store.get(atoms.currentSessionIdAtom)
  const currentIndex = sessions.findIndex((s) => s.id === currentSessionId)
  if (currentIndex < 0) {
    switchCurrentSession(sessions[0].id)
    return
  }
  let targetIndex = reversed ? currentIndex - 1 : currentIndex + 1
  if (targetIndex >= sessions.length) {
    targetIndex = 0
  }
  if (targetIndex < 0) {
    targetIndex = sessions.length - 1
  }
  const target = sessions[targetIndex]
  switchCurrentSession(target.id)
}

/**
 * Archive session list entries, keeping only specified number of sessions
 */
async function archiveSessionList(keepNum: number) {
  const sessionMetaList = await rendererApplication.sessions.listAllSessionsMeta()
  const archived = sessionMetaList?.slice(keepNum)
  if (!archived?.length) {
    return
  }
  await rendererApplication.sessions.archiveSessions(archived.map((s) => s.id))
  // Navigate to home if the current session was archived
  const store = getDefaultStore()
  const currentSessionId = store.get(atoms.currentSessionIdAtom)
  if (currentSessionId && archived.some((d) => d.id === currentSessionId)) {
    router.navigate({ to: '/', replace: true })
  }
}

/**
 * Clear conversation list by archiving entries, keeping only specified number of sessions (from top)
 */
export async function clearConversationList(keepNum: number) {
  await archiveSessionList(keepNum)
}

/**
 * Clear all messages in a session, keeping only system prompt
 */
export async function clear(sessionId: string) {
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  if (!session) {
    return
  }
  abortSessionGenerations(sessionId, session, 'session-cleared')
  if (platform.isDesktopLike) {
    try {
      await platform.getSessionAttachmentRagController().deleteSessionAttachments(sessionId)
    } catch (error) {
      console.warn('Failed to cleanup session attachment RAG entries while clearing session:', error)
    }
  }
  const updated = await rendererApplication.sessions.updateSessionWithMessages(session.id, {
    messages: session.messages.filter((m) => m.role === 'system').slice(0, 1),
    threads: undefined,
    messageForksHash: undefined,
    // Pending title for the next conversation — not `undefined`, which
    // means "historical field missing" and would be backfilled to `name`.
    threadName: '',
  })
  clearSessionActivity(session.id)
  return updated
}

// Re-export copySession for use by threads.ts (moveThreadToConversations)
export { copySession as _copySession }
