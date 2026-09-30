import type { MessageRowMetadata, ThreadRow } from './types'

/** Stable noncryptographic identity for branch structure, independent of message contents. */
export function deriveLegacySessionTopologyFingerprint(threads: ThreadRow[], messages: MessageRowMetadata[]): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  const add = (value: unknown) => {
    const text = JSON.stringify(value)
    for (let index = 0; index < text.length; index += 1) {
      first = Math.imul(first ^ text.charCodeAt(index), 0x01000193)
      second = Math.imul(second ^ text.charCodeAt(index), 0x85ebca6b)
    }
  }
  for (const thread of [...threads].sort((a, b) => a.seq - b.seq))
    add([thread.threadId, thread.seq, thread.rootMessageId, thread.activeLeafMessageId])
  for (const row of [...messages].sort((a, b) => a.threadId.localeCompare(b.threadId) || a.seq - b.seq)) {
    add([row.threadId, row.messageId, row.parentMessageId, row.activeChildId, row.kind, row.branchId])
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

interface TopologySummary {
  threads: number
  messages: number
  first: number
  second: number
}

function topologyItem(value: unknown): [number, number] {
  const text = JSON.stringify(value)
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < text.length; index += 1) {
    first = Math.imul(first ^ text.charCodeAt(index), 0x01000193)
    second = Math.imul(second ^ text.charCodeAt(index), 0x85ebca6b)
  }
  return [first >>> 0, second >>> 0]
}

function addTopologyRows(
  summary: TopologySummary,
  threads: readonly ThreadRow[],
  messages: readonly MessageRowMetadata[],
  sign: 1 | -1
): void {
  const add = (value: unknown) => {
    const [first, second] = topologyItem(value)
    summary.first = (summary.first + sign * first) >>> 0
    summary.second = (summary.second + sign * second) >>> 0
  }
  summary.threads += sign * threads.length
  summary.messages += sign * messages.length
  for (const thread of threads)
    add(['thread', thread.threadId, thread.seq, thread.rootMessageId, thread.activeLeafMessageId])
  for (const row of messages)
    add([
      'message',
      row.threadId,
      row.messageId,
      row.seq,
      row.parentMessageId,
      row.activeChildId,
      row.kind,
      row.branchId,
    ])
}

function encodeTopologySummary(summary: TopologySummary): string {
  return `v2:${summary.threads}:${summary.messages}:${summary.first.toString(16).padStart(8, '0')}:${summary.second.toString(16).padStart(8, '0')}`
}

/** Non-security topology identity. Counts and additive dual hashes support selected-row commits. */
export function deriveSessionTopologyFingerprint(
  threads: readonly ThreadRow[],
  messages: readonly MessageRowMetadata[]
): string {
  const summary: TopologySummary = { threads: 0, messages: 0, first: 0, second: 0 }
  addTopologyRows(summary, threads, messages, 1)
  return encodeTopologySummary(summary)
}

/** Null means the persisted identity requires a full write to establish this version. */
export function updateSessionTopologyFingerprint(
  fingerprint: string | undefined,
  before: { threads: readonly ThreadRow[]; messages: readonly MessageRowMetadata[] },
  after: { threads: readonly ThreadRow[]; messages: readonly MessageRowMetadata[] }
): string | null {
  const match = fingerprint?.match(/^v2:(\d+):(\d+):([0-9a-f]{8}):([0-9a-f]{8})$/)
  if (!match) return null
  const summary: TopologySummary = {
    threads: Number(match[1]),
    messages: Number(match[2]),
    first: Number.parseInt(match[3], 16),
    second: Number.parseInt(match[4], 16),
  }
  addTopologyRows(summary, before.threads, before.messages, -1)
  addTopologyRows(summary, after.threads, after.messages, 1)
  if (
    !Number.isSafeInteger(summary.threads) ||
    !Number.isSafeInteger(summary.messages) ||
    summary.threads < 0 ||
    summary.messages < 0
  )
    return null
  return encodeTopologySummary(summary)
}
