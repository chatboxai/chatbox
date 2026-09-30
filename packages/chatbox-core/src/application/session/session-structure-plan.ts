import { deriveSessionRecord } from '../../session/session-tree/encode'
import type { MessageRow, MessageRowMetadata, SessionRecordV2, ThreadRow } from '../../session/session-tree/types'
import type { SessionStructureSnapshot } from '../../ports/session-row-store'
import type { SessionStructureResult } from '../../ports/session-structure-command'
import type { Message } from '../../types'
import { contextRecordHeader } from './session-context-source'

export interface StructurePlan {
  record: SessionRecordV2
  threads: ThreadRow[]
  messages: MessageRowMetadata[]
  upsertMessages: MessageRow[]
  result: SessionStructureResult
}

export function structureActivePath(
  snapshot: Pick<SessionStructureSnapshot, 'record' | 'threads' | 'messages'>
): MessageRowMetadata[] {
  const thread = snapshot.threads.find((row) => row.threadId === snapshot.record.activeThreadId)
  if (!thread) throw new Error('Active thread is missing')
  const byId = new Map(snapshot.messages.map((row) => [row.messageId, row]))
  const path: MessageRowMetadata[] = []
  const visited = new Set<string>()
  let id = thread.rootMessageId
  while (id !== null) {
    const row = byId.get(id)
    if (!row || row.threadId !== thread.threadId || visited.has(id)) throw new Error('Invalid active thread path')
    visited.add(id)
    path.push(row)
    id = row.activeChildId
  }
  return path
}

export function projectStructurePresentation(
  record: SessionRecordV2,
  threads: ThreadRow[],
  messages: Message[]
): SessionRecordV2 {
  const derived = deriveSessionRecord({ ...contextRecordHeader(record), messages }, record.activeThreadId)
  return {
    ...record,
    presentation: {
      ...derived.presentation!,
      hasThreads: threads.some((thread) => thread.seq !== -1),
      hasForks: Object.keys(record.forkCreatedAt ?? {}).length > 0,
    },
  }
}

/** Reindex selected thread trees after links change, retaining their DFS sibling order. */
export function reindexStructureThreads(threads: readonly ThreadRow[], messages: MessageRowMetadata[]) {
  const byId = new Map(messages.map((row) => [row.messageId, row]))
  const children = new Map<string, MessageRowMetadata[]>()
  for (const row of messages) {
    if (!row.parentMessageId) continue
    const siblings = children.get(row.parentMessageId) ?? []
    siblings.push(row)
    children.set(row.parentMessageId, siblings)
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.seq - right.seq)
  const subtreeEnds = new Map<string, number>()
  const indexed = threads.map((thread) => {
    let seq = 0
    const stack: Array<{ id: string; closing: boolean }> = thread.rootMessageId
      ? [{ id: thread.rootMessageId, closing: false }]
      : []
    while (stack.length) {
      const entry = stack.pop()!
      if (entry.closing) {
        subtreeEnds.set(entry.id, seq)
        continue
      }
      byId.get(entry.id)!.seq = seq++
      stack.push({ id: entry.id, closing: true })
      for (const child of [...(children.get(entry.id) ?? [])].reverse())
        stack.push({ id: child.messageId, closing: false })
    }
    let leaf = thread.rootMessageId
    while (leaf && byId.get(leaf)?.activeChildId) leaf = byId.get(leaf)!.activeChildId
    return { ...thread, activeLeafMessageId: leaf }
  })
  return { threads: indexed, subtreeEnds }
}
