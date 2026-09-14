import { CompactionPointSchema, MessageSchema, SessionSchema, SessionThreadSchema } from '@shared/types'
import { z } from 'zod'
import type { BackupRow } from './session-port'
import { BackupJsonEntrySchema, BackupManifestSchema, BackupSessionEntrySchema } from './types'

const id = z.string().min(1).max(1024)
const nullableId = id.nullable()
const order = z.number().int().safe()
export const BackupPayloadReferenceSchema = z.object({
  encoding: z.enum(['json-utf8', 'utf8', 'binary']),
  size: z.number().int().nonnegative().safe(),
  blocks: z.array(BackupJsonEntrySchema.extend({ index: z.number().int().nonnegative() })).max(100_000),
})

export function compareBackupIds(left: string, right: string): number {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

const logicalBackupRowSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('header'),
      session: SessionSchema.omit({
        messages: true,
        threads: true,
        threadName: true,
        messageForksHash: true,
        compactionPoints: true,
      })
        .passthrough()
        .refine(
          (session) =>
            ![
              'messages',
              'threads',
              'threadName',
              'messageForksHash',
              'compactionPoints',
              'storageFormat',
              'activeThreadId',
              'forkCreatedAt',
              'presentation',
              'contextReadProjection',
              'topologyFingerprint',
            ].some((key) => Object.hasOwn(session, key)),
          'Backup header contains storage-only fields'
        ),
      activeThreadId: id,
      forkCreatedAt: z.record(id, z.number().finite()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('thread'),
      id,
      order: order.min(-1),
      name: z.string().nullable(),
      createdAt: z.number().finite(),
      rootMessageId: nullableId,
      selectedLeafId: nullableId,
      compactionPoints: z.array(CompactionPointSchema),
      sessionPromptContextSnapshot: SessionThreadSchema.shape.sessionPromptContextSnapshot,
    })
    .strict(),
  z
    .object({
      kind: z.literal('message'),
      id,
      threadId: id,
      order: order.nonnegative(),
      parentId: nullableId,
      selectedChildId: nullableId,
      branchId: nullableId,
      role: z.enum(['message', 'summary']),
      state: z.enum(['generating', 'settled']),
      createdAt: z.number().finite(),
      updatedAt: z.number().finite(),
      value: MessageSchema.passthrough(),
      payload: z
        .object({
          encoding: z.literal('json-utf8'),
          size: order.positive(),
          firstBlock: order.nonnegative(),
          blockCount: order.positive(),
        })
        .optional(),
    })
    .strict(),
])
export type LogicalBackupRow = z.infer<typeof logicalBackupRowSchema>
export const LogicalBackupRowSchema = z.custom<LogicalBackupRow>(
  (value) => logicalBackupRowSchema.safeParse(value).success
)

export const ShardedSessionSchema = BackupSessionEntrySchema.extend({
  layout: z.enum(['single', 'sharded']),
  payloads: z.array(BackupJsonEntrySchema).max(100_000).default([]),
  shards: z
    .array(
      BackupJsonEntrySchema.extend({
        kind: z.enum(['thread', 'message']),
        index: order.nonnegative(),
        count: order.positive(),
      })
    )
    .max(100_000),
  counts: z.object({ threads: order.positive(), messages: order.nonnegative() }),
})
export const BackupManifestV3Schema = BackupManifestSchema.extend({
  formatVersion: z.literal(3),
  sessions: z.array(ShardedSessionSchema).max(50_000),
})
export type BackupManifestV3 = z.infer<typeof BackupManifestV3Schema>

export function toLogicalBackupRow(row: BackupRow): LogicalBackupRow {
  if (row.kind === 'header') {
    const {
      storageFormat,
      activeThreadId,
      forkCreatedAt,
      presentation,
      contextReadProjection,
      topologyFingerprint,
      ...session
    } = row.record
    return { kind: 'header', session, activeThreadId, forkCreatedAt }
  }
  if (row.kind === 'thread') {
    const t = row.thread
    return {
      kind: 'thread',
      id: t.threadId,
      order: t.seq,
      name: t.name,
      createdAt: t.createdAt,
      rootMessageId: t.rootMessageId,
      selectedLeafId: t.activeLeafMessageId,
      compactionPoints: t.compactionPoints,
      sessionPromptContextSnapshot: t.sessionPromptContextSnapshot,
    }
  }
  const m = row.message
  return {
    kind: 'message',
    id: m.messageId,
    threadId: m.threadId,
    order: m.seq,
    parentId: m.parentMessageId,
    selectedChildId: m.activeChildId,
    branchId: m.branchId,
    role: m.kind,
    state: m.status,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    value: m.message,
  }
}

