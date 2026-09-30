import type { CompactionPoint, Message, Session, SessionThread } from '../../types/session'

type MessageForkEntry = NonNullable<Session['messageForksHash']>[string]

interface Container {
  threadKey: string
  messages: Message[]
}

interface PivotLocation {
  threadKey: string
  messages: Message[]
  index: number
}

const ACTIVE_THREAD_KEY = 'active'

function archivedThreadKey(index: number): string {
  return `archived:${index}`
}

/**
 * Derives an id from `base` that `taken` does not contain and records it.
 * Normalization runs on every fingerprint of a stored V1 record, so a repaired
 * id must be the same each time the same input is repaired.
 */
function deriveId(base: string, suffix: string, taken: Set<string>): string {
  let id = `${base}~${suffix}`
  for (let attempt = 2; taken.has(id); attempt += 1) {
    id = `${base}~${suffix}${attempt}`
  }
  taken.add(id)
  return id
}

/** Copies every container array so repairs can edit them without touching the input. */
function cloneStructure(session: Session): Session {
  return {
    ...session,
    messages: [...session.messages],
    ...(session.threads
      ? { threads: session.threads.map((thread) => ({ ...thread, messages: [...thread.messages] })) }
      : {}),
    ...(session.messageForksHash
      ? {
          messageForksHash: Object.fromEntries(
            Object.entries(session.messageForksHash).map(([pivotId, fork]) => [
              pivotId,
              { ...fork, lists: fork.lists.map((list) => ({ ...list, messages: [...list.messages] })) },
            ])
          ),
        }
      : {}),
  }
}

function rootContainers(session: Session): Container[] {
  return [
    { threadKey: ACTIVE_THREAD_KEY, messages: session.messages },
    ...(session.threads ?? []).map((thread, index) => ({
      threadKey: archivedThreadKey(index),
      messages: thread.messages,
    })),
  ]
}

/**
 * Visits reachable messages in the order `normalizeSessionV1` does: the active
 * thread, archived threads, then the saved branches of each reachable pivot.
 */
function visitReachable(
  session: Session,
  visit: (message: Message, location: PivotLocation) => void,
  onPivot?: (pivotId: string, location: PivotLocation) => void
): void {
  const forks = session.messageForksHash ?? {}
  const queue = rootContainers(session)
  const pivots = new Set<string>()
  while (queue.length > 0) {
    const container = queue.shift()
    if (!container) break
    for (let index = 0; index < container.messages.length; index += 1) {
      const message = container.messages[index]
      const location = { threadKey: container.threadKey, messages: container.messages, index }
      visit(message, location)
      const fork = forks[message.id]
      if (!fork || pivots.has(message.id)) continue
      pivots.add(message.id)
      onPivot?.(message.id, location)
      for (const list of fork.lists) queue.push({ threadKey: container.threadKey, messages: list.messages })
    }
  }
}

function collectMessageIds(session: Session): Set<string> {
  const ids = new Set<string>()
  const add = (messages: Message[]) => {
    for (const message of messages) ids.add(message.id)
  }
  add(session.messages)
  for (const thread of session.threads ?? []) add(thread.messages)
  for (const [pivotId, fork] of Object.entries(session.messageForksHash ?? {})) {
    ids.add(pivotId)
    for (const list of fork.lists) add(list.messages)
  }
  return ids
}

/** Archived threads need a name and an id distinct from the session and from each other. */
function repairThreads(session: Session): Session {
  const threads = session.threads
  if (!threads?.length) return session
  const taken = new Set([session.id, ...threads.map((thread) => thread.id)])
  const used = new Set([session.id])
  let changed = false
  const repaired = threads.map((thread): SessionThread => {
    let next = thread
    if (typeof next.name !== 'string') {
      next = { ...next, name: '' }
    }
    if (used.has(next.id)) {
      next = { ...next, id: deriveId(thread.id, 'thread', taken) }
    }
    used.add(next.id)
    if (next !== thread) changed = true
    return next
  })
  return changed ? { ...session, threads: repaired } : session
}

function hasUsableId(message: Message): boolean {
  return typeof message.id === 'string' && message.id !== ''
}

/**
 * Keeps the first reachable occurrence of a message id and gives later
 * occurrences, and messages without an id, derived ids. Compaction points of a
 * thread that only holds the renamed copy follow it.
 */
