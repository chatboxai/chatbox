import type { Message, SessionHeader } from '@shared/types'
import type { MessageRowMetadata, SessionRecordV2, ThreadRow } from '../session/session-tree/types'
import { throwIfAborted } from './abort'
import { jsonUtf8Blocks } from './json-stream'
import { prepareBackupMessagePayload } from './resource-payload'
import {
  collectHeaderResourceReferences,
  collectMessageReferences,
  prepareMessageForBackup,
  type ResourceReference,
} from './resources'
import type { BackupRow } from './session-port'
import { BackupSourceBudgetError, MAX_BACKUP_SESSION_STRUCTURE_BYTES } from './source-check'
import type { BackupWarning } from './types'
import { BackupWarningIndex } from './warning-index'

const encoder = new TextEncoder()
export class SingleFileBudgetError extends BackupSourceBudgetError {}
type Part = string | { messageId: string }

/** A bounded index of row identities drives the external V2 JSON grammar. */
export class RowJsonLayout {
  private record?: SessionRecordV2
  private threads: ThreadRow[] = []
  private threadIds = new Set<string>()
  private rows = new Map<string, MessageRowMetadata>()
  private children = new Map<string, MessageRowMetadata[]>()
  private structureBytes = 0
  private reserve(value: unknown) {
    this.structureBytes += encoder.encode(JSON.stringify(value)).length
    if (this.structureBytes > MAX_BACKUP_SESSION_STRUCTURE_BYTES)
      throw new BackupSourceBudgetError('Backup session structure exceeds budget')
  }
  constructor(private readonly id: string) {}
  add(row: BackupRow) {
    if (row.kind === 'header') {
      if (this.record || row.record.id !== this.id) throw new Error('Invalid backup session header')
      this.record = row.record
      this.reserve(row.record)
    } else if (row.kind === 'thread') {
      if (row.thread.sessionId !== this.id || this.threadIds.has(row.thread.threadId))
        throw new Error('Invalid backup thread identity')
      this.threadIds.add(row.thread.threadId)
      this.threads.push(row.thread)
      this.reserve(row.thread)
    } else {
      const { message: _message, ...metadata } = row.message
      if (metadata.sessionId !== this.id || this.rows.has(metadata.messageId))
        throw new Error('Invalid backup message identity')
      this.reserve(metadata)
      this.rows.set(metadata.messageId, metadata)
      if (metadata.parentMessageId !== null) {
        const children = this.children.get(metadata.parentMessageId) ?? []
        children.push(metadata)
        this.children.set(metadata.parentMessageId, children)
      }
    }
  }
  get header(): SessionHeader {
    if (!this.record) throw new Error('Backup session header is missing')
    const {
      activeThreadId: _active,
      storageFormat: _storage,
      rowAuthority: _authority,
      rowFormatVersion: _format,
      forkCreatedAt: _forks,
      presentation: _presentation,
      contextReadProjection: _context,
      topologyFingerprint: _fingerprint,
      ...header
    } = this.record
    return header
  }
  get counts() {
    return { threads: this.threads.length, messages: this.rows.size }
  }
  *parts(): Generator<Part> {
    const active = this.threads.find((thread) => thread.threadId === this.record?.activeThreadId)
    if (!active || active.seq !== -1) throw new Error('Backup active thread is missing')
    for (const children of this.children.values())
      children.sort((a, b) => a.seq - b.seq || (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0))
    const consumed = new Set<string>()
    const chain = function* (
      this: RowJsonLayout,
      threadId: string,
      start: string | null,
      expectedLeaf?: string | null
    ): Generator<Part> {
      yield '['
      let cursor = start
      let last: string | null = null
      if (expectedLeaf !== undefined && start !== null && this.rows.get(start)?.parentMessageId !== null)
        throw new Error('Backup thread root has a parent')
      let first = true
      while (cursor !== null) {
        const row = this.rows.get(cursor)
        if (!row || row.threadId !== threadId || consumed.has(cursor)) throw new Error('Invalid backup message path')
        consumed.add(cursor)
        last = cursor
        if (!first) yield ','
        first = false
        yield { messageId: cursor }
        if (row.activeChildId !== null) {
          const child = this.rows.get(row.activeChildId)
          if (!child || child.parentMessageId !== cursor) throw new Error('Invalid backup selected child')
        }
        cursor = row.activeChildId
      }
      if (expectedLeaf !== undefined && last !== expectedLeaf)
        throw new Error('Backup thread leaf does not match its path')
      yield ']'
    }.bind(this)
    const headerJson = JSON.stringify(this.header)
    yield headerJson.slice(0, -1)
    yield ',"messages":'
    yield* chain(active.threadId, active.rootMessageId, active.activeLeafMessageId)
    const archived = this.threads.filter((thread) => thread !== active).sort((a, b) => a.seq - b.seq)
    if (archived.length) {
      yield ',"threads":['
      for (const [index, thread] of archived.entries()) {
        if (thread.name === null) throw new Error('Backup archived thread has no name')
        if (index) yield ','
        yield JSON.stringify({ id: thread.threadId, name: thread.name }).slice(0, -1)
        yield ',"messages":'
        yield* chain(thread.threadId, thread.rootMessageId, thread.activeLeafMessageId)
        yield `,"createdAt":${JSON.stringify(thread.createdAt)}`
        if (thread.compactionPoints.length) yield `,"compactionPoints":${JSON.stringify(thread.compactionPoints)}`
        if (thread.sessionPromptContextSnapshot !== undefined)
          yield `,"sessionPromptContextSnapshot":${JSON.stringify(thread.sessionPromptContextSnapshot)}`
        yield '}'
      }
      yield ']'
    }
    if (active.name !== null) yield `,"threadName":${JSON.stringify(active.name)}`
    if (active.compactionPoints.length) yield `,"compactionPoints":${JSON.stringify(active.compactionPoints)}`
    if (active.sessionPromptContextSnapshot !== undefined)
      yield `,"sessionPromptContextSnapshot":${JSON.stringify(active.sessionPromptContextSnapshot)}`
    const pivots = new Set<string>()
    for (const row of this.rows.values()) {
      const children = this.children.get(row.messageId) ?? []
      if (
        !row.forkPivotId &&
        row.pendingBranchId === undefined &&
        (!children.length || (children.length === 1 && row.activeChildId === children[0].messageId))
      )
        continue
      let pivot = row
      const ancestors = new Set<string>()
      while (pivot.kind === 'summary') {
        if (ancestors.has(pivot.messageId)) throw new Error('Backup summary path contains a cycle')
        ancestors.add(pivot.messageId)
        const parent = pivot.parentMessageId === null ? undefined : this.rows.get(pivot.parentMessageId)
        if (!parent || parent.threadId !== row.threadId) throw new Error('Backup branch pivot is missing')
        pivot = parent
      }
      if (pivots.has(pivot.messageId)) throw new Error('Duplicate backup branch pivot')
      yield pivots.size ? ',' : ',"messageForksHash":{'
      pivots.add(pivot.messageId)
      let position = children.findIndex((child) => child.messageId === row.activeChildId)
      if (row.activeChildId === null) {
        position =
          row.pendingBranchSeq === undefined ? -1 : children.findIndex((child) => child.seq > row.pendingBranchSeq!)
        if (position < 0) position = children.length
      } else if (position < 0) throw new Error('Backup selected branch is missing')
      yield `${JSON.stringify(pivot.messageId)}:{"position":${position},"lists":[`
      const count = children.length + Number(row.activeChildId === null)
      for (let index = 0; index < count; index++) {
        if (index) yield ','
        if (row.activeChildId === null && index === position) {
          yield `${JSON.stringify({ id: row.pendingBranchId ?? `fork_list_empty_${pivot.messageId}`, messages: [] })}`
          continue
        }
        const child = children[index - Number(row.activeChildId === null && index > position)]
        yield `{"id":${JSON.stringify(child.branchId ?? `fork_list_${child.messageId}`)},"messages":`
        if (child.messageId === row.activeChildId) yield '[]'
        else yield* chain(row.threadId, child.messageId)
        yield '}'
      }
      let createdAt = Infinity
      for (const child of children) createdAt = Math.min(createdAt, child.createdAt)
      yield `],"createdAt":${JSON.stringify(pivot.forkCreatedAt ?? this.record?.forkCreatedAt?.[pivot.messageId] ?? (Number.isFinite(createdAt) ? createdAt : pivot.createdAt))}}`
    }
    if (pivots.size) yield '}'
    if (consumed.size !== this.rows.size) throw new Error('Backup contains unreachable message rows')
    yield '}'
  }
}

