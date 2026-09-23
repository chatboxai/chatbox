import { findMessageLocation, forkTailStartIndex } from '../../session/message-forks'
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
  messageId: string,
  createId: () => string
): Session {
  if (!session) {
    throw new Error(`session ${sessionId} not found`)
  }
  const location = findMessageLocation(session, messageId)
  if (!location) return session

  const messageToDelete = location.list[location.index]
  let updated = session
  let replacementPivotId: string | undefined
  const removedFork = session.messageForksHash?.[messageId]
  if (removedFork) {
    let forks = { ...session.messageForksHash }
    delete forks[messageId]

    let previousIndex = location.index - 1
    while (previousIndex >= 0 && location.list[previousIndex].isSummary) previousIndex -= 1
    const containingFork = Object.entries(forks).find(([, fork]) =>
      fork.lists.some((list) => list.messages === location.list)
    )
    const parentId = previousIndex >= 0 ? location.list[previousIndex].id : containingFork?.[0]
    const hasAnchoredSummaries = forkTailStartIndex(location.list, location.index) > location.index + 1

    if (!parentId || hasAnchoredSummaries) {
      // The V1 format needs a real common pivot for root alternatives and for
      // summaries shared by only this subtree. An empty system message keeps
      // those branches reachable without retaining the deleted message payload.
      replacementPivotId = createId()
      const anchor: Message = { id: replacementPivotId, role: 'system', contentParts: [] }
      updated = replaceMessageList(
        { ...session, messageForksHash: forks },
        location.list,
        location.list.map((message) => (message.id === messageId ? anchor : message))
      )
      forks = { ...updated.messageForksHash, [replacementPivotId]: removedFork }
    } else {
      const parentFork = forks[parentId]
      if (parentFork) {
        const branchIndex =
          previousIndex >= 0
            ? parentFork.position
            : parentFork.lists.findIndex((list) => list.messages === location.list)
        const promotedLists = removedFork.lists.map((list, index) =>
          index === removedFork.position && branchIndex !== parentFork.position
            ? { ...list, messages: location.list.slice(location.index + 1) }
            : list
        )
        forks[parentId] = {
          ...parentFork,
          position:
            branchIndex === parentFork.position
              ? branchIndex + removedFork.position
              : parentFork.position + (branchIndex < parentFork.position ? promotedLists.length - 1 : 0),
          lists: [
            ...parentFork.lists.slice(0, branchIndex),
            ...promotedLists,
            ...parentFork.lists.slice(branchIndex + 1),
          ],
        }
      } else {
        forks[parentId] = removedFork
      }
    }
    updated = { ...updated, messageForksHash: forks }
  }

  const removeFromList = (messages: Message[]) => messages.filter((message) => message.id !== messageId)
  const updateCompactionPoints = (points: Session['compactionPoints']) =>
    points
      ?.filter((point) => messageToDelete.isSummary !== true || point.summaryMessageId !== messageId)
      .map((point) =>
        replacementPivotId && point.boundaryMessageId === messageId
          ? { ...point, boundaryMessageId: replacementPivotId }
          : point
      )

  return cleanupEmptyForkBranches({
    ...updated,
    messages: removeFromList(updated.messages),
    threads: updated.threads?.map((thread) => ({
      ...thread,
      messages: removeFromList(thread.messages),
      compactionPoints: updateCompactionPoints(thread.compactionPoints),
    })),
    messageForksHash:
      updated.messageForksHash &&
      Object.fromEntries(
        Object.entries(updated.messageForksHash).map(([pivotId, fork]) => [
          pivotId,
          {
            ...fork,
            lists: fork.lists.map((list) => ({ ...list, messages: removeFromList(list.messages) })),
          },
        ])
      ),
    compactionPoints: updateCompactionPoints(updated.compactionPoints),
  })
}

/** Replace a stored path, including paths inside archived threads and saved branches. */
function replaceMessageList(session: Session, original: Message[], replacement: Message[]): Session {
  return {
    ...session,
    messages: session.messages === original ? replacement : session.messages,
    threads: session.threads?.map((thread) =>
      thread.messages === original ? { ...thread, messages: replacement } : thread
    ),
    messageForksHash:
      session.messageForksHash &&
      Object.fromEntries(
        Object.entries(session.messageForksHash).map(([pivotId, fork]) => [
          pivotId,
          {
            ...fork,
            lists: fork.lists.map((list) => (list.messages === original ? { ...list, messages: replacement } : list)),
          },
        ])
      ),
  }
}

/** Drop empty alternatives and load a surviving branch when its active path becomes empty. */
function cleanupEmptyForkBranches(session: Session): Session {
  let updated = session
  for (const pivotId of Object.keys(session.messageForksHash ?? {})) {
    const fork = updated.messageForksHash?.[pivotId]
    const location = findMessageLocation(updated, pivotId)
    if (!fork || !location) continue

    const tailStart = forkTailStartIndex(location.list, location.index)
    const activeIsEmpty = tailStart === location.list.length
    const surviving = fork.lists
      .map((list, index) => ({ list, index }))
      .filter(({ list, index }) => (index === fork.position ? !activeIsEmpty : list.messages.length > 0))
    const position = activeIsEmpty
      ? Math.min(surviving.filter(({ index }) => index < fork.position).length, surviving.length - 1)
      : surviving.findIndex(({ index }) => index === fork.position)

    if (activeIsEmpty && position >= 0) {
      updated = replaceMessageList(
        updated,
        location.list,
        location.list.slice(0, tailStart).concat(surviving[position].list.messages)
      )
    }

    const forks = { ...updated.messageForksHash }
    if (surviving.length <= 1) {
      delete forks[pivotId]
    } else {
      forks[pivotId] = {
        ...fork,
        position,
        lists: surviving.map(({ list }, index) => (index === position ? { ...list, messages: [] } : list)),
      }
    }
    updated = { ...updated, messageForksHash: Object.keys(forks).length ? forks : undefined }
  }
  return updated
}
