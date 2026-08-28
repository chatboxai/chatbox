import {
  copyMessageForksWithMapping,
  copyMessagesWithMapping,
  copyThreadsWithMapping,
  createMessage,
  remapCompactionPoints,
  type Session,
  type SessionMeta,
} from '@shared/types'
import { areSessionsInSameDragGroup } from '@shared/utils/session-sort'
import { getDefaultStore } from 'jotai'
import { omit } from 'lodash'
import platform from '@/platform'
import { router } from '@/router'
import { sortSessionRecords } from '@/storage/SessionMetaStorage'
import * as atoms from '../atoms'
import * as chatStore from '../chatStore'
import * as scrollActions from '../scrollActions'
import { clearSessionActivity } from '../sessionActivityStore'
import { initEmptyChatSession, initEmptyPictureSession } from '../sessionHelpers'
import { getGenerationControlMessages } from './generation-state'

/**
 * Create a new session and switch to it
 */
async function create(newSession: Omit<Session, 'id'>) {
  const session = await chatStore.createSession(newSession)
  switchCurrentSession(session.id)
  return session
}

/**
 * Create a new empty session
 */
export async function createEmpty(type: 'chat' | 'picture') {
  let newSession: Session
  switch (type) {
    case 'chat':
      newSession = await create(initEmptyChatSession())
      break
    case 'picture':
      newSession = await create(initEmptyPictureSession())
      break
    default:
      throw new Error(`Unknown session type: ${type}`)
  }
  return newSession
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
  },
  options?: {
    appendForkMarker?: boolean
  }
) {
  const source = await chatStore.getSession(sourceMeta.id)
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
    ...(sourceMeta.threadName ? { threadName: sourceMeta.threadName } : {}),
  }
  return await chatStore.createSession(newSession, source.id)
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
  router.navigate({
    to: '/session/$sessionId',
    params: { sessionId },
  })
  scrollActions.clearAutoScroll()
}

/**
 * Reorder sessions in the list using fractional indexing.
 * Moves the dragged session (activeId) onto the position of overId, guarded to
 * the same visual drag group (both pinned, or both in the same folder / unfiled).
 */
export async function reorderSessions(activeId: string, overId: string) {
  console.debug('sessionActions', 'reorderSessions', activeId, overId)
  if (activeId === overId) return
  const sessions = await chatStore.listSessionsMeta()
  const activeSession = sessions.find((s) => s.id === activeId)
  const overSession = sessions.find((s) => s.id === overId)
  if (!activeSession || !overSession) return
  if (!areSessionsInSameDragGroup(activeSession, overSession)) return

  // Fractional indexing within the shared drag group; group order is sortOrder descending.
  const groupSessions = sessions.filter((s) => areSessionsInSameDragGroup(s, activeSession))
  const activeIndex = groupSessions.findIndex((s) => s.id === activeId)
  const overIndex = groupSessions.findIndex((s) => s.id === overId)
  if (activeIndex < 0 || overIndex < 0) return
  const reordered = [...groupSessions]
  reordered.splice(activeIndex, 1)
  reordered.splice(overIndex, 0, activeSession)
  const targetIndex = reordered.findIndex((s) => s.id === activeId)
  const before = reordered[targetIndex - 1]
  const after = reordered[targetIndex + 1]

  let newSortOrder: number
  if (!before && !after) {
    newSortOrder = Date.now()
  } else if (!before) {
    newSortOrder = after.sortOrder + 1000
  } else if (!after) {
    newSortOrder = before.sortOrder - 1000
  } else {
    newSortOrder = (before.sortOrder + after.sortOrder) / 2
  }

  const metaStorage = await chatStore.getMetaStorage()
  await metaStorage.update(activeSession.id, { sortOrder: newSortOrder })
  chatStore.updateSessionListData((items) => {
    const updated = items.map((s) => (s.id === activeSession.id ? { ...s, sortOrder: newSortOrder } : s))
    return sortSessionRecords(updated)
  })
}

/**
 * Switch to session by sorted index
 */
export async function switchToIndex(index: number) {
  const sessions = await chatStore.listSessionsMeta()
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
  const sessions = await chatStore.listSessionsMeta()
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
  const sessionMetaList = await chatStore.listAllSessionsMeta()
  const archived = sessionMetaList?.slice(keepNum)
  if (!archived?.length) {
    return
  }
  await chatStore.archiveSessions(archived.map((s) => s.id))
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
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  for (const message of getGenerationControlMessages(session)) {
    message.cancel?.()
  }
  if (platform.type === 'desktop') {
    try {
      await platform.getSessionAttachmentRagController().deleteSessionAttachments(sessionId)
    } catch (error) {
      console.warn('Failed to cleanup session attachment RAG entries while clearing session:', error)
    }
  }
  const updated = await chatStore.updateSessionWithMessages(session.id, {
    messages: session.messages.filter((m) => m.role === 'system').slice(0, 1),
    threads: undefined,
    messageForksHash: undefined,
  })
  clearSessionActivity(session.id)
  return updated
}

// Re-export copySession for use by threads.ts (moveThreadToConversations)
export { copySession as _copySession }