export interface EncodedRowJson {
  header: SessionHeader
  size: number
  bytes?: Uint8Array
  references: ResourceReference[]
  warnings: BackupWarning[]
  counts: { threads: number; messages: number }
}

/** Encodes row payloads into external JSON bytes; no complete message graph is materialized. */
export async function encodeRowJson(
  rows: AsyncIterable<BackupRow>,
  id: string,
  limit: number,
  retain: boolean,
  signal?: AbortSignal
): Promise<EncodedRowJson> {
  const layout = new RowJsonLayout(id)
  const payloads = new Map<string, { size: number; chunks: Uint8Array[] }>()
  const references: ResourceReference[] = []
  const warnings = new BackupWarningIndex()
  let payloadBytes = 0
  const collect = (message: Message) => {
    const found: BackupWarning[] = []
    collectMessageReferences(message, id, references, found)
    warnings.addAll(found)
  }
  for await (const row of rows) {
    throwIfAborted(signal)
    layout.add(row)
    if (row.kind !== 'message') continue
    const chunks: Uint8Array[] = []
    let size = 0
    const inline = row.payload?.value ?? (!row.payload ? row.message.message : undefined)
    const raw = inline
      ? (async function* () {
          yield* jsonUtf8Blocks(prepareMessageForBackup(inline))
        })()
      : row.payload?.chunks?.()
    if (!raw) throw new Error('Backup payload source is missing')
    const prepared = inline
      ? raw
      : prepareBackupMessagePayload(raw, undefined, { validateInput: !row.payload?.original })
    for await (const block of prepared) {
      throwIfAborted(signal)
      size += block.length
      payloadBytes += block.length
      if (payloadBytes > limit) throw new SingleFileBudgetError('Prepared session exceeded its single-file budget')
      if (retain) chunks.push(block)
    }
    collect(row.payload?.original?.() ?? row.payload?.value ?? row.message.message)
    payloads.set(row.message.messageId, { size, chunks })
  }
  references.push(...collectHeaderResourceReferences(layout.header))
  const output: Uint8Array[] = []
  let size = 0
  for (const part of layout.parts()) {
    const body = typeof part === 'string' ? undefined : payloads.get(part.messageId)
    if (typeof part !== 'string' && !body) throw new Error('Backup message payload is missing')
    const bytes = typeof part === 'string' ? encoder.encode(part) : undefined
    size += bytes?.length ?? body!.size
    if (size > limit) throw new SingleFileBudgetError('Prepared session exceeded its single-file budget')
    if (retain) for (const block of bytes ? [bytes] : body!.chunks) output.push(block)
  }
  let bytes: Uint8Array | undefined
  if (retain) {
    bytes = new Uint8Array(size)
    let offset = 0
    for (const block of output) {
      bytes.set(block, offset)
      offset += block.length
    }
  }
  return { header: layout.header, size, bytes, references, warnings: warnings.toArray(), counts: layout.counts }
}
