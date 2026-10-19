import type { SessionRowCommit } from '../ports/session-row-store'
import type {
  SessionKnownMessageMetadata,
  SessionMessageMetadataRead,
  SessionMessageMetadataRequest,
  SessionMessageRelationsPage,
  SessionMessageRelationsRequest,
  SessionMessageRelationsSelector,
} from '../ports/session-row-relations'
import type { MessageRowMetadata } from '../session/session-tree/types'

export interface SessionRelationReader {
  /** Includes the start row; native readers bound traversal and transport to this page. */
  path(
    threadId: string,
    messageId: string,
    direction: 'ancestors' | 'selected-path',
    limit: number
  ): Promise<MessageRowMetadata[]>

  status(
    threadId: string,
    options: { afterId?: string; limit: number; status: 'generating' }
  ): Promise<MessageRowMetadata[]>
  selectedFacts(
    threadId: string,
    options: { afterDepth?: number; limit: number; paused: true }
  ): Promise<Array<{ row: MessageRowMetadata; depth: number }>>
  message(id: string): Promise<MessageRowMetadata | null>
  children(
    threadId: string,
    selector: Extract<SessionMessageRelationsSelector, { kind: 'children' }>,
    limit: number
  ): Promise<MessageRowMetadata[]>
}

export function requireKnownMetadata(row: MessageRowMetadata): row is SessionKnownMessageMetadata {
  const required = [row.sessionId, row.threadId, row.messageId]
  const optional = [row.parentMessageId, row.activeChildId, row.branchId]
  if (
    required.some((id) => typeof id !== 'string' || id.length === 0) ||
    optional.some((id) => id !== null && (typeof id !== 'string' || id.length === 0)) ||
    !Number.isSafeInteger(row.seq) ||
    row.seq < 0 ||
    !Number.isFinite(row.createdAt) ||
    !Number.isFinite(row.updatedAt) ||
    !['message', 'summary'].includes(row.kind) ||
    !['settled', 'generating'].includes(row.status)
  )
    throw new Error('Invalid message relationship metadata')
  return row.facts !== undefined && typeof row.selected === 'boolean'
}

export async function readMetadataSelection(
  request: SessionMessageMetadataRequest,
  commit: SessionRowCommit,
  reader: SessionRelationReader
): Promise<SessionMessageMetadataRead> {
  if (!request.sessionId || request.messageIds.length > 200 || request.messageIds.some((id) => !id))
    throw new Error('Metadata selection requires at most 200 message identities')
  const rows: SessionKnownMessageMetadata[] = []
  const missingMessageIds: string[] = []
  const unavailable: string[] = []
  for (const id of new Set(request.messageIds)) {
    const row = await reader.message(id)
    if (!row) missingMessageIds.push(id)
    else if (!requireKnownMetadata(row)) unavailable.push(id)
    else rows.push(row)
  }
  return unavailable.length
    ? { ...commit, status: 'projection-unavailable', messageIds: unavailable, threadIds: [] }
    : { ...commit, status: 'ready', rows, missingMessageIds }
}

interface Position {
  id: string
  phase: 'emit' | 'ascend'
  seq?: number
}
function selectorKey(selector: SessionMessageRelationsSelector): string {
  switch (selector.kind) {
    case 'children':
      return JSON.stringify([
        selector.kind,
        selector.parentMessageId,
        Boolean(selector.reverse),
        selector.boundary ?? null,
        selector.branchId ?? null,
      ])
    case 'selected-path':
      return JSON.stringify([selector.kind, selector.messageId, selector.includeStart !== false])
    case 'ancestors':
      return JSON.stringify([selector.kind, selector.messageId])
    case 'status':
      return JSON.stringify([selector.kind, selector.status])
    case 'selected-facts':
      return JSON.stringify([selector.kind, selector.paused])
    case 'subtree':
      return JSON.stringify([selector.kind, selector.rootMessageId])
  }
}

