import type { Message, Session, SessionThread } from '../types/session'
import { getReachableSessionMessages } from './generation-state'

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

export interface ForkIdentityPort {
  createId(): string
  now(): number
}

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
  const rootIndex = session.messages.findIndex((message) => message.id === messageId)
  if (rootIndex >= 0) {
    return { location: { list: session.messages, index: rootIndex }, thread: null }
  }
  for (const thread of session.threads ?? []) {
    const threadIndex = thread.messages.findIndex((message) => message.id === messageId)
    if (threadIndex >= 0) {
      return { location: { list: thread.messages, index: threadIndex }, thread }
    }
  }

  // The message lives (if anywhere) in a saved fork branch. Rebuild that
  // branch's path by walking its pivot chain up to the root/thread instead of
  // enumerating branch combinations top-down: message ids are unique, so each
  // pivot is stored in exactly one place, and the walk stays linear where the
  // top-down expansion re-explored shared prefixes exponentially once a
  // conversation accumulated many fork points (each Reply Again adds one).
  for (const [pivotId, fork] of Object.entries(session.messageForksHash ?? {})) {
    for (const branch of fork.lists) {
      const branchIndex = branch.messages.findIndex((message) => message.id === messageId)
      if (branchIndex < 0) {
        continue
      }
      // An unreachable pivot means orphaned fork data; the branch is not part
      // of any conversation path, matching the previous behavior of never
      // expanding it.
      const prefix = buildBranchPathPrefix(session, pivotId, new Set([pivotId]))
      if (!prefix) {
        continue
      }
      return {
        location: { list: [...prefix.messages, ...branch.messages], index: prefix.messages.length + branchIndex },
        thread: prefix.thread,
      }
    }
  }
  return null
}

/**
 * Conversation-path prefix leading into the fork at `pivotId`: every message
 * up to the pivot plus its anchored summaries, resolved recursively when the
 * pivot itself lives inside another saved branch. Returns null when the pivot
 * is not reachable from the root or any thread (orphaned fork data).
 */
