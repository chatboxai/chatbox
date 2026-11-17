import { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from '../../../session/message-facts'
import type {
  MessageRowMetadata,
  SessionMessageFacts,
  SessionRecordV2,
  ThreadRow,
  SessionRowRecord,
  SessionTree,
} from '../../../session/session-tree/types'
import { validateSessionTree } from '../../../session/session-tree/validate'
import type { Session } from '../../../types/session'

/** Reserve a deterministic identity distinct from every archived thread in external input. */
export function legacyActiveThreadId(session: Session): string {
  const archived = new Set(session.threads?.map((thread) => thread.id))
  let id = session.id
  for (let index = 1; archived.has(id); index++) id = `${session.id}:active:${index}`
  return id
}

/** Conversion-only input. No application read or write accepts a complete tree. */
export function convertLegacyTreeToRowFormat(
  tree: SessionTree,
  normalizedForks?: Session['messageForksHash']
): SessionTree & { session: SessionRowRecord } {
  const validation = validateSessionTree(tree)
  if (!validation.ok) throw new Error(validation.reason)
  const original = new Map(tree.messages.map((row) => [row.messageId, row.message]))
  const converted = convertRowMetadataToFormat(
    {
      session: tree.session,
      threads: tree.threads,
      messages: tree.messages.map(({ message, ...row }) => ({ ...row, facts: deriveMessageFacts(message) })),
    },
    normalizedForks
  )
  return {
    ...converted,
    messages: converted.messages.map((row) => ({ ...row, message: original.get(row.messageId)! })),
  }
}

export function convertRowMetadataToFormat(
  tree: {
    session: SessionRecordV2
    threads: ThreadRow[]
    messages: Array<MessageRowMetadata & { facts: SessionMessageFacts }>
  },
  normalizedForks?: Session['messageForksHash']
) {
  const validation = validateSessionTree({
    ...tree,
    messages: tree.messages.map((row) => ({
      ...row,
      message: {
        id: row.messageId,
        role: row.facts.role,
        contentParts: [],
        ...(row.kind === 'summary' ? { isSummary: true } : {}),
      },
    })),
  })
  if (!validation.ok) throw new Error(validation.reason)
  const messages = tree.messages.map((row) => ({
    ...row,
    selected: false,
    ...(tree.session.forkCreatedAt?.[row.messageId] !== undefined
      ? { forkCreatedAt: tree.session.forkCreatedAt[row.messageId] }
      : {}),
  }))
  const byId = new Map(messages.map((row) => [row.messageId, row]))
  const children = new Map<string, typeof messages>()
  const generatingByThread = new Map<string, number>()
  for (const row of messages) {
    if (row.status === 'generating' && row.facts.role === 'assistant') {
      generatingByThread.set(row.threadId, (generatingByThread.get(row.threadId) ?? 0) + 1)
    }
    if (row.parentMessageId === null) continue
    const siblings = children.get(row.parentMessageId) ?? []
    siblings.push(row)
    children.set(row.parentMessageId, siblings)
  }
  const threads = tree.threads.map((thread) => {
    let summary = emptyThreadSummary()
    let cursor = thread.rootMessageId
    while (cursor !== null) {
      const row = byId.get(cursor)
      if (!row) throw new Error(`Missing selected message ${cursor}`)
      row.selected = true
      summary = addSummaryRow(summary, row)
      cursor = row.activeChildId
    }
    return { ...thread, summary, control: { generatingAssistantCount: generatingByThread.get(thread.threadId) ?? 0 } }
  })
  for (const row of messages) {
    const siblings = children.get(row.messageId)
    if (row.activeChildId !== null || !siblings?.length) continue
    let pivot = row
    while (pivot.kind === 'summary' && pivot.parentMessageId !== null) {
      const parent = byId.get(pivot.parentMessageId)
      if (!parent) throw new Error(`Missing fork parent ${pivot.parentMessageId}`)
      pivot = parent
    }
    const fork = normalizedForks?.[pivot.messageId]
    row.pendingBranchId = fork?.lists[fork.position]?.id ?? row.pendingBranchId ?? `fork_list_empty_${pivot.messageId}`
    if (fork) {
      for (const child of siblings) {
        const position = fork.lists.findIndex((list) => list.id === child.branchId)
        if (position < 0) throw new Error(`Branch identity is missing for ${child.messageId}`)
        child.siblingOrder = position
      }
      row.pendingBranchOrder = fork.position
    } else {
      row.pendingBranchOrder ??= siblings.reduce((maximum, child) => Math.max(maximum, child.siblingOrder), -1) + 1
    }
  }
  for (const point of messages) {
    const branches = children.get(point.messageId) ?? []
    if (!branches.some((child) => child.branchId !== null) && !point.pendingBranchId) continue
    let pivot = point
    while (pivot.kind === 'summary' && pivot.parentMessageId !== null) {
      const parent = byId.get(pivot.parentMessageId)
      if (!parent) throw new Error(`Missing fork parent ${pivot.parentMessageId}`)
      pivot = parent
    }
    point.forkPivotId = pivot.messageId
    const selected = branches.find((child) => child.messageId === point.activeChildId)
    const selectedBranchId = selected?.branchId ?? point.pendingBranchId
    if (!selectedBranchId) throw new Error(`Missing selected branch identity for ${point.messageId}`)
    const ordered = branches.map((child) => ({
      id: child.branchId!,
      siblingOrder: child.siblingOrder,
      messageId: child.messageId,
    }))
    if (point.pendingBranchId)
      ordered.push({
        id: point.pendingBranchId,
        siblingOrder: point.pendingBranchOrder!,
        messageId: point.pendingBranchId,
      })
    ordered.sort(
      (a, b) => a.siblingOrder - b.siblingOrder || (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0)
    )
    pivot.fork = {
      pivotId: pivot.messageId,
      branchPointId: point.messageId,
      selectedBranchId,
      count: ordered.length,
      position: ordered.findIndex((branch) => branch.id === selectedBranchId),
    }
  }
  const {
    forkCreatedAt: _forkCreatedAt,
    contextReadProjection: _contextReadProjection,
    topologyFingerprint: _topologyFingerprint,
    presentation: _presentation,
    ...header
  } = tree.session
  return {
    session: { ...header, rowFormatVersion: 3 as const, rowAuthority: 1 as const },
    threads,
    messages,
  }
}
