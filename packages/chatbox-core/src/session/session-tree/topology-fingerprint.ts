import type { MessageRow, ThreadRow } from './types'

/** Stable noncryptographic identity for branch structure, independent of message contents. */
export function deriveSessionTopologyFingerprint(threads: ThreadRow[], messages: MessageRow[]): string {
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
