import type { MessageRowMetadata, SessionMessageFacts, ThreadRow } from './session-tree/types'
import { addSummaryRow, emptyThreadSummary } from './message-facts'

export type ThreadLink = Omit<MessageRowMetadata, 'selected'> & { facts: SessionMessageFacts }

/** One thread's committed relations. Path membership is derived, never persisted here. */
export class ThreadLinks {
  private readonly paths = new Map<string | null, ThreadLink[]>()
  private readonly memberships = new Map<string | null, ReadonlySet<string>>()

  constructor(
    readonly threadId: string,
    private readonly byId: ReadonlyMap<string, ThreadLink>,
    private readonly byParent: ReadonlyMap<string | null, readonly ThreadLink[]>
  ) {}

  static from(threadId: string, links: Iterable<ThreadLink>): ThreadLinks {
    const builder = new ThreadLinksBuilder(threadId)
    builder.append(links)
    return builder.finish()
  }

  get size() {
    return this.byId.size
  }
  get(messageId: string) {
    return this.byId.get(messageId) ?? null
  }
  values() {
    return this.byId.values()
  }
  children(parentId: string | null): readonly ThreadLink[] {
    return this.byParent.get(parentId) ?? []
  }

  childrenPage(
    parentId: string | null,
    boundary: { siblingOrder: number; messageId: string } | undefined,
    limit: number,
    reverse = false,
    branchId?: string
  ): ThreadLink[] {
    const children = this.children(parentId)
    const position = boundary ? siblingBoundary(children, boundary, !reverse) : reverse ? children.length : 0
    const result: ThreadLink[] = []
    for (
      let i = reverse ? position - 1 : position;
      i >= 0 && i < children.length && result.length < limit;
      i += reverse ? -1 : 1
    ) {
      const row = children[i]
      if (branchId === undefined || row.branchId === branchId) result.push(row)
    }
    return result
  }

  activePath(rootId: string | null): ThreadLink[] {
    const cached = this.paths.get(rootId)
    if (cached) return cached
    const path: ThreadLink[] = []
    const seen = new Set<string>()
    let id = rootId
    let parent: string | null = null
    while (id !== null) {
      const row = this.get(id)
      if (!row || row.parentMessageId !== parent) throw new Error('Broken active thread path')
      if (seen.has(id)) throw new Error('Cyclic active thread path')
      seen.add(id)
      path.push(row)
      parent = id
      id = row.activeChildId
    }
    this.paths.set(rootId, path)
    this.memberships.set(rootId, new Set(path.map((row) => row.messageId)))
    return path
  }

  async preparePath(rootId: string | null, yieldTask: () => Promise<void>, batchSize = 2000): Promise<void> {
    const path: ThreadLink[] = []
    const seen = new Set<string>()
    let id = rootId,
      parent: string | null = null
    while (id !== null) {
      const row = this.get(id)
      if (!row || row.parentMessageId !== parent || seen.has(id)) throw new Error('Invalid active thread path')
      seen.add(id)
      path.push(row)
      parent = id
      id = row.activeChildId
      if (path.length % batchSize === 0) await yieldTask()
    }
    this.paths.set(rootId, path)
    this.memberships.set(rootId, seen)
  }

  membership(rootId: string | null): ReadonlySet<string> {
    if (!this.memberships.has(rootId)) this.activePath(rootId)
    return this.memberships.get(rootId)!
  }

  /** Ancestor membership avoids walking an unrelated selected suffix. */
  isOnPath(messageId: string, rootId: string | null): boolean {
    const cached = this.memberships.get(rootId)
    if (cached) return cached.has(messageId)
    let row = this.get(messageId)
    if (!row) return false
    const seen = new Set<string>()
    while (row.parentMessageId !== null) {
      if (seen.has(row.messageId)) throw new Error('Cyclic message ancestry')
      seen.add(row.messageId)
      const parent = this.get(row.parentMessageId)
      if (!parent) throw new Error('Missing message parent')
      if (parent.activeChildId !== row.messageId) return false
      row = parent
    }
    return row.messageId === rootId
  }

  async summarize(
    rootId: string | null,
    yieldTask: () => Promise<void> = async () => {},
    batchSize = 2000
  ): Promise<Pick<ThreadRow, 'summary' | 'control' | 'activeLeafMessageId'>> {
    await this.preparePath(rootId, yieldTask, batchSize)
    const path = this.paths.get(rootId)!
    let summary = emptyThreadSummary(),
      count = 0,
      generatingAssistantCount = 0
    for (const row of path) {
      summary = addSummaryRow(summary, row)
      if (++count % batchSize === 0) await yieldTask()
    }
    count = 0
    for (const row of this.values()) {
      generatingAssistantCount += Number(row.status === 'generating' && row.facts.role === 'assistant')
      if (++count % batchSize === 0) await yieldTask()
    }
    return { summary, control: { generatingAssistantCount }, activeLeafMessageId: path.at(-1)?.messageId ?? null }
  }

