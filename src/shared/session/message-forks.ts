import { v4 as uuidv4 } from 'uuid'
import type { Message, Session, SessionThread } from '../types/session'

/**
 * Pure message-fork transforms shared by the web renderer and the mobile-native
 * app. These functions take a Session and return a `Partial<Session>` patch (or
 * null when nothing changes); the caller is responsible for persisting it. The
 * renderer wraps them in `chatStore.updateSessionWithMessages`, while native
 * applies the patch and writes through its SQLite repository.
 *
 * Fork model: `messageForksHash` is keyed by the fork-point message id (the
 * message after which branches diverge — i.e. the user message). Each entry
 * holds `lists` (one per branch) and the active `position`. The active branch's
 * tail lives in `session.messages` after the fork point; its slot in `lists` is
 * kept empty until you switch away, at which point the current tail is saved
 * back into it and the target branch's tail is spliced into `session.messages`.
 */

export type MessageForkEntry = NonNullable<Session['messageForksHash']>[string]
export type MessageLocation = { list: Message[]; index: number }

/**
 * Fork tails start after the pivot message and any compaction summaries
 * anchored to it. A summary is inserted immediately after its boundary
 * message; when that boundary is a fork pivot, the summary describes the
 * shared prefix and must stay in it — every branch then reuses the compacted
 * context instead of tearing the boundary/summary pair apart on switch.
 */
export function forkTailStartIndex(messages: Message[], forkMessageIndex: number): number {
  let index = forkMessageIndex + 1
  while (index < messages.length && messages[index].isSummary) {
    index += 1
  }
  return index
}

/**
 * Find the stored location of a message in root, thread, or saved fork messages.
 */
export function findMessageLocation(session: Session, messageId: string): MessageLocation | null {
  const rootIndex = session.messages.findIndex((m) => m.id === messageId)
  if (rootIndex >= 0) {
    return { list: session.messages, index: rootIndex }
  }
  for (const thread of session.threads ?? []) {
    const idx = thread.messages.findIndex((m) => m.id === messageId)
    if (idx >= 0) {
      return { list: thread.messages, index: idx }
    }
  }
  for (const fork of Object.values(session.messageForksHash ?? {})) {
    for (const branch of fork.lists) {
      const idx = branch.messages.findIndex((message) => message.id === messageId)
      if (idx >= 0) {
        return { list: branch.messages, index: idx }
      }
    }
  }
  return null
}

/**
 * Reconstruct the isolated conversation path containing a message. Saved fork
 * lists only store the tail after their pivot, so this joins each tail with its
 * reachable prefix while traversing the tree.
 */
export function findMessageContext(session: Session, messageId: string): MessageLocation | null {
  return searchMessageContext(session, messageId)?.location ?? null
}

/**
 * Find the archived thread whose message tree (including fork branches
 * reachable from it) contains the message. Returns null when the message
 * belongs to the active conversation or cannot be found.
 *
 * Compaction points are stored next to their message list (session-level for
 * the active path, thread-level for archived threads), so context building
 * for a message must read the points of the container found here.
 */
export function findMessageSourceThread(session: Session, messageId: string): SessionThread | null {
  return searchMessageContext(session, messageId)?.thread ?? null
}

function searchMessageContext(
  session: Session,
  messageId: string
): { location: MessageLocation; thread: SessionThread | null } | null {
  const search = (messages: Message[], expandedForkIds: Set<string>): MessageLocation | null => {
    const index = messages.findIndex((message) => message.id === messageId)
    if (index >= 0) {
      return { list: messages, index }
    }

    for (let pivotIndex = 0; pivotIndex < messages.length; pivotIndex += 1) {
      const pivotId = messages[pivotIndex].id
      const fork = session.messageForksHash?.[pivotId]
      if (!fork || expandedForkIds.has(pivotId)) {
        continue
      }

      const nextExpandedForkIds = new Set(expandedForkIds).add(pivotId)
      for (const branch of fork.lists) {
        if (branch.messages.length === 0) {
          continue
        }
        const branchContext = [...messages.slice(0, forkTailStartIndex(messages, pivotIndex)), ...branch.messages]
        const found = search(branchContext, nextExpandedForkIds)
        if (found) {
          return found
        }
      }
    }

    return null
  }

  const rootResult = search(session.messages, new Set())
  if (rootResult) {
    return { location: rootResult, thread: null }
  }
  for (const thread of session.threads ?? []) {
    const threadResult = search(thread.messages, new Set())
    if (threadResult) {
      return { location: threadResult, thread }
    }
  }
  return null
}

export function buildSwitchForkPatch(
  session: Session,
  forkMessageId: string,
  direction: 'next' | 'prev'
): Partial<Session> | null {
  return buildSwitchForkTargetPatch(session, forkMessageId, direction)
}

export function buildSwitchForkToPatch(
  session: Session,
  forkMessageId: string,
  position: number
): Partial<Session> | null {
  return buildSwitchForkTargetPatch(session, forkMessageId, position)
}

