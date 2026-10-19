import type { Message, Session } from '../types/session'

/** Historical input stores a selected fork tail in its owning message list. */
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

export function buildSwitchForkToPatch(
  session: Session,
  forkMessageId: string,
  position: number
): Partial<Session> | null {
  return buildSwitchForkTargetPatch(session, forkMessageId, position)
}

function buildSwitchForkTargetPatch(session: Session, forkMessageId: string, target: number): Partial<Session> | null {
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
  target: number
): { messages: Message[]; fork: MessageForkEntry | null } | null {
  const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
  if (forkMessageIndex < 0) {
    return null
  }

  const tailStart = forkTailStartIndex(messages, forkMessageIndex)
  const currentTail = messages.slice(tailStart)
  const currentPosition = forkEntry.position
  if (!Number.isInteger(target) || target < 0 || target >= forkEntry.lists.length || target === currentPosition) {
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

  const newPosition = isCurrentBranchEmpty && target > currentPosition ? target - 1 : target

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