  withChanges(upsert: Iterable<ThreadLink>, deleted: Iterable<string> = []): ThreadLinks {
    const changes = [...upsert],
      removed = [...deleted]
    const next = new Map(this.byId)
    const parents = new Map(this.byParent)
    let structural = false,
      appendOnly = true
    const affected = new Set<string | null>(),
      updated = new Set(changes.map((row) => row.messageId)),
      deletedIds = new Set(removed)
    const added = new Map<string | null, ThreadLink[]>()
    for (const id of removed) {
      const row = next.get(id)
      if (row) {
        affected.add(row.parentMessageId)
        next.delete(id)
        structural = true
        appendOnly = false
      }
    }
    for (const row of changes) {
      const old = next.get(row.messageId)
      if (
        old &&
        (old.parentMessageId !== row.parentMessageId ||
          (old.activeChildId !== row.activeChildId && old.activeChildId !== null))
      )
        appendOnly = false
      if (!old || old.parentMessageId !== row.parentMessageId || old.activeChildId !== row.activeChildId)
        structural = true
      if (old) affected.add(old.parentMessageId)
      affected.add(row.parentMessageId)
      next.set(row.messageId, row)
      const group = added.get(row.parentMessageId) ?? []
      group.push(row)
      added.set(row.parentMessageId, group)
    }
    for (const parent of affected) {
      const siblings = [
        ...(this.byParent.get(parent) ?? []).filter(
          (row) => !updated.has(row.messageId) && !deletedIds.has(row.messageId)
        ),
        ...(added.get(parent) ?? []),
      ].sort(compareSiblingOrder)
      if (siblings.length) parents.set(parent, siblings)
      else parents.delete(parent)
    }
    const graph = new ThreadLinks(this.threadId, next, parents)
    if (!structural) for (const [root, ids] of this.memberships) graph.memberships.set(root, ids)
    else if (appendOnly)
      for (const [root, ids] of this.memberships) {
        let selected: ReadonlySet<string> = ids
        const additions: string[] = []
        let valid = true
        for (const row of changes) {
          const before = this.get(row.messageId)
          if (!before || before.activeChildId !== null || row.activeChildId === null || !ids.has(row.messageId))
            continue
          let id: string | null = row.activeChildId,
            parent = row.messageId
          const seen = new Set<string>()
          while (id !== null) {
            const child = next.get(id)
            if (!child || child.parentMessageId !== parent || this.get(id) || seen.has(id)) {
              valid = false
              break
            }
            seen.add(id)
            additions.push(id)
            parent = id
            id = child.activeChildId
          }
        }
        if (valid) {
          if (additions.length) {
            const updated = new Set(ids)
            for (const id of additions) updated.add(id)
            selected = updated
          }
          graph.memberships.set(root, selected)
        }
      }
    return graph
  }
}

export function compareSiblingOrder(
  left: { siblingOrder: number; messageId: string },
  right: { siblingOrder: number; messageId: string }
): number {
  return (
    left.siblingOrder - right.siblingOrder ||
    (left.messageId < right.messageId ? -1 : Number(left.messageId > right.messageId))
  )
}

/** Build immutable indexes per I/O batch; finish does no whole-thread copy or sort. */
export class ThreadLinksBuilder {
  private readonly byId = new Map<string, ThreadLink>()
  private readonly byParent = new Map<string | null, readonly ThreadLink[]>()
  constructor(private readonly threadId: string) {}
  append(rows: Iterable<ThreadLink>): void {
    const groups = new Map<string | null, ThreadLink[]>()
    for (const row of rows) {
      if (
        row.threadId !== this.threadId ||
        this.byId.has(row.messageId) ||
        !Number.isSafeInteger(row.siblingOrder) ||
        row.siblingOrder < 0
      )
        throw new Error('Invalid thread link')
      this.byId.set(row.messageId, row)
      const group = groups.get(row.parentMessageId) ?? []
      group.push(row)
      groups.set(row.parentMessageId, group)
    }
    for (const [parent, group] of groups)
      this.byParent.set(parent, [...(this.byParent.get(parent) ?? []), ...group].sort(compareSiblingOrder))
  }
  finish(): ThreadLinks {
    return new ThreadLinks(this.threadId, this.byId, this.byParent)
  }
}

function siblingBoundary(
  rows: readonly ThreadLink[],
  boundary: { siblingOrder: number; messageId: string },
  inclusive: boolean
): number {
  let low = 0,
    high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1,
      order = compareSiblingOrder(rows[middle], boundary)
    if (order < 0 || (inclusive && order === 0)) low = middle + 1
    else high = middle
  }
  return low
}
