import type { Message, Session, Updater } from '../../types'

/** Thrown by `applyMessageInsert({ requireAnchor: true })` when `previousId` is unreachable. */
export class MessageAnchorNotFoundError extends Error {
  constructor(
    readonly sessionId: string,
    readonly anchorMessageId: string
  ) {
    super(`Anchor message ${anchorMessageId} not found in session ${sessionId}`)
    this.name = 'MessageAnchorNotFoundError'
  }
}

export interface MessageInsertOptions {
  /**
   * Fail instead of appending to the current list when `previousId` cannot be
   * located. Writers whose correctness depends on the insert landing directly
   * after a specific message (the steering continuation) must opt in: a fork
   * switch can move the anchor into `messageForksHash`, which this lookup does
   * not search, and a silent tail append would stream into the wrong branch.
   */
  requireAnchor?: boolean
}

export function applyMessageInsert(
  session: Session | null | undefined,
  sessionId: string,
  message: Message,
  previousId?: string,
  options: MessageInsertOptions = {}
): Session {
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
      if (session.messages.some((existing) => existing.id === message.id)) return session
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
          if (thread.messages.some((existing) => existing.id === message.id)) return session
          const insertIndex = afterAnchoredSummaries(thread.messages, previousIndex)
          return {
            ...session,
            threads: session.threads.map((th) => {
              if (th.id === thread.id) {
                return {
                  ...thread,
                  messages: [...thread.messages.slice(0, insertIndex), message, ...thread.messages.slice(insertIndex)],
                }
              }
              return th
            }),
          } satisfies Session
        }
      }
    }

    if (options.requireAnchor) {
      // Idempotent retry: a caller that re-inserts after an ambiguous write
      // failure must not be told the anchor vanished when the row landed.
      if (
        session.messages.some((existing) => existing.id === message.id) ||
        session.threads?.some((thread) => thread.messages.some((existing) => existing.id === message.id))
      ) {
        return session
      }
      throw new MessageAnchorNotFoundError(sessionId, previousId)
    }
  }
  // no previous message, insert to tail of current thread
  if (session.messages.some((existing) => existing.id === message.id)) return session
  return {
    ...session,
    messages: [...session.messages, message],
  } satisfies Session
}

export function applyMessagesReplace(
  session: Session | null | undefined,
  sessionId: string,
  updater: Updater<Message[]>
): Session {
  if (!session) {
    throw new Error(`session ${sessionId} not found`)
  }
  const updated = (typeof updater === 'function' ? updater(session.messages) : updater).filter(
    (message): message is Message => Boolean(message)
  )
  return {
    ...session,
    messages: updated,
  }
}

export function applyMessageUpdate(
  session: Session | null | undefined,
  sessionId: string,
  messageId: string,
  updater: Updater<Message>
): Session {
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

export function applyMessageRemoval(
  session: Session | null | undefined,
  sessionId: string,
  messageId: string
): Session {
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
