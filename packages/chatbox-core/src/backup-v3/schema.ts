import {
  CompactionPointSchema,
  MessageSchema,
  SessionHeaderSchema,
  SessionSettingsSchema,
  SessionThreadSchema,
} from '@shared/types'
import type { MessageFile, MessageLink } from '@shared/types'
import { z } from 'zod'
import { MemoryToolContextSchema, SessionPromptContextSnapshotSchema } from '../types/agent-persona'
import { RESOURCE_PATH_PATTERN } from './layout'
import type { MessageRow, SessionRecordV2, ThreadRow } from '../session/session-tree/types'
import type {
  BackupBusinessRecord,
  BackupComplete,
  BackupCounts,
  BackupLimits,
  BackupManifest,
  BackupMessage,
  BackupRecord,
  BackupSession,
  BackupThread,
  BackupWarningRecord,
} from './types'

export const BACKUP_V3_LIMITS: BackupLimits = {
  maxRecordBytes: 16 * 1024 * 1024,
  maxResourceBytes: 512 * 1024 * 1024,
  maxDataBytes: 2 * 1024 * 1024 * 1024,
  maxGlobalBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 0xffff_fffe,
  maxUncompressedBytes: 3 * 1024 * 1024 * 1024,
  maxEntries: 65_534,
}
const id = z.string().min(1).max(4096)
const integer = z.number().int().safe().nonnegative()
const selection = z
  .object({ sessions: z.boolean(), settings: z.boolean(), copilots: z.boolean(), credentials: z.boolean() })
  .strict()
const manifestSchema = z
  .object({
    format: z.literal('chatbox-backup'),
    formatVersion: z.literal(3),
    layout: z.literal('rows'),
    archiveId: id,
    createdAt: z.iso.datetime(),
    producer: id,
    selection,
  })
  .strict()
const sessionSchema = SessionHeaderSchema.omit({ threadName: true }).extend({ id, activeThreadId: id }).passthrough()
const threadSchema = z
  .object({
    sessionId: id,
    threadId: id,
    seq: z.number().int().safe().min(-1),
    name: z.string().nullable(),
    createdAt: z.number().finite(),
    rootMessageId: id.nullable(),
    compactionPoints: z.array(CompactionPointSchema),
    sessionPromptContextSnapshot: SessionThreadSchema.shape.sessionPromptContextSnapshot,
  })
  .strict()
const messageSchema = z
  .object({
    sessionId: id,
    threadId: id,
    messageId: id,
    parentMessageId: id.nullable(),
    activeChildId: id.nullable(),
    seq: integer,
    kind: z.enum(['message', 'summary']),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
    branchId: id.nullable(),
    forkCreatedAt: z.number().finite().optional(),
    forkPivotId: id.optional(),
    pendingBranchId: id.optional(),
    pendingBranchSeq: integer.optional(),
    message: MessageSchema,
  })
  .strict()
const recordSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('session'),
      session: sessionSchema,
      meta: z.object({ sortOrder: z.number().finite(), createdAt: z.number().finite() }).strict().optional(),
    })
    .strict(),
  z.object({ type: z.literal('thread'), thread: threadSchema }).strict(),
  z.object({ type: z.literal('message'), message: messageSchema }).strict(),
  z
    .object({
      type: z.literal('global'),
      category: z.enum([
        'settings',
        'copilot',
        'session-settings',
        'folder',
        'soul',
        'global-memory',
        'copilot-memory',
        'memory-identities',
      ]),
      id,
      value: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal('resource'),
      resourceId: id,
      path: z.string().regex(RESOURCE_PATH_PATTERN),
      mimeType: z.string().min(1).max(1024),
      contentType: z.enum(['text', 'binary']),
      size: integer,
    })
    .strict(),
  z.object({ type: z.literal('warning'), category: id, objectId: id, message: z.string() }).strict(),
])
const countsSchema = z
  .object({ session: integer, thread: integer, message: integer, global: integer, resource: integer, warning: integer })
  .strict()
const completeSchema = z
  .object({
    archiveId: id,
    counts: countsSchema.optional(),
    resourceBytes: integer.optional(),
    dataBytes: integer.optional(),
    entryCount: integer.optional(),
    uncompressedBytes: integer.optional(),
  })
  .strict()

