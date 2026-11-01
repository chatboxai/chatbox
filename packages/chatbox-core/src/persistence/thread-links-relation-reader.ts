import type { MessageRowMetadata, ThreadRow } from '../session/session-tree/types'
import { compareSiblingOrder, type ThreadLinks, type ThreadLink } from '../session/thread-links'
import type { SessionRelationReader } from './session-row-relations-read'

export interface ThreadLinksReadSource {
  message(id: string): Promise<ThreadLink | null>
  thread(id: string): Promise<ThreadRow | null>
  loadThreadLinks(id: string): Promise<ThreadLinks>
}

/** Each operation shares one graph and one active-path membership set per thread. */
export function threadLinksRelationReader(source: ThreadLinksReadSource): SessionRelationReader {
  const loaded = new Map<string, Promise<{ graph: ThreadLinks; root: string | null; selected: ReadonlySet<string> }>>()
  function thread(id: string) {
    let pending = loaded.get(id)
    if (!pending) {
      pending = Promise.all([source.loadThreadLinks(id), source.thread(id)]).then(([graph, state]) => {
        if (!state) throw new Error('Relation thread is missing')
        return { graph, root: state.rootMessageId, selected: graph.membership(state.rootMessageId) }
      })
      loaded.set(id, pending)
    }
    return pending
  }
  async function known(row: ThreadLink): Promise<MessageRowMetadata> {
    return structuredClone({ ...row, selected: (await thread(row.threadId)).selected.has(row.messageId) })
  }
  return {
    message: async (id) => {
      const row = await source.message(id)
      return row ? known(row) : null
    },
    path: async (threadId, messageId, direction, limit) => {
      if (!(await source.message(messageId))) return []
      const { graph } = await thread(threadId)
      const result: MessageRowMetadata[] = []
      const seen = new Set<string>()
      let id: string | null = messageId
      while (id !== null && result.length < limit) {
        if (seen.has(id)) throw new Error('Cyclic message relationship')
        seen.add(id)
        const row = graph.get(id)
        if (!row) {
          if (result.length) throw new Error('Missing message relationship')
          break
        }
        result.push(await known(row))
        id = direction === 'ancestors' ? row.parentMessageId : row.activeChildId
      }
      return result
    },
    children: async (threadId, selector, limit) => {
      const { graph } = await thread(threadId)
      return Promise.all(
        graph
          .childrenPage(selector.parentMessageId, selector.boundary, limit, selector.reverse, selector.branchId)
          .map(known)
      )
    },
    status: async (threadId, options) => {
      if (!(await source.thread(threadId))) return []
      const { graph } = await thread(threadId)
      const rows = [...graph.values()]
        .filter((row) => row.status === options.status && (!options.afterId || row.messageId > options.afterId))
        .sort((a, b) => (a.messageId < b.messageId ? -1 : Number(a.messageId > b.messageId)))
      return Promise.all(rows.slice(0, options.limit).map(known))
    },
    selectedFacts: async (threadId, options) => {
      const { graph, root } = await thread(threadId)
      const rows = graph
        .activePath(root)
        .map((row, depth) => ({ row, depth }))
        .filter(({ row, depth }) => depth > (options.afterDepth ?? -1) && row.facts.paused)
        .slice(0, options.limit)
      return Promise.all(rows.map(async ({ row, depth }) => ({ row: await known(row), depth })))
    },
  }
}