export function fromLogicalBackupRow(row: LogicalBackupRow, sessionId: string): BackupRow {
  if (row.kind === 'header')
    return {
      kind: 'header',
      record: {
        ...row.session,
        storageFormat: 'rows',
        activeThreadId: row.activeThreadId,
        forkCreatedAt: row.forkCreatedAt,
      },
    }
  if (row.kind === 'thread')
    return {
      kind: 'thread',
      thread: {
        sessionId,
        threadId: row.id,
        seq: row.order,
        name: row.name,
        createdAt: row.createdAt,
        rootMessageId: row.rootMessageId,
        activeLeafMessageId: row.selectedLeafId,
        compactionPoints: row.compactionPoints,
        sessionPromptContextSnapshot: row.sessionPromptContextSnapshot,
      },
    }
  return {
    kind: 'message',
    payload: row.payload ? { size: row.payload.size } : undefined,
    message: {
      sessionId,
      threadId: row.threadId,
      messageId: row.id,
      seq: row.order,
      parentMessageId: row.parentId,
      activeChildId: row.selectedChildId,
      branchId: row.branchId,
      kind: row.role,
      status: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      message: row.value,
    },
  }
}

/** Retains only topology, with an explicit cumulative budget; payloads leave after each batch. */
export class BackupGraphValidator {
  private header?: Extract<LogicalBackupRow, { kind: 'header' }>
  private threads = new Map<string, Extract<LogicalBackupRow, { kind: 'thread' }>>()
  private messages = new Map<string, Omit<Extract<LogicalBackupRow, { kind: 'message' }>, 'value' | 'payload'>>()
  private indexBytes = 0
  private lastMessage?: { threadId: string; order: number }
  private lastThread = -2
  constructor(
    private readonly sessionId: string,
    private readonly maxIndexBytes = 16 * 1024 * 1024
  ) {}
  add(row: LogicalBackupRow) {
    const index = row.kind === 'message' ? (({ value, payload, ...rest }) => rest)(row) : row
    this.indexBytes += new TextEncoder().encode(JSON.stringify(index)).length
    if (this.indexBytes > this.maxIndexBytes) throw new Error('Backup graph index exceeds budget')
    if (row.kind === 'header') {
      if (this.header || row.session.id !== this.sessionId) throw new Error('Invalid backup header identity')
      this.header = row
    } else if (row.kind === 'thread') {
      if (!this.header || this.lastMessage || row.order !== this.lastThread + 1 || this.threads.has(row.id))
        throw new Error('Invalid backup thread order')
      this.threads.set(row.id, row)
      this.lastThread = row.order
    } else {
      const last = this.lastMessage
      if (
        !this.threads.has(row.threadId) ||
        this.messages.has(row.id) ||
        row.value.id !== row.id ||
        (last &&
          (compareBackupIds(row.threadId, last.threadId) < 0 ||
            (row.threadId === last.threadId && row.order <= last.order)))
      )
        throw new Error('Invalid backup message identity or order')
      this.lastMessage = { threadId: row.threadId, order: row.order }
      const { value, payload, ...structural } = row
      this.messages.set(row.id, structural)
    }
  }
  finish() {
    const active = this.header && this.threads.get(this.header.activeThreadId)
    if (!active || active.order !== -1) throw new Error('Backup active thread is missing')
    for (const m of this.messages.values()) {
      if (m.parentId !== null) {
        const parent = this.messages.get(m.parentId)
        if (!parent || parent.threadId !== m.threadId || parent.order >= m.order)
          throw new Error('Invalid backup parent relation')
      } else if (this.threads.get(m.threadId)?.rootMessageId !== m.id) throw new Error('Invalid backup root relation')
      if (m.selectedChildId !== null) {
        const child = this.messages.get(m.selectedChildId)
        if (!child || child.parentId !== m.id || child.threadId !== m.threadId)
          throw new Error('Invalid backup selected child')
      }
    }
    const children = new Map<string, number>()
    for (const message of this.messages.values())
      if (message.parentId !== null) children.set(message.parentId, (children.get(message.parentId) ?? 0) + 1)
    const pivots = new Set<string>()
    for (const message of this.messages.values()) {
      const count = children.get(message.id) ?? 0
      if (!count || (count === 1 && message.selectedChildId !== null)) continue
      let pivot = message
      while (pivot.role === 'summary') {
        if (pivot.parentId === null) throw new Error('Backup summary branch has no message ancestor')
        pivot = this.messages.get(pivot.parentId)!
      }
      if (pivots.has(pivot.id)) throw new Error('Backup fork pivot is claimed twice')
      pivots.add(pivot.id)
    }
    for (const thread of this.threads.values()) {
      let cursor = thread.rootMessageId
      let leaf: string | null = null
      while (cursor !== null) {
        const message = this.messages.get(cursor)
        if (!message || message.threadId !== thread.id) throw new Error('Invalid backup selected path')
        leaf = cursor
        cursor = message.selectedChildId
      }
      if (leaf !== thread.selectedLeafId) throw new Error('Invalid backup selected leaf')
      for (const point of thread.compactionPoints) {
        const summary = this.messages.get(point.summaryMessageId)
        const boundary = this.messages.get(point.boundaryMessageId)
        if (
          !summary ||
          !boundary ||
          summary.threadId !== thread.id ||
          boundary.threadId !== thread.id ||
          summary.role !== 'summary'
        )
          throw new Error('Invalid backup compaction reference')
      }
    }
    return { threads: this.threads.size, messages: this.messages.size }
  }
}
