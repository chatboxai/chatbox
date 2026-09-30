import type { CompactionPoint, Message, Session, SessionThread } from '../../types/session'
import { forkTailStartIndex } from '../message-forks'
import { repairSessionV1 } from './repair'

type MessageForkEntry = NonNullable<Session['messageForksHash']>[string]
type MessageForkList = MessageForkEntry['lists'][number]

export type NormalizeSessionV1Result =
  | {
      ok: true
      session: Session
      /** True when repairs changed the input's messages, ids or threads. */
      reshaped: boolean
    }
  | { ok: false; reason: string }

const ACTIVE_THREAD_KEY = 'active'

function archivedThreadKey(index: number): string {
  return `archived:${index}`
}

interface ContainerRef {
  threadKey: string
  messages: Message[]
}

interface PivotLocation {
  container: Message[]
  index: number
}

/**
 * Canonical V1 form for tree encoding: orphaned and non-switchable fork
 * entries removed, empty saved branches dropped, an empty active branch moved
 * to the end of `lists`, dangling compaction points removed, and empty
 * optional containers reduced to absent.
 *
 * Shapes the row model cannot represent are repaired first (see
 * `repairSessionV1`). A fork whose pivot is not reachable from any thread is
 * removed together with its saved branches: released clients render and export
 * branches only from a reachable pivot, so those messages were never visible.
 *
 * Remaining structural damage that cannot be canonicalized without losing
 * visible messages is reported instead of repaired.
 */
export function normalizeSessionV1(input: Session): NormalizeSessionV1Result {
  const session = repairSessionV1(input)
  const forks = session.messageForksHash ?? {}
  const archivedThreads = session.threads ?? []

  const queue: ContainerRef[] = [{ threadKey: ACTIVE_THREAD_KEY, messages: session.messages }]
  for (const [index, thread] of archivedThreads.entries()) {
    queue.push({ threadKey: archivedThreadKey(index), messages: thread.messages })
  }

  const pivots = new Map<string, PivotLocation>()
  const threadMessageIds = new Map<string, Set<string>>()
  const messagesById = new Map<string, Message>()

  while (queue.length > 0) {
    const container = queue.shift()
    if (!container) {
      break
    }
    let ids = threadMessageIds.get(container.threadKey)
    if (!ids) {
      ids = new Set<string>()
      threadMessageIds.set(container.threadKey, ids)
    }
    for (const [index, message] of container.messages.entries()) {
      if (messagesById.has(message.id)) {
        return { ok: false, reason: `duplicate message id ${message.id}` }
      }
      messagesById.set(message.id, message)
      ids.add(message.id)

      const fork = forks[message.id]
      if (!fork || pivots.has(message.id)) {
        continue
      }
      pivots.set(message.id, { container: container.messages, index })
      for (const list of fork.lists) {
        queue.push({ threadKey: container.threadKey, messages: list.messages })
      }
    }
  }

  const normalizedForks: Record<string, MessageForkEntry> = {}
  for (const [pivotId, location] of pivots) {
    const fork = forks[pivotId]
    if (fork.lists.length === 0) {
      continue
    }
    if (location.container[location.index].isSummary) {
      return { ok: false, reason: `fork pivot ${pivotId} is a summary message` }
    }
    if (!Number.isInteger(fork.position) || fork.position < 0 || fork.position >= fork.lists.length) {
      return { ok: false, reason: `fork ${pivotId} has out-of-range position ${fork.position}` }
    }
    if (fork.lists[fork.position].messages.length > 0) {
      return { ok: false, reason: `fork ${pivotId} stores messages in its active branch` }
    }

    const kept: MessageForkList[] = []
    let activeIndex = -1
    for (const [index, list] of fork.lists.entries()) {
      if (index === fork.position) {
        activeIndex = kept.length
        kept.push(list)
        continue
      }
      if (list.messages.length > 0) {
        kept.push(list)
      }
    }
    if (kept.length <= 1) {
      continue
    }

    const activeTailIsEmpty = forkTailStartIndex(location.container, location.index) >= location.container.length
    if (activeTailIsEmpty && activeIndex !== kept.length - 1) {
      normalizedForks[pivotId] = {
        ...fork,
        position: kept.length - 1,
        lists: [...kept.slice(0, activeIndex), ...kept.slice(activeIndex + 1), kept[activeIndex]],
      }
      continue
    }
    normalizedForks[pivotId] = { ...fork, position: activeIndex, lists: kept }
  }

  const keepCompactionPoint = (point: CompactionPoint, ids: Set<string>): boolean =>
    ids.has(point.summaryMessageId) &&
    ids.has(point.boundaryMessageId) &&
    messagesById.get(point.summaryMessageId)?.isSummary === true

  const normalizedThreads: SessionThread[] = archivedThreads.map((thread, index) => {
    const ids = threadMessageIds.get(archivedThreadKey(index)) ?? new Set<string>()
    const points = (thread.compactionPoints ?? []).filter((point) => keepCompactionPoint(point, ids))
    const { compactionPoints: _compactionPoints, ...rest } = thread
    return { ...rest, ...(points.length > 0 ? { compactionPoints: points } : {}) }
  })

  const activeIds = threadMessageIds.get(ACTIVE_THREAD_KEY) ?? new Set<string>()
  const activePoints = (session.compactionPoints ?? []).filter((point) => keepCompactionPoint(point, activeIds))

  const {
    threads: _threads,
    threadName,
    messageForksHash: _messageForksHash,
    compactionPoints: _compactionPoints,
    ...rest
  } = session

  return {
    ok: true,
    reshaped: session !== input,
    session: {
      ...rest,
      ...(normalizedThreads.length > 0 ? { threads: normalizedThreads } : {}),
      ...(threadName === undefined ? {} : { threadName }),
      ...(activePoints.length > 0 ? { compactionPoints: activePoints } : {}),
      ...(Object.keys(normalizedForks).length > 0 ? { messageForksHash: normalizedForks } : {}),
    },
  }
}
