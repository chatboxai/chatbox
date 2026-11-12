import { addSummaryRow, emptyThreadSummary } from '../../session/message-facts'
import type { MessageRow, MessageRowMetadata, ThreadRow } from '../../session/session-tree/types'
import type {
  SessionKnownMessageMetadata,
  SessionRowRelationsPort,
  SessionMessageRelationsCursor,
} from '../../ports/session-row-relations'
import { newMessageRow, readBranchPoint, type StructureCommandReader } from './session-structure-plan'

const COPY_RELATION_BUDGET = 16 * 1024 * 1024

/** Marker normalization stores only excluded identities and marker connections. */
export async function prepareSessionCopyShape(
  reader: StructureCommandReader,
  store: SessionRowRelationsPort,
  markerId: string,
  createdAt: number
) {
  if ((await reader.metadata([markerId])).length) throw new Error('Copy marker identity already exists')
  const markers = new Map<string, SessionKnownMessageMetadata>()
  const excluded = new Set<string>()
  const clearedPoints = new Set<string>()
  const neutralBranches = new Set<string>()
  let bytes = 0
  let removedGenerating = 0
  const reserve = (value: unknown) => {
    bytes += new TextEncoder().encode(JSON.stringify(value)).length
    if (bytes > COPY_RELATION_BUDGET) throw new Error('Copy relation index exceeds budget')
  }
  const exclude = (row: SessionKnownMessageMetadata) => {
    if (excluded.has(row.messageId)) return
    reserve(row.messageId)
    excluded.add(row.messageId)
    if (row.status === 'generating' && row.facts.role === 'assistant') removedGenerating += 1
  }
  const sourceThread = reader.activeThread
  let summary = emptyThreadSummary()
  let first: SessionKnownMessageMetadata | undefined
  let last: SessionKnownMessageMetadata | undefined
  let cursor: SessionMessageRelationsCursor | undefined
  if (sourceThread.rootMessageId)
    do {
      const page = await store.readMessageRelationsPage({
        sessionId: reader.record.id,
        threadId: sourceThread.threadId,
        selector: { kind: 'selected-path', messageId: sourceThread.rootMessageId },
        limit: 200,
        expectedRevision: reader.revision,
        cursor,
      })
      if (page?.status !== 'ready') throw new Error('Copy selected path is unavailable')
      for (const row of page.rows) {
        if (row.facts.isForkMarker) {
          reserve(row)
          markers.set(row.messageId, row)
          exclude(row)
        } else {
          first ??= row
          last = row
          summary = addSummaryRow(summary, row)
        }
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  for (const marker of markers.values()) {
    const point = await readBranchPoint(reader, marker)
    if (point.forkPivotId !== marker.messageId) continue
    clearedPoints.add(point.messageId)
    if (point.activeChildId) neutralBranches.add(point.activeChildId)
    let boundary: { siblingOrder: number; messageId: string } | undefined
    for (;;) {
      const children = await reader.relations(
        sourceThread.threadId,
        { kind: 'children', parentMessageId: point.messageId, boundary },
        200
      )
      for (const child of children) {
        if (child.messageId === point.activeChildId) continue
        let subtreeCursor: SessionMessageRelationsCursor | undefined
        do {
          const page = await store.readMessageRelationsPage({
            sessionId: reader.record.id,
            threadId: sourceThread.threadId,
            selector: { kind: 'subtree', rootMessageId: child.messageId },
            limit: 200,
            expectedRevision: reader.revision,
            cursor: subtreeCursor,
          })
          if (page?.status !== 'ready') throw new Error('Copy excluded branch is unavailable')
          for (const row of page.rows) exclude(row)
          subtreeCursor = page.nextCursor ?? undefined
        } while (subtreeCursor)
      }
      if (children.length < 200) break
      const tail = children.at(-1)!
      boundary = { siblingOrder: tail.siblingOrder, messageId: tail.messageId }
    }
  }
  const resolveChild = (id: string | null): string | null => {
    let current = id
    for (let count = 0; current && markers.has(current); count++) {
      if (count > markers.size) throw new Error('Cyclic copied marker path')
      current = markers.get(current)!.activeChildId
    }
    return current
  }
  let appendSeq = 0
  let appendBranch: string | null = null
  if (last) {
    const skipped = last.activeChildId ? markers.get(last.activeChildId) : undefined
    if (skipped) {
      appendSeq = skipped.siblingOrder
      appendBranch = skipped.branchId
    } else if (last.pendingBranchId && !clearedPoints.has(last.messageId)) {
      appendSeq = last.pendingBranchOrder!
      appendBranch = last.pendingBranchId
    }
  }
  const marker = newMessageRow(
    reader.record.id,
    sourceThread.threadId,
    {
      id: markerId,
      role: 'assistant',
      contentParts: [],
      isForkMarker: true,
      forkedFromSessionId: reader.record.id,
      timestamp: createdAt,
    },
    last?.messageId ?? null,
    appendSeq,
    appendBranch
  )
  marker.selected = true
  summary = addSummaryRow(summary, { ...marker, facts: marker.facts! })
  const thread: ThreadRow = {
    ...sourceThread,
    rootMessageId: first?.messageId ?? markerId,
    activeLeafMessageId: markerId,
    compactionPoints: sourceThread.compactionPoints.filter(
      (point) => !excluded.has(point.boundaryMessageId) && !excluded.has(point.summaryMessageId)
    ),
    summary,
    control: { generatingAssistantCount: (sourceThread.control?.generatingAssistantCount ?? 0) - removedGenerating },
  }
  const transform = (row: MessageRow): MessageRow | null => {
    if (row.threadId !== sourceThread.threadId) return row
    if (excluded.has(row.messageId)) return null
    let parent = row.parentMessageId
    let inherited: MessageRowMetadata | undefined
    while (parent && markers.has(parent)) {
      inherited = markers.get(parent)!
      parent = inherited.parentMessageId
    }
    return {
      ...row,
      parentMessageId: parent,
      activeChildId: row.messageId === last?.messageId ? markerId : resolveChild(row.activeChildId),
      ...(inherited ? { siblingOrder: inherited.siblingOrder, branchId: inherited.branchId } : {}),
      ...(neutralBranches.has(row.messageId) ? { branchId: null } : {}),
      ...(row.messageId === last?.messageId || clearedPoints.has(row.messageId)
        ? { pendingBranchId: undefined, pendingBranchOrder: undefined }
        : {}),
      ...(row.forkPivotId && excluded.has(row.forkPivotId) ? { forkPivotId: undefined } : {}),
      ...(row.fork && excluded.has(row.fork.pivotId) ? { fork: undefined } : {}),
    }
  }
  return { thread, marker, transform }
}