function buildSwitchForkTargetPatch(
  session: Session,
  forkMessageId: string,
  target: 'next' | 'prev' | number
): Partial<Session> | null {
  const { messageForksHash } = session
  if (!messageForksHash) {
    return null
  }

  const forkEntry = messageForksHash[forkMessageId]
  if (!forkEntry || forkEntry.lists.length <= 1) {
    return null
  }

  const rootResult = switchForkInMessages(session.messages, forkEntry, forkMessageId, target)
  if (rootResult) {
    const { messages, fork } = rootResult
    return {
      messages,
      messageForksHash: computeNextMessageForksHash(messageForksHash, forkMessageId, fork),
    }
  }

  if (!session.threads?.length) {
    return null
  }

  let updatedFork: MessageForkEntry | null = null
  let forkWasProcessed = false
  const updatedThreads = session.threads.map((thread) => {
    if (forkWasProcessed) {
      return thread
    }
    const result = switchForkInMessages(thread.messages, forkEntry, forkMessageId, target)
    if (!result) {
      return thread
    }
    forkWasProcessed = true
    updatedFork = result.fork
    return {
      ...thread,
      messages: result.messages,
    }
  })

  if (!forkWasProcessed) {
    return null
  }

  return {
    threads: updatedThreads,
    messageForksHash: computeNextMessageForksHash(messageForksHash, forkMessageId, updatedFork),
  }
}

function switchForkInMessages(
  messages: Message[],
  forkEntry: MessageForkEntry,
  forkMessageId: string,
  target: 'next' | 'prev' | number
): { messages: Message[]; fork: MessageForkEntry | null } | null {
  const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
  if (forkMessageIndex < 0) {
    return null
  }

  const tailStart = forkTailStartIndex(messages, forkMessageIndex)
  const currentTail = messages.slice(tailStart)
  const currentPosition = forkEntry.position
  if (
    typeof target === 'number' &&
    (!Number.isInteger(target) || target < 0 || target >= forkEntry.lists.length || target === currentPosition)
  ) {
    return null
  }

  // Check if current branch is empty (user deleted all messages in this branch)
  const isCurrentBranchEmpty = currentTail.length === 0

  // If current branch is empty, remove it from lists
  let updatedLists = forkEntry.lists
  let adjustedCurrentPosition = currentPosition

  if (isCurrentBranchEmpty) {
    updatedLists = forkEntry.lists.filter((_, index) => index !== currentPosition)
    // If only one branch remains after removing empty branch, clear fork entirely
    if (updatedLists.length <= 1) {
      const remainingMessages = updatedLists[0]?.messages ?? []
      return {
        messages: messages.slice(0, tailStart).concat(remainingMessages),
        fork: null,
      }
    }
    // Adjust position for removed branch
    adjustedCurrentPosition = currentPosition >= updatedLists.length ? updatedLists.length - 1 : currentPosition
  }

  const total = updatedLists.length
  let newPosition: number
  if (typeof target === 'number') {
    newPosition = isCurrentBranchEmpty && target > currentPosition ? target - 1 : target
  } else {
    newPosition =
      target === 'next' ? (adjustedCurrentPosition + 1) % total : (adjustedCurrentPosition - 1 + total) % total
  }

  const branchMessages = updatedLists[newPosition]?.messages ?? []

  const finalLists = updatedLists.map((list, index) => {
    // If we didn't remove current branch, save currentTail to it
    if (!isCurrentBranchEmpty && index === adjustedCurrentPosition && adjustedCurrentPosition !== newPosition) {
      return {
        ...list,
        messages: currentTail,
      }
    }
    if (index === newPosition) {
      return {
        ...list,
        messages: [],
      }
    }
    return list
  })

  const updatedFork: MessageForkEntry = {
    ...forkEntry,
    position: newPosition,
    lists: finalLists,
  }

  return {
    messages: messages.slice(0, tailStart).concat(branchMessages),
    fork: updatedFork,
  }
}

export function buildCreateForkPatch(session: Session, forkMessageId: string): Partial<Session> | null {
  return applyForkTransform(
    session,
    forkMessageId,
    () =>
      session.messageForksHash?.[forkMessageId] ?? {
        position: 0,
        lists: [
          {
            id: `fork_list_${uuidv4()}`,
            messages: [],
          },
        ],
        createdAt: Date.now(),
      },
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
      if (forkMessageIndex < 0) {
        return null
      }

      const tailStart = forkTailStartIndex(messages, forkMessageIndex)
      const backupMessages = messages.slice(tailStart)
      if (backupMessages.length === 0) {
        return null
      }

      const storedListId = `fork_list_${uuidv4()}`
      const newBranchId = `fork_list_${uuidv4()}`
      const lists = forkEntry.lists.map((list, index) =>
        index === forkEntry.position
          ? {
              id: storedListId,
              messages: backupMessages,
            }
          : list
      )
      const nextPosition = lists.length
      const updatedFork: MessageForkEntry = {
        ...forkEntry,
        position: nextPosition,
        lists: [
          ...lists,
          {
            id: newBranchId,
            messages: [],
          },
        ],
      }

      return {
        messages: messages.slice(0, tailStart),
        forkEntry: updatedFork,
      }
    }
  )
}

