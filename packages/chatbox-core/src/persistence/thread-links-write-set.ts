import type { Message } from '../types/session'
import type { SessionRowCommit, SessionRowsDiff } from '../ports/session-row-store'
import type { MessageRowMetadata, ThreadRow } from '../session/session-tree/types'
import { ThreadLinks, compareSiblingOrder, type ThreadLink } from '../session/thread-links'
import { applyThreadLinksMutation, type LocalRowMutationAccess } from './thread-links-mutation'

export interface ThreadLinksSource {
  yieldTask?(): Promise<void>
  thread(id: string): Promise<ThreadRow | null>
  message(id: string): Promise<ThreadLink | null>
  loadThreadLinks(threadId: string): Promise<ThreadLinks>
  threadIds(): Promise<string[]>
}

/** An operation owns every working copy. No committed cache entry is mutated during planning. */
export async function prepareThreadLinksWriteSet(
  source: ThreadLinksSource,
  diff: SessionRowsDiff,
  commit: SessionRowCommit
) {
  const oldGraphs = new Map<string, ThreadLinks>()
  const working = new Map<string, Map<string, ThreadLink>>()
  const identities = new Map<string, string>([
    ...diff.messages.upsert.map((row) => [row.messageId, row.threadId] as const),
    ...(diff.messageMetadataUpsert ?? []).map((row) => [row.messageId, row.threadId] as const),
  ])
  const finalGraphs = new Map<string, ThreadLinks>()
  const metadata = new Map<string, ThreadLink>()
  const bodies = new Map<string, Message>()
  const deleted = new Set<string>()
  const threads = new Map<string, ThreadRow>()
  async function graph(threadId: string) {
    let old = oldGraphs.get(threadId)
    if (!old) {
      old = await source.loadThreadLinks(threadId)
      oldGraphs.set(threadId, old)
      working.set(threadId, new Map([...old.values()].map((row) => [row.messageId, row])))
      for (const row of old.values()) identities.set(row.messageId, threadId)
    }
    return old
  }
  async function find(id: string, old: boolean): Promise<ThreadLink | null> {
    let threadId = identities.get(id)
    if (threadId === undefined) {
      const found = await source.message(id)
      if (!found) return null
      threadId = found.threadId
      identities.set(id, threadId)
    }
    const previous = await graph(threadId)
    return old ? previous.get(id) : (working.get(threadId)!.get(id) ?? null)
  }
  const access: LocalRowMutationAccess = {
    yieldTask: source.yieldTask,
    oldMessage: (id) => find(id, true),
    message: (id) => find(id, false),
    oldThread: source.thread,
    oldLinks: graph,
    children: async (threadId, parentId, after, limit, old = false) => {
      const previous = await graph(threadId)
      if (old) return previous.childrenPage(parentId, after, limit)
      const children = [...working.get(threadId)!.values()]
        .filter((row) => row.parentMessageId === parentId)
        .sort(compareSiblingOrder)
      return children.filter((row) => !after || compareSiblingOrder(row, after) > 0).slice(0, limit)
    },
    links: async (threadId) => {
      const old = await graph(threadId)
      let current = finalGraphs.get(threadId)
      if (!current) {
        current = old.withChanges(
          [...metadata.values()].filter((row) => row.threadId === threadId),
          [...deleted].filter((id) => identities.get(id) === threadId)
        )
        finalGraphs.set(threadId, current)
      }
      return current
    },
    childStats: async (threadId, parentId, boundary) => {
      await graph(threadId)
      const children = [...working.get(threadId)!.values()].filter((row) => row.parentMessageId === parentId)
      return {
        count: children.length,
        before: boundary ? children.filter((row) => compareSiblingOrder(row, boundary) < 0).length : 0,
      }
    },
    put: async (row, body) => {
      await graph(row.threadId)
      const { selected: _selected, ...clean } = row as MessageRowMetadata & { facts: ThreadLink['facts'] }
      working.get(row.threadId)!.set(row.messageId, clean)
      identities.set(row.messageId, row.threadId)
      finalGraphs.delete(row.threadId)
      metadata.set(row.messageId, clean)
      deleted.delete(row.messageId)
      if (body) bodies.set(row.messageId, body)
    },
    remove: async (id) => {
      const row = await find(id, false)
      if (!row) return
      finalGraphs.delete(row.threadId)
      working.get(row.threadId)!.delete(id)
      metadata.delete(id)
      bodies.delete(id)
      deleted.add(id)
    },
    putThread: async (thread) => {
      threads.set(thread.threadId, thread)
    },
    clearMessages: async (threadId) => {
      for (const id of threadId === undefined ? await source.threadIds() : [threadId]) {
        await graph(id)
        for (const row of working.get(id)!.values()) {
          deleted.add(row.messageId)
          metadata.delete(row.messageId)
          bodies.delete(row.messageId)
        }
        finalGraphs.delete(id)
        working.get(id)!.clear()
      }
    },
  }
  const result = await applyThreadLinksMutation(access, diff, commit)
  const graphs = new Map<string, ThreadLinks | null>()
  for (const id of working.keys()) graphs.set(id, await access.links(id))
  for (const id of diff.threads.delete) graphs.set(id, null)
  if (diff.deleteArchivedThreads)
    for (const id of await source.threadIds()) if (id !== commit.record.activeThreadId) graphs.set(id, null)
  return { result, metadata, bodies, deleted, threads, graphs }
}
