import {
  areSessionsInSameListGroup,
  excludeCollapsedFolderSessions,
  findGroupSuccessor,
  getSessionListGroup,
} from '@chatbox/core/utils/session-sort'
import type { Message, SessionHeader } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { rendererApplication } from '@/app/renderer-application'
import platform from '@/platform'
import { navigateToDynamicPath, router } from '@/router'
import { sortSessionRecords } from '@/storage/SessionMetaStorage'
import * as atoms from '../atoms'
import { clearSessionGenerationStopOperations } from '../generationStopOperations'
import * as scrollActions from '../scrollActions'
import { clearSessionActivity } from '../sessionActivityStore'
import { getMetaStorage, initEmptyChatSession } from '../sessionHelpers'
import { uiStore } from '../uiStore'

// Lazy import: message-queue.ts imports session modules that lead back here,
// so a static import would be circular.
async function clearMessageQueues(sessionIds: string[]): Promise<void> {
  const { clearQueue } = await import('./message-queue')
  for (const sessionId of sessionIds) clearQueue(sessionId)
}

function abortGenerationsBeforeDeletion(sessionId: string): void {
  const runtime = rendererApplication.generationRuntime
  runtime.beginSessionStop(sessionId, 'session-deleted')
  for (const messageId of runtime.getActiveMessageIds(sessionId))
    runtime.requestAbort(sessionId, messageId, 'session-deleted')
}

export async function deleteSession(sessionId: string): Promise<void> {
  abortGenerationsBeforeDeletion(sessionId)
  // Clear only after the deletion succeeded: queued messages are the sole copy
  // of the user's text, and a failed deletion leaves the session (and queue) alive.
  try {
    await rendererApplication.sessions.deleteSession(sessionId)
  } finally {
    rendererApplication.generationRuntime.clearSessionStop(sessionId)
  }
  clearSessionGenerationStopOperations(sessionId)
  await clearMessageQueues([sessionId])
}

export async function deleteSessions(sessionIds: string[]): Promise<void> {
  for (const sessionId of sessionIds) {
    abortGenerationsBeforeDeletion(sessionId)
  }
  try {
    await rendererApplication.sessions.deleteSessions(sessionIds)
  } finally {
    for (const id of sessionIds) rendererApplication.generationRuntime.clearSessionStop(id)
  }
  for (const sessionId of sessionIds) {
    rendererApplication.generationRuntime.clearSessionStop(sessionId)
    clearSessionGenerationStopOperations(sessionId)
  }
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
async function create(newSession: Omit<SessionHeader, 'id'> & { messages: readonly Message[] }) {
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
 * Copy session and switch to it
 */
export async function copyAndSwitchSession(sessionId: string) {
  const source = await rendererApplication.sessions.getSessionHeader(sessionId)
  if (!source) throw new Error(`Session ${sessionId} not found`)
  const created = await rendererApplication.sessions.copySession({
    sessionId,
    expectedRevision: source.revision,
    scope: { type: 'session' },
    appendForkMarker: true,
  })
  switchCurrentSession(created.id)
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
 * Moves `activeId` to the position of `overId` using fractional indexing.
 * Dropping onto a row of another folder (or of the unfiled group) also moves
 * the session into that group; the pinned group is never entered or left by
 * dragging.
 */
export async function reorderSessions(activeId: string, overId: string) {
  if (activeId === overId) return
  const { sessionQueryBridge, sessions: sessionService } = rendererApplication
  const sessions = await sessionQueryBridge.listSessionsMeta()
  const folderIds = (await sessionService.listSessionFolders()).map((folder) => folder.id)
  const oldIndex = sessions.findIndex((s) => s.id === activeId)
  const newIndex = sessions.findIndex((s) => s.id === overId)
  const movedSession = sessions[oldIndex]
  const targetSession = sessions[newIndex]
  if (!movedSession || !targetSession || Boolean(movedSession.starred) !== Boolean(targetSession.starred)) return

  const targetGroup = getSessionListGroup(targetSession, folderIds)
  const nextFolderId = targetGroup.kind === 'folder' ? targetGroup.folderId : undefined
  const groupChanged = !areSessionsInSameListGroup(movedSession, targetSession, folderIds)
  const moved = groupChanged ? { ...movedSession, folderId: nextFolderId } : movedSession
  const reorderedSessions = sessions.filter((s) => s.id !== activeId)
  reorderedSessions.splice(newIndex, 0, moved)

  const comparableReordered = reorderedSessions.filter((s) => areSessionsInSameListGroup(s, moved, folderIds))
  const targetGroupIndex = comparableReordered.findIndex((s) => s.id === activeId)
  const before = comparableReordered[targetGroupIndex - 1]
  const after = comparableReordered[targetGroupIndex + 1]

  let newSortOrder: number
  if (!before && !after) {
    newSortOrder = Date.now()
  } else if (!before) {
    newSortOrder = after.sortOrder + 1000
  } else if (!after) {
    const metaStorage = await getMetaStorage()
    const successor = findGroupSuccessor(await metaStorage.getAll(), before, moved, activeId, folderIds)
    newSortOrder = successor ? (before.sortOrder + successor.sortOrder) / 2 : before.sortOrder - 1000
  } else {
    newSortOrder = (before.sortOrder + after.sortOrder) / 2
  }

  if (groupChanged) {
    await sessionService.moveSessionToFolder(activeId, nextFolderId, newSortOrder)
    return
  }

  const metaStorage = await getMetaStorage()
  await metaStorage.update(activeId, { sortOrder: newSortOrder })
  sessionQueryBridge.updateSessionListData((items) => {
    const updated = items.map((s) => (s.id === activeId ? { ...s, sortOrder: newSortOrder } : s))
    return sortSessionRecords(updated, folderIds)
  })
}

/** Loaded sessions in the order the sidebar shows them, without collapsed folder members. */
async function listVisibleSessions() {
  const sessions = await rendererApplication.sessionQueryBridge.listSessionsMeta()
  const folderIds = (await rendererApplication.sessions.listSessionFolders()).map((folder) => folder.id)
  return excludeCollapsedFolderSessions(sessions, folderIds, uiStore.getState().collapsedSessionFolderIds)
}

/**
 * Switch to session by sorted index
 */
export async function switchToIndex(index: number) {
  const sessions = await listVisibleSessions()
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
  const sessions = await listVisibleSessions()
  if (sessions.length === 0) {
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
  let cleanup: Promise<void> | undefined
  try {
    const result = await rendererApplication.sessions.executeStructureCommand(
      sessionId,
      {
        action: 'session-clear',
        scope: 'all',
        activeGenerationMessageIds: rendererApplication.generationRuntime
          .list(sessionId)
          .map((entry) => entry.messageId),
      },
      (committed) => {
        for (const id of committed.cancelMessageIds)
          rendererApplication.generationRuntime.discard(sessionId, id, 'session-cleared')
        clearSessionActivity(sessionId)
        if (platform.isDesktopLike)
          cleanup = platform
            .getSessionAttachmentRagController()
            .deleteSessionAttachments(sessionId)
            .then(() => undefined)
            .catch((error: unknown) => {
              console.warn('Failed to cleanup session attachment RAG entries while clearing session:', error)
            })
      }
    )
    if (result) return
  } finally {
    await cleanup
  }
}