function buildBranchPathPrefix(
  session: Session,
  pivotId: string,
  visitedPivotIds: Set<string>
): { messages: Message[]; thread: SessionThread | null } | null {
  const rootIndex = session.messages.findIndex((message) => message.id === pivotId)
  if (rootIndex >= 0) {
    return { messages: session.messages.slice(0, forkTailStartIndex(session.messages, rootIndex)), thread: null }
  }
  for (const thread of session.threads ?? []) {
    const threadIndex = thread.messages.findIndex((message) => message.id === pivotId)
    if (threadIndex >= 0) {
      return { messages: thread.messages.slice(0, forkTailStartIndex(thread.messages, threadIndex)), thread }
    }
  }
  for (const [outerPivotId, fork] of Object.entries(session.messageForksHash ?? {})) {
    if (visitedPivotIds.has(outerPivotId)) {
      continue
    }
    for (const branch of fork.lists) {
      const branchIndex = branch.messages.findIndex((message) => message.id === pivotId)
      if (branchIndex < 0) {
        continue
      }
      const outerPrefix = buildBranchPathPrefix(session, outerPivotId, new Set(visitedPivotIds).add(outerPivotId))
      if (!outerPrefix) {
        continue
      }
      return {
        messages: [
          ...outerPrefix.messages,
          ...branch.messages.slice(0, forkTailStartIndex(branch.messages, branchIndex)),
        ],
        thread: outerPrefix.thread,
      }
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

  let updatedFork: MessageForkEntry | null = null
  let forkWasProcessed = false
  const updatedThreads = session.threads?.map((thread) => {
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

  if (forkWasProcessed) {
    return {
      threads: updatedThreads,
      messageForksHash: computeNextMessageForksHash(messageForksHash, forkMessageId, updatedFork),
    }
  }

  let containingForkId: string | null = null
  let containingListIndex = -1
  let updatedContainingMessages: Message[] | null = null
  for (const [candidateForkId, candidateFork] of Object.entries(messageForksHash)) {
    if (candidateForkId === forkMessageId) continue
    for (const [listIndex, list] of candidateFork.lists.entries()) {
      const result = switchForkInMessages(list.messages, forkEntry, forkMessageId, target)
      if (!result) continue
      containingForkId = candidateForkId
      containingListIndex = listIndex
      updatedContainingMessages = result.messages
      updatedFork = result.fork
      break
    }
    if (containingForkId) break
  }
  if (!containingForkId || containingListIndex < 0 || !updatedContainingMessages) return null

  const containingFork = messageForksHash[containingForkId]
  const withUpdatedContainer = {
    ...messageForksHash,
    [containingForkId]: {
      ...containingFork,
      lists: containingFork.lists.map((list, listIndex) =>
        listIndex === containingListIndex ? { ...list, messages: updatedContainingMessages } : list
      ),
    },
  }
  return {
    messageForksHash: computeNextMessageForksHash(withUpdatedContainer, forkMessageId, updatedFork),
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

export function buildCreateForkPatch(
  session: Session,
  forkMessageId: string,
  identity: ForkIdentityPort
): Partial<Session> | null {
  return applyForkTransform(
    session,
    forkMessageId,
    () =>
      session.messageForksHash?.[forkMessageId] ?? {
        position: 0,
        lists: [
          {
            id: `fork_list_${identity.createId()}`,
            messages: [],
          },
        ],
        createdAt: identity.now(),
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

      const storedListId = `fork_list_${identity.createId()}`
      const newBranchId = `fork_list_${identity.createId()}`
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
 * Save & Resend: version the edited message instead of overwriting it in
 * place. The original message and everything after it are stored as a new
 * branch anchored at the message's predecessor, and `replacement` (the edited
 * copy under a NEW id) becomes the head of the fresh active tail — so the
 * stored branch keeps the prompt its replies actually answered.
 *
 * The pivot is the nearest preceding non-summary message, matching the
 * regenerate convention: forks keyed on a summary id would attach navigation
 * to SummaryMessage and break when the summary is deleted; anchored summaries
 * stay in the shared prefix via `forkTailStartIndex` either way.
 *
 * Returns null when the target is missing, has no eligible predecessor in its
 * container (conversation-first message), or does not head the pivot's tail
 * (stale lookup / summary target). Callers fall back to the legacy
 * overwrite-in-place shape for those cases.
 */
export function buildSaveAndResendForkPatch(
  session: Session,
  targetMessageId: string,
  replacement: Message,
  identity: ForkIdentityPort
): Partial<Session> | null {
  const location = findMessageLocation(session, targetMessageId)
  if (!location) {
    return null
  }
  let pivotIndex = location.index - 1
  while (pivotIndex >= 0 && location.list[pivotIndex].isSummary) {
    pivotIndex -= 1
  }
  if (pivotIndex < 0) {
    return null
  }
  const pivotId = location.list[pivotIndex].id

  return applyForkTransform(
    session,
    pivotId,
    () =>
      session.messageForksHash?.[pivotId] ?? {
        position: 0,
        lists: [
          {
            id: `fork_list_${identity.createId()}`,
            messages: [],
          },
        ],
        createdAt: identity.now(),
      },
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((m) => m.id === pivotId)
      if (forkMessageIndex < 0) {
        return null
      }

      const tailStart = forkTailStartIndex(messages, forkMessageIndex)
      const backupMessages = messages.slice(tailStart)
      // The target must head the stored tail: everything between the pivot and
      // the target is an anchored summary kept in the shared prefix, so
      // anything else in front means the predecessor lookup went stale.
      if (backupMessages[0]?.id !== targetMessageId) {
        return null
      }

      const storedListId = `fork_list_${identity.createId()}`
      const newBranchId = `fork_list_${identity.createId()}`
      const lists = forkEntry.lists.map((list, index) =>
        index === forkEntry.position
          ? {
              id: storedListId,
              messages: backupMessages,
            }
          : list
      )
      return {
        messages: messages.slice(0, tailStart).concat(replacement),
        forkEntry: {
          ...forkEntry,
          position: lists.length,
          lists: [
            ...lists,
            {
              id: newBranchId,
              messages: [],
            },
          ],
        },
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
  branchMessages: Message[],
  identity: ForkIdentityPort
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
            id: `fork_list_${identity.createId()}`,
            messages: [],
          },
        ],
        createdAt: identity.now(),
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
              id: `fork_list_${identity.createId()}`,
              messages: branchMessages,
            },
          ],
        },
      }
    }
  )
}

export function buildDeleteForkPatch(session: Session, forkMessageId: string): Partial<Session> | null {
  const patch = applyForkTransform(
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
  if (!patch) return null

  const updated = { ...session, ...patch }
  const messageForksHash = updated.messageForksHash
  if (!messageForksHash) return patch

  const reachableMessageIds = new Set(getReachableSessionMessages(updated).map((message) => message.id))
  const reachableForks = Object.fromEntries(
    Object.entries(messageForksHash).filter(([pivotId]) => reachableMessageIds.has(pivotId))
  )
  return {
    ...patch,
    messageForksHash: Object.keys(reachableForks).length ? reachableForks : undefined,
  }
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