export async function readRelationsPage(
  request: SessionMessageRelationsRequest,
  commit: SessionRowCommit,
  reader: SessionRelationReader
): Promise<SessionMessageRelationsPage> {
  const { selector, cursor, limit } = request
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !request.sessionId || !request.threadId)
    throw new Error('Invalid relation page request')
  const key = selectorKey(selector)
  if (
    cursor &&
    (cursor.sessionId !== request.sessionId ||
      cursor.threadId !== request.threadId ||
      cursor.revision !== commit.revision ||
      cursor.selectorKey !== key ||
      cursor.limit !== limit)
  )
    throw new Error('Relation cursor does not match its request')
  const previous: Position | null = cursor ? JSON.parse(cursor.position) : null
  if (previous && (!previous.id || (previous.phase !== 'emit' && previous.phase !== 'ascend')))
    throw new Error('Invalid relation position')
  const rows: SessionKnownMessageMetadata[] = []
  let next: Position | null = null
  const seen = new Set<string>()
  const checked = async (id: string) => {
    const row = await reader.message(id)
    if (row && (row.sessionId !== request.sessionId || row.threadId !== request.threadId))
      throw new Error('Relation crosses a thread boundary')
    return row
  }
  if (selector.kind === 'ancestors' || selector.kind === 'selected-path') {
    const startId = previous?.id ?? selector.messageId
    const found = await reader.path(request.threadId, startId, selector.kind, limit + 1)
    if (!found.length) return { ...commit, status: 'target-missing', messageId: startId }
    const nextId = (row: MessageRowMetadata) =>
      selector.kind === 'ancestors' ? row.parentMessageId : row.activeChildId
    if (found.length > limit + 1 || found[0].messageId !== startId) throw new Error('Invalid relation path page')
    for (let index = 0; index < found.length; index++) {
      const row = found[index]
      if (row.sessionId !== request.sessionId || row.threadId !== request.threadId)
        throw new Error('Relation crosses a thread boundary')
      if (seen.has(row.messageId) || nextId(row) === row.messageId) throw new Error('Cyclic message relationship')
      seen.add(row.messageId)
      if (index > 0 && nextId(found[index - 1]) !== row.messageId) throw new Error('Broken message relationship')
      if (selector.kind === 'selected-path' && index > 0 && row.parentMessageId !== found[index - 1].messageId)
        throw new Error('Broken selected message relationship')
      if (!requireKnownMetadata(row))
        return { ...commit, status: 'projection-unavailable', messageIds: [row.messageId], threadIds: [] }
    }
    const last = found.at(-1)!
    if (found.length < limit + 1 && nextId(last) !== null) throw new Error('Missing message relationship')
    const skip = !cursor && selector.kind === 'selected-path' && selector.includeStart === false ? 1 : 0
    for (const row of found.slice(skip, skip + limit)) {
      if (requireKnownMetadata(row)) rows.push(row)
    }
    const continuation = nextId(rows.at(-1) ?? last)
    if (continuation) next = { id: continuation, phase: 'emit' }
  } else if (selector.kind === 'status') {
    if (selector.status !== 'generating' || (previous && previous.phase !== 'emit'))
      throw new Error('Invalid message status page')
    const found = await reader.status(request.threadId, {
      afterId: previous?.id,
      limit: limit + 1,
      status: selector.status,
    })
    if (found.length > limit + 1) throw new Error('Message status page exceeds its limit')
    for (const row of found.slice(0, limit)) {
      if (
        row.sessionId !== request.sessionId ||
        row.threadId !== request.threadId ||
        row.status !== selector.status ||
        row.messageId === previous?.id ||
        seen.has(row.messageId)
      )
        throw new Error('Invalid message status result')
      seen.add(row.messageId)
      if (!requireKnownMetadata(row))
        return { ...commit, status: 'projection-unavailable', messageIds: [row.messageId], threadIds: [] }
      rows.push(row)
    }
    if (found.length > limit) next = { id: rows.at(-1)!.messageId, phase: 'emit' }
  } else if (selector.kind === 'selected-facts') {
    if (previous && (!Number.isSafeInteger(previous.seq) || previous.seq! < 0))
      throw new Error('Invalid selected facts cursor')
    const found = await reader.selectedFacts(request.threadId, {
      afterDepth: previous?.seq,
      limit: limit + 1,
      paused: true,
    })
    for (const { row } of found.slice(0, limit)) {
      if (!requireKnownMetadata(row))
        return { ...commit, status: 'projection-unavailable', messageIds: [row.messageId], threadIds: [] }
      rows.push(row)
    }
    if (found.length > limit) next = { id: rows.at(-1)!.messageId, phase: 'emit', seq: found[limit - 1].depth }
  } else if (selector.kind === 'children') {
    const found = await reader.children(
      request.threadId,
      { ...selector, ...(previous ? { boundary: { seq: previous.seq!, messageId: previous.id } } : {}) },
      limit + 1
    )
    for (const row of found.slice(0, limit)) {
      if (!requireKnownMetadata(row))
        return { ...commit, status: 'projection-unavailable', messageIds: [row.messageId], threadIds: [] }
      rows.push(row)
    }
    if (found.length > limit) next = { id: rows.at(-1)!.messageId, phase: 'emit', seq: rows.at(-1)!.seq }
  } else {
    let position: Position | null = previous ?? {
      id: selector.rootMessageId,
      phase: 'emit',
    }
    // A page bounds relationship work as well as output rows, including deep subtree backtracking.
    for (let budget = 0; position && budget < 200 && rows.length < limit; budget++) {
      const row = await checked(position.id)
      if (!row) return { ...commit, status: 'target-missing', messageId: position.id }
      if (!requireKnownMetadata(row))
        return { ...commit, status: 'projection-unavailable', messageIds: [row.messageId], threadIds: [] }
      const visit = `${position.phase}:${row.messageId}`
      if (seen.has(visit)) throw new Error('Cyclic message relationship')
      seen.add(visit)
      if (position.phase === 'emit') {
        rows.push(row)
        const [child] = await reader.children(request.threadId, { kind: 'children', parentMessageId: row.messageId }, 1)
        position = child ? { id: child.messageId, phase: 'emit' } : { id: row.messageId, phase: 'ascend' }
      } else if (row.messageId === selector.rootMessageId) position = null
      else {
        if (row.parentMessageId === null) throw new Error('Subtree escaped its root')
        const [sibling] = await reader.children(
          request.threadId,
          {
            kind: 'children',
            parentMessageId: row.parentMessageId,
            boundary: { seq: row.seq, messageId: row.messageId },
          },
          1
        )
        position = sibling ? { id: sibling.messageId, phase: 'emit' } : { id: row.parentMessageId, phase: 'ascend' }
      }
    }
    next = position
  }
  return {
    ...commit,
    status: 'ready',
    rows,
    nextCursor: next
      ? {
          sessionId: request.sessionId,
          threadId: request.threadId,
          revision: commit.revision,
          selectorKey: key,
          limit,
          position: JSON.stringify(next),
        }
      : null,
  }
}