function repairDuplicateMessageIds(session: Session): Session {
  const seen = new Set<string>()
  let duplicated = false
  visitReachable(session, (message) => {
    if (!hasUsableId(message) || seen.has(message.id)) duplicated = true
    seen.add(message.id)
  })
  if (!duplicated) return session

  const repaired = cloneStructure(session)
  const taken = collectMessageIds(session)
  const kept = new Map<string, Set<string>>()
  const renamed = new Map<string, Map<string, string>>()
  const first = new Set<string>()
  // The first occurrence of an id is the one its fork entry branches from.
  const movedPivots = new Map<string, string>()
  visitReachable(repaired, (message, location) => {
    if (!hasUsableId(message)) {
      const id = deriveId(session.id, 'message', taken)
      location.messages[location.index] = { ...message, id }
      if (!first.has(message.id)) {
        first.add(message.id)
        if (repaired.messageForksHash?.[message.id]) movedPivots.set(message.id, id)
      }
      return
    }
    if (!first.has(message.id)) {
      first.add(message.id)
      const ids = kept.get(location.threadKey) ?? new Set<string>()
      kept.set(location.threadKey, ids)
      ids.add(message.id)
      return
    }
    const id = deriveId(message.id, 'dup', taken)
    location.messages[location.index] = { ...message, id }
    const renames = renamed.get(location.threadKey) ?? new Map<string, string>()
    renamed.set(location.threadKey, renames)
    if (!renames.has(message.id)) renames.set(message.id, id)
  })

  const remapPoints = (threadKey: string, points: CompactionPoint[] | undefined) => {
    const renames = renamed.get(threadKey)
    if (!points || !renames) return points
    const ids = kept.get(threadKey) ?? new Set<string>()
    const remap = (id: string) => (ids.has(id) ? id : (renames.get(id) ?? id))
    return points.map((point) => ({
      ...point,
      summaryMessageId: remap(point.summaryMessageId),
      boundaryMessageId: remap(point.boundaryMessageId),
    }))
  }
  const forks = repaired.messageForksHash && movedPivots.size > 0 ? { ...repaired.messageForksHash } : undefined
  for (const [from, to] of movedPivots) {
    if (!forks) break
    forks[to] = forks[from]
    delete forks[from]
  }
  return {
    ...repaired,
    ...(forks ? { messageForksHash: forks } : {}),
    ...(repaired.compactionPoints
      ? { compactionPoints: remapPoints(ACTIVE_THREAD_KEY, repaired.compactionPoints) }
      : {}),
    ...(repaired.threads
      ? {
          threads: repaired.threads.map((thread, index) =>
            thread.compactionPoints
              ? { ...thread, compactionPoints: remapPoints(archivedThreadKey(index), thread.compactionPoints) }
              : thread
          ),
        }
      : {}),
  }
}

/**
 * The active branch of a fork lives inline after its pivot, and `lists[position]`
 * is its empty placeholder. A position outside `lists` points at an existing
 * empty placeholder, or at a new one when every list holds messages. Messages
 * stored in the placeholder itself move to a saved branch of their own:
 * releases up to 1.22.1 display them when the fork is expanded.
 */
function repairForks(session: Session): Session {
  const forks = session.messageForksHash
  if (!forks) return session
  let changed = false
  const repaired: Record<string, MessageForkEntry> = {}
  for (const [pivotId, fork] of Object.entries(forks)) {
    let { position, lists } = fork
    // Rows keep a fork's creation time in the session record, where a missing value reads back as 0.
    const createdAt = typeof fork.createdAt === 'number' ? fork.createdAt : 0
    if (lists.length > 0 && (!Number.isInteger(position) || position < 0 || position >= lists.length)) {
      position = lists.findIndex((list) => list.messages.length === 0)
      if (position < 0) {
        const listIds = new Set(lists.map((list) => list.id).filter((id): id is string => typeof id === 'string'))
        lists = [...lists, { id: deriveId(pivotId, 'active', listIds), messages: [] }]
        position = lists.length - 1
      }
    }
    if (lists.length > 0 && lists[position].messages.length > 0) {
      const listIds = new Set(lists.map((list) => list.id).filter((id): id is string => typeof id === 'string'))
      lists = [
        ...lists.map((list, index) => (index === position ? { ...list, messages: [] } : list)),
        { id: deriveId(pivotId, 'residual', listIds), messages: lists[position].messages },
      ]
    }
    if (position !== fork.position || lists !== fork.lists || createdAt !== fork.createdAt) {
      changed = true
      repaired[pivotId] = { ...fork, position, lists, createdAt }
    } else {
      repaired[pivotId] = fork
    }
  }
  return changed ? { ...session, messageForksHash: repaired } : session
}

function findSummaryPivot(session: Session): { pivotId: string; location: PivotLocation } | null {
  const forks = session.messageForksHash ?? {}
  let found: { pivotId: string; location: PivotLocation } | null = null
  visitReachable(
    session,
    () => {},
    (pivotId, location) => {
      if (!found && location.messages[location.index].isSummary && forks[pivotId].lists.length > 0) {
        found = { pivotId, location }
      }
    }
  )
  return found
}

/**
 * Rows attach a branch to the nearest non-summary message before it, with the
 * summaries in between shared by every branch. A fork stored on a summary moves
 * there, joining that message's own fork when it has one. A summary with no
 * such message before it gets an empty system message as its branch point.
 */
function repairSummaryPivots(session: Session): Session {
  if (!findSummaryPivot(session)) return session
  let repaired = cloneStructure(session)
  const taken = collectMessageIds(session)
  for (let pivot = findSummaryPivot(repaired); pivot; pivot = findSummaryPivot(repaired)) {
    const forks = { ...(repaired.messageForksHash ?? {}) }
    const fork = forks[pivot.pivotId]
    delete forks[pivot.pivotId]
    const { messages, index } = pivot.location
    let target = index - 1
    while (target >= 0 && messages[target].isSummary) target -= 1
    let targetId: string
    if (target >= 0) {
      targetId = messages[target].id
    } else {
      targetId = deriveId(pivot.pivotId, 'anchor', taken)
      messages.unshift({ id: targetId, role: 'system', contentParts: [] })
    }
    // A fork without lists has no placeholder to keep, so the moved fork replaces it.
    const existing = forks[targetId]
    forks[targetId] = existing?.lists.length
      ? { ...existing, lists: [...existing.lists, ...fork.lists.filter((_, list) => list !== fork.position)] }
      : fork
    repaired = { ...repaired, messageForksHash: forks }
  }
  return repaired
}

/**
 * Rewrites V1 shapes that the row model cannot represent into equivalent ones
 * that keep every message a released client displays. Each repair is
 * deterministic, so repairing the same record always yields the same session.
 */
export function repairSessionV1(session: Session): Session {
  // Placeholders are emptied before ids are compared, so an inline message keeps its id over a copy the
  // placeholder held.
  return repairSummaryPivots(repairDuplicateMessageIds(repairForks(repairThreads(session))))
}
