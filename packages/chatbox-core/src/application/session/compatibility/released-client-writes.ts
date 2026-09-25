import type { SessionRecordV2 } from '../../../session/session-tree'
import type { Message, Session, SessionThread } from '../../../types/session'

/**
 * Content fields a row marker never carries (see `SessionRecordV2`). A released
 * client that predates row storage reads a marker as a session without
 * messages and writes the whole object back, so any of these fields on a marker
 * is content that client produced.
 */
const RELEASED_CLIENT_CONTENT_KEYS = ['messages', 'threads', 'threadName', 'messageForksHash', 'compactionPoints']

export function hasReleasedClientContent(record: SessionRecordV2): boolean {
  return RELEASED_CLIENT_CONTENT_KEYS.some((key) => Object.hasOwn(record, key))
}

/** The session a released client saw and wrote back through a row marker. */
export function releasedClientSession(record: SessionRecordV2): Session {
  const written = record as SessionRecordV2 &
    Partial<Pick<Session, 'messages' | 'threads' | 'messageForksHash' | 'compactionPoints'>>
  return {
    ...record,
    messages: written.messages ?? [],
    threads: written.threads,
    messageForksHash: written.messageForksHash,
    compactionPoints: written.compactionPoints,
  }
}

function collectMessageIds(session: Session): Set<string> {
  const ids = new Set<string>()
  const add = (messages: Message[] | undefined) => {
    for (const message of messages ?? []) ids.add(message.id)
  }
  add(session.messages)
  for (const thread of session.threads ?? []) add(thread.messages)
  for (const fork of Object.values(session.messageForksHash ?? {})) {
    for (const list of fork.lists) add(list.messages)
  }
  return ids
}

/**
 * Adds what a released client wrote into a row marker to the row-backed
 * session: its messages continue the current thread and its topics are kept as
 * history, keeping the compaction points whose summaries it wrote. Row content
 * and session fields stay authoritative; only messages and topics the rows do
 * not already hold are added, so repeating the merge is a no-op. Returns null
 * when the released client added nothing.
 */
export function mergeReleasedClientContent(current: Session, written: Session): Session | null {
  const known = collectMessageIds(current)
  const knownThreadIds = new Set((current.threads ?? []).map((thread) => thread.id))

  const messages = (written.messages ?? []).filter((message) => !known.has(message.id))
  const threads: SessionThread[] = []
  for (const thread of written.threads ?? []) {
    if (knownThreadIds.has(thread.id)) continue
    const threadMessages = thread.messages.filter((message) => !known.has(message.id))
    if (threadMessages.length > 0) threads.push({ ...thread, messages: threadMessages })
  }
  if (messages.length === 0 && threads.length === 0) return null

  const added = new Set([...messages, ...threads.flatMap((thread) => thread.messages)].map((message) => message.id))
  const forks: NonNullable<Session['messageForksHash']> = {}
  // A retained branch can itself contain pivots for further saved branches.
  for (const pivotId of added) {
    const fork = written.messageForksHash?.[pivotId]
    if (!fork || current.messageForksHash?.[pivotId]) continue
    forks[pivotId] = fork
    for (const list of fork.lists) {
      for (const message of list.messages) added.add(message.id)
    }
  }

  const knownSummaryIds = new Set((current.compactionPoints ?? []).map((point) => point.summaryMessageId))
  const compactionPoints = (written.compactionPoints ?? []).filter(
    (point) => added.has(point.summaryMessageId) && !knownSummaryIds.has(point.summaryMessageId)
  )

  return {
    ...current,
    messages: [...current.messages, ...messages],
    compactionPoints:
      compactionPoints.length > 0
        ? [...(current.compactionPoints ?? []), ...compactionPoints]
        : current.compactionPoints,
    threads: threads.length > 0 ? [...(current.threads ?? []), ...threads] : current.threads,
    messageForksHash:
      Object.keys(forks).length > 0 ? { ...current.messageForksHash, ...forks } : current.messageForksHash,
  }
}