/**
 * Add a saved branch without changing the active branch.
 *
 * This is used by "Reply Again Below": the new candidate can stream in
 * parallel while the user's currently selected conversation remains active.
 */
export function buildCreateInactiveForkPatch(
  session: Session,
  forkMessageId: string,
  branchMessages: Message[]
): Partial<Session> | null {
  if (branchMessages.length === 0) {
    return null
  }

  return applyForkTransform(
    session,
    forkMessageId,
    () =>
      session.messageForksHash?.[forkMessageId] ?? {
        position: 0,
        lists: [
          {
            id: `fork_list_${uuidv4()}`,
            messages: [],
          },
        ],
        createdAt: Date.now(),
      },
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((message) => message.id === forkMessageId)
      if (forkMessageIndex < 0) {
        return null
      }

      // An inactive alternative only makes sense when an active answer already
      // follows the fork point (compaction summaries anchored to the pivot are
      // part of the shared prefix, not an answer). Callers should insert
      // normally for a bare user message so an empty branch is never exposed
      // in navigation.
      if (forkTailStartIndex(messages, forkMessageIndex) >= messages.length) {
        return null
      }

      return {
        messages,
        forkEntry: {
          ...forkEntry,
          lists: [
            ...forkEntry.lists,
            {
              id: `fork_list_${uuidv4()}`,
              messages: branchMessages,
            },
          ],
        },
      }
    }
  )
}

export function buildDeleteForkPatch(session: Session, forkMessageId: string): Partial<Session> | null {
  return applyForkTransform(
    session,
    forkMessageId,
    () => session.messageForksHash?.[forkMessageId] ?? null,
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
      if (forkMessageIndex < 0) {
        return null
      }

      const trimmedMessages = messages.slice(0, forkTailStartIndex(messages, forkMessageIndex))
      const remainingLists = forkEntry.lists.filter((_, index) => index !== forkEntry.position)

      if (remainingLists.length === 0) {
        return {
          messages: trimmedMessages,
          forkEntry: null,
        }
      }

      const nextPosition = Math.min(forkEntry.position, remainingLists.length - 1)
      const carryMessages = remainingLists[nextPosition]?.messages ?? []
      const updatedLists = remainingLists.map((list, index) =>
        index === nextPosition
          ? {
              ...list,
              messages: [],
            }
          : list
      )

      return {
        messages: trimmedMessages.concat(carryMessages),
        forkEntry: {
          ...forkEntry,
          position: nextPosition,
          lists: updatedLists,
        },
      }
    }
  )
}

export function buildExpandForkPatch(session: Session, forkMessageId: string): Partial<Session> | null {
  return applyForkTransform(
    session,
    forkMessageId,
    () => session.messageForksHash?.[forkMessageId] ?? null,
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
      if (forkMessageIndex < 0) {
        return null
      }

      const mergedMessages = forkEntry.lists.flatMap((list) => list.messages)
      if (mergedMessages.length === 0) {
        return {
          messages,
          forkEntry: null,
        }
      }
      return {
        messages: messages.concat(mergedMessages),
        forkEntry: null,
      }
    }
  )
}

type ForkTransformResult = { messages: Message[]; forkEntry: MessageForkEntry | null }
type ForkTransform = (messages: Message[], forkEntry: MessageForkEntry) => ForkTransformResult | null

function applyForkTransform(
  session: Session,
  forkMessageId: string,
  ensureForkEntry: () => MessageForkEntry | null,
  transform: ForkTransform
): Partial<Session> | null {
  const tryTransform = (messages: Message[]): ForkTransformResult | null => {
    const forkEntry = ensureForkEntry()
    if (!forkEntry) {
      return null
    }
    return transform(messages, forkEntry)
  }

  const rootResult = tryTransform(session.messages)
  if (rootResult) {
    return {
      messages: rootResult.messages,
      messageForksHash: computeNextMessageForksHash(session.messageForksHash, forkMessageId, rootResult.forkEntry),
    }
  }

  if (!session.threads?.length) {
    return null
  }

  let updatedFork: MessageForkEntry | null = null
  let changed = false
  const updatedThreads = session.threads.map((thread) => {
    if (changed) {
      return thread
    }
    const result = tryTransform(thread.messages)
    if (!result) {
      return thread
    }
    changed = true
    updatedFork = result.forkEntry
    return {
      ...thread,
      messages: result.messages,
    }
  })

  if (!changed) {
    return null
  }

  return {
    threads: updatedThreads,
    messageForksHash: computeNextMessageForksHash(session.messageForksHash, forkMessageId, updatedFork),
  }
}

function computeNextMessageForksHash(
  current: Session['messageForksHash'],
  forkMessageId: string,
  nextEntry: MessageForkEntry | null
): Session['messageForksHash'] | undefined {
  if (nextEntry) {
    return {
      ...(current ?? {}),
      [forkMessageId]: nextEntry,
    }
  }

  if (!current || !Object.hasOwn(current, forkMessageId)) {
    return current
  }

  const { [forkMessageId]: _removed, ...rest } = current
  return Object.keys(rest).length ? rest : undefined
}