export function resolveBackupLimits(overrides: Partial<BackupLimits> = {}): BackupLimits {
  const limits = { ...BACKUP_V3_LIMITS, ...overrides }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid backup limit: ${key}`)
  }
  if (
    limits.maxEntries > 65_534 ||
    limits.maxArchiveBytes >= 0xffff_ffff ||
    limits.maxDataBytes >= 0xffff_ffff ||
    limits.maxResourceBytes >= 0xffff_ffff
  )
    throw new Error('V3 requires classic ZIP capacity limits')
  return limits
}
export function parseBackupManifest(value: unknown): BackupManifest {
  const parsed = manifestSchema.parse(value)
  if (parsed.selection.credentials && !parsed.selection.settings) throw new Error('Credentials require Settings')
  return parsed
}
export function parseBackupComplete(value: unknown): BackupComplete {
  return completeSchema.parse(value)
}
function validateKnownFields(value: object, shape: Record<string, z.ZodType>): void {
  const fields = value as Record<string, unknown>
  for (const [key, field] of Object.entries(shape)) {
    if (!Object.hasOwn(fields, key)) continue
    let validator = field
    while (validator instanceof z.ZodCatch) validator = validator.unwrap() as z.ZodType
    validator.parse(fields[key])
  }
}
function validateSnapshot(value: unknown) {
  SessionPromptContextSnapshotSchema.parse(value)
  validateKnownFields(value as object, SessionPromptContextSnapshotSchema.shape)
}
export function parseBackupRecord(value: unknown): BackupRecord {
  recordSchema.parse(value)
  // Validation must not strip unknown business fields inside the message/header.
  const record = value as BackupRecord
  if (record.type === 'global' && !Object.hasOwn(record, 'value')) throw new Error('Global record value is missing')
  if (record.type === 'session') {
    if (record.session.settings) {
      validateKnownFields(record.session.settings, SessionSettingsSchema.shape)
      if (record.session.settings.sessionPromptContextSnapshot !== undefined)
        validateSnapshot(record.session.settings.sessionPromptContextSnapshot)
    }
    for (const key of [
      'messages',
      'threads',
      'messageForksHash',
      'storageFormat',
      'rowFormatVersion',
      'rowAuthority',
      'presentation',
      'topologyFingerprint',
      'contextReadProjection',
      'revision',
    ]) {
      if (key in record.session) throw new Error(`Nonportable session field: ${key}`)
    }
  }
  if (record.type === 'thread' && record.thread.sessionPromptContextSnapshot !== undefined)
    validateSnapshot(record.thread.sessionPromptContextSnapshot)
  if (record.type === 'message') {
    if (record.message.message.usage !== undefined)
      MessageSchema.shape.usage.unwrap().parse(record.message.message.usage)
    for (const part of record.message.message.contentParts) {
      if (part.type === 'tool-call' && part.memoryToolContext !== undefined)
        MemoryToolContextSchema.parse(part.memoryToolContext)
    }
  }
  return record
}
export function emptyBackupCounts(): BackupCounts {
  return { session: 0, thread: 0, message: 0, global: 0, resource: 0, warning: 0 }
}

export function toBackupSession(record: SessionRecordV2): BackupSession {
  const {
    id,
    type,
    name,
    folderId,
    picUrl,
    starred,
    hidden,
    archivedAt,
    copilotId,
    assistantAvatarKey,
    backgroundImage,
    settings,
    activeThreadId,
  } = record
  return {
    id,
    type,
    name,
    folderId,
    picUrl,
    starred,
    hidden,
    archivedAt,
    copilotId,
    assistantAvatarKey,
    backgroundImage,
    settings,
    activeThreadId,
  }
}
export function toBackupThread(row: ThreadRow): BackupThread {
  const { sessionId, threadId, seq, name, createdAt, rootMessageId, compactionPoints, sessionPromptContextSnapshot } =
    row
  return { sessionId, threadId, seq, name, createdAt, rootMessageId, compactionPoints, sessionPromptContextSnapshot }
}
export function toBackupMessage(row: MessageRow): BackupMessage {
  const {
    sessionId,
    threadId,
    messageId,
    parentMessageId,
    activeChildId,
    seq,
    kind,
    createdAt,
    updatedAt,
    branchId,
    forkCreatedAt,
    forkPivotId,
    pendingBranchId,
    pendingBranchSeq,
  } = row
  const {
    tokenCountMap: _tokens,
    tokenCalculatedAt: _calculated,
    tokenCountApproximate: _approximate,
    ...message
  } = row.message
  return {
    sessionId,
    threadId,
    messageId,
    parentMessageId,
    activeChildId,
    seq,
    kind,
    createdAt,
    updatedAt,
    branchId,
    forkCreatedAt,
    forkPivotId,
    pendingBranchId,
    pendingBranchSeq,
    message,
  }
}
/** A restored archive contains history, never a resumable running operation. */
export function settleBackupRecord(record: BackupBusinessRecord): BackupBusinessRecord {
  if (record.type !== 'message') return record
  const portable = portableBackupRecord(record).record
  if (portable.type !== 'message') return portable
  const message = portable.message.message
  record = portable
  return {
    ...record,
    message: {
      ...record.message,
      message: {
        ...message,
        generating: false,
        tokenCountMap: undefined,
        tokenCalculatedAt: undefined,
        tokenCountApproximate: undefined,
        ...(message.compactedFiles
          ? {
              compactedFiles: message.compactedFiles.map((file) =>
                file.ragMode === 'session-retrieval' ? { ...file, ragMode: 'inline' as const } : file
              ),
            }
          : {}),
        contentParts: message.contentParts.map((part) =>
          part.type === 'tool-call' && (part.state === 'call' || part.state === 'paused')
            ? {
                ...part,
                state: 'error',
                pauseReason: undefined,
                result: { error: 'Tool execution was interrupted by backup restoration.' },
              }
            : part
        ),
      },
    },
  }
}

const FILE_LOCAL_FIELDS = [
  'localPath',
  'chatboxAIFileUUID',
  'sessionAttachmentId',
  'sessionAttachmentAvailability',
  'sessionAttachmentIndexStatus',
  'sessionAttachmentBlockedReason',
  'sessionAttachmentWarningReason',
  'sessionAttachmentStatus',
  'sessionAttachmentChunkCount',
  'sessionAttachmentIndexingStage',
  'sessionAttachmentTotalChunks',
  'sessionAttachmentEmbeddedChunks',
  'tokenCountMap',
  'tokenCalculatedAt',
] as const

export function portableBackupRecord(record: BackupBusinessRecord): {
  record: BackupBusinessRecord
  warning?: BackupWarningRecord
} {
  if (record.type !== 'message') return { record }
  const original = record.message.message
  let changed = false
  const portableFile = (file: MessageFile) => {
    const portable = { ...file }
    for (const field of FILE_LOCAL_FIELDS) {
      if (portable[field] !== undefined && field !== 'tokenCountMap' && field !== 'tokenCalculatedAt') changed = true
      delete portable[field]
    }
    return portable
  }
  const portableLink = (link: MessageLink) => {
    const { chatboxAILinkUUID, tokenCountMap: _tokens, tokenCalculatedAt: _calculated, ...portable } = link
    if (chatboxAILinkUUID) changed = true
    return portable
  }
  const files = original.files?.map(portableFile)
  const compactedFiles = original.compactedFiles?.map(portableFile)
  const links = original.links?.map(portableLink)
  const compactedLinks = original.compactedLinks?.map(portableLink)
  const {
    tokenCountMap: _tokens,
    tokenCalculatedAt: _calculated,
    tokenCountApproximate: _approximate,
    ...message
  } = original
  return {
    record: {
      ...record,
      message: {
        ...record.message,
        message: {
          ...message,
          ...(files ? { files } : {}),
          ...(compactedFiles ? { compactedFiles } : {}),
          ...(links ? { links } : {}),
          ...(compactedLinks ? { compactedLinks } : {}),
        },
      },
    },
    ...(changed
      ? {
          warning: {
            type: 'warning' as const,
            category: 'attachment-portability',
            objectId: record.message.messageId,
            message:
              'Attachment content is portable; device paths, retrieval indexes, and remote upload handles must be recreated on the destination.',
          },
        }
      : {}),
  }
}
