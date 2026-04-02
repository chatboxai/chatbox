import { z } from 'zod'
import type { ChatBridgePolicyDecision } from './policy'

export const CHATBRIDGE_AUDIT_SCHEMA_VERSION = 1 as const

const ALWAYS_REDACTED_KEY_PATTERN = /(token|secret|password|credential|cookie|authorization|api[_-]?key|refresh)/i
const METADATA_REDACTED_KEY_PATTERN = /(prompt|message|content|text|body|email|conversation|transcript)/i
const MAX_DETAIL_ENTRIES = 4
const MAX_FORENSIC_ARRAY_ITEMS = 10
const MAX_STRING_LENGTH = 160

export const ChatBridgeAuditCategorySchema = z.enum([
  'policy.decision',
  'auth.handle',
  'resource.action',
  'lifecycle.completion',
])
export type ChatBridgeAuditCategory = z.infer<typeof ChatBridgeAuditCategorySchema>

export const ChatBridgeAuditCaptureSchema = z.union([
  z
    .object({
      level: z.literal('metadata'),
    })
    .strict(),
  z
    .object({
      level: z.literal('forensic'),
      caseId: z.string().trim().min(1),
      approvedBy: z.string().trim().min(1),
      justification: z.string().trim().min(1),
    })
    .strict(),
])
export type ChatBridgeAuditCapture = z.infer<typeof ChatBridgeAuditCaptureSchema>

const ChatBridgeAuditRecordFieldsObjectSchema = z
  .object({
    category: ChatBridgeAuditCategorySchema,
    occurredAt: z.number().int().nonnegative(),
    outcome: z.string().trim().min(1),
    details: z.array(z.string().trim().min(1)).default([]),
    redactedKeys: z.array(z.string().trim().min(1)).default([]),
    summary: z.string().trim().min(1).optional(),
    capture: ChatBridgeAuditCaptureSchema.default({ level: 'metadata' }),
    forensicPayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

function refineAuditRecordFields(
  value: {
    capture: ChatBridgeAuditCapture
    forensicPayload?: Record<string, unknown>
  },
  ctx: z.RefinementCtx
) {
  if (value.capture.level === 'metadata' && value.forensicPayload !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['forensicPayload'],
      message: 'forensicPayload is only allowed when capture.level is forensic.',
    })
  }

  if (value.capture.level === 'forensic' && value.forensicPayload === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['forensicPayload'],
      message: 'forensicPayload is required when forensic capture is enabled.',
    })
  }
}

export const ChatBridgeAuditRecordFieldsSchema = ChatBridgeAuditRecordFieldsObjectSchema.superRefine(refineAuditRecordFields)
export type ChatBridgeAuditRecordFields = z.infer<typeof ChatBridgeAuditRecordFieldsSchema>
const ChatBridgeResolvedAuditFieldsSchema = ChatBridgeAuditRecordFieldsObjectSchema.pick({
  details: true,
  redactedKeys: true,
  capture: true,
  forensicPayload: true,
}).superRefine(refineAuditRecordFields)

export const ChatBridgeAuditEventSchema = ChatBridgeAuditRecordFieldsObjectSchema.extend({
  schemaVersion: z.literal(CHATBRIDGE_AUDIT_SCHEMA_VERSION),
  eventId: z.string().trim().min(1),
  tenantId: z.string().trim().min(1).optional(),
  teacherId: z.string().trim().min(1).optional(),
  classroomId: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
  appId: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1).optional(),
  requestId: z.string().trim().min(1).optional(),
  handleId: z.string().trim().min(1).optional(),
  resource: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
}).superRefine(refineAuditRecordFields)
export type ChatBridgeAuditEvent = z.infer<typeof ChatBridgeAuditEventSchema>

export type CreateChatBridgeAuditEventInput = Omit<
  ChatBridgeAuditEvent,
  'schemaVersion' | 'details' | 'redactedKeys' | 'capture' | 'forensicPayload'
> & {
  details?: string[]
  payload?: Record<string, unknown>
  capture?: ChatBridgeAuditCapture
}

export type ResolveChatBridgeAuditRecordFieldsInput = {
  details?: string[]
  payload?: Record<string, unknown>
  capture?: ChatBridgeAuditCapture
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateAuditString(value: string) {
  const normalized = normalizeWhitespace(value)
  if (!normalized) {
    return ''
  }

  if (normalized.length <= MAX_STRING_LENGTH) {
    return normalized
  }

  return `${normalized.slice(0, MAX_STRING_LENGTH - 1)}…`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAlwaysRedactedKey(key: string) {
  return ALWAYS_REDACTED_KEY_PATTERN.test(key)
}

function isMetadataRedactedKey(key: string) {
  return isAlwaysRedactedKey(key) || METADATA_REDACTED_KEY_PATTERN.test(key)
}

function formatScalarDetail(value: unknown): string | null {
  if (typeof value === 'string') {
    const truncated = truncateAuditString(value)
    return truncated || null
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return null
}

function pushUniqueRedaction(redactedKeys: string[], key: string) {
  if (!redactedKeys.includes(key)) {
    redactedKeys.push(key)
  }
}

function collectMetadataDetails(payload?: Record<string, unknown>) {
  const details: string[] = []
  const redactedKeys: string[] = []

  if (!payload) {
    return { details, redactedKeys }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (isMetadataRedactedKey(key)) {
      pushUniqueRedaction(redactedKeys, key)
      continue
    }

    const scalar = formatScalarDetail(value)
    if (scalar) {
      details.push(`${key}: ${scalar}`)
    } else if (Array.isArray(value)) {
      details.push(`${key}Count: ${value.length}`)
    }

    if (details.length >= MAX_DETAIL_ENTRIES) {
      break
    }
  }

  return { details, redactedKeys }
}

function sanitizeForensicValue(value: unknown, keyPath: string[], redactedKeys: string[]): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, MAX_FORENSIC_ARRAY_ITEMS).map((item, index) => {
      return sanitizeForensicValue(item, [...keyPath, String(index)], redactedKeys)
    })
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => {
        const nextPath = [...keyPath, key]
        const joinedPath = nextPath.join('.')
        if (isAlwaysRedactedKey(key)) {
          pushUniqueRedaction(redactedKeys, joinedPath)
          return [key, '[redacted]']
        }

        return [key, sanitizeForensicValue(nestedValue, nextPath, redactedKeys)]
      })
    )
  }

  if (typeof value === 'string') {
    return truncateAuditString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }

  if (value === undefined) {
    return null
  }

  return truncateAuditString(String(value))
}

function sanitizeForensicPayload(payload: Record<string, unknown>) {
  const redactedKeys: string[] = []
  const forensicPayload = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (isAlwaysRedactedKey(key)) {
        pushUniqueRedaction(redactedKeys, key)
        return [key, '[redacted]']
      }

      return [key, sanitizeForensicValue(value, [key], redactedKeys)]
    })
  )

  return {
    forensicPayload,
    redactedKeys,
  }
}

export function resolveChatBridgeAuditRecordFields(
  input: ResolveChatBridgeAuditRecordFieldsInput
): Pick<ChatBridgeAuditRecordFields, 'details' | 'redactedKeys' | 'capture' | 'forensicPayload'> {
  const capture = ChatBridgeAuditCaptureSchema.parse(input.capture ?? { level: 'metadata' })
  const baseDetails = [...(input.details ?? [])]

  if (capture.level === 'forensic') {
    if (!input.payload) {
      return ChatBridgeResolvedAuditFieldsSchema.parse({
        details: baseDetails,
        redactedKeys: [],
        capture,
      })
    }

    const { forensicPayload, redactedKeys } = sanitizeForensicPayload(input.payload)
    return ChatBridgeResolvedAuditFieldsSchema.parse({
      details: baseDetails,
      redactedKeys,
      capture,
      forensicPayload,
    })
  }

  const { details, redactedKeys } = collectMetadataDetails(input.payload)
  return ChatBridgeResolvedAuditFieldsSchema.parse({
    details: [...baseDetails, ...details],
    redactedKeys,
    capture,
  })
}

export function createChatBridgeAuditEvent(input: CreateChatBridgeAuditEventInput): ChatBridgeAuditEvent {
  const resolvedFields = resolveChatBridgeAuditRecordFields({
    details: input.details,
    payload: input.payload,
    capture: input.capture,
  })

  return ChatBridgeAuditEventSchema.parse({
    schemaVersion: CHATBRIDGE_AUDIT_SCHEMA_VERSION,
    eventId: input.eventId,
    category: input.category,
    occurredAt: input.occurredAt,
    outcome: input.outcome,
    tenantId: input.tenantId,
    teacherId: input.teacherId,
    classroomId: input.classroomId,
    userId: input.userId,
    appId: input.appId,
    sessionId: input.sessionId,
    requestId: input.requestId,
    handleId: input.handleId,
    resource: input.resource,
    action: input.action,
    summary: input.summary,
    ...resolvedFields,
  })
}

export function createChatBridgePolicyAuditEvent(input: {
  eventId: string
  occurredAt: number
  tenantId: string
  appId: string
  decision: ChatBridgePolicyDecision
  teacherId?: string
  classroomId?: string
  capture?: ChatBridgeAuditCapture
}) {
  return createChatBridgeAuditEvent({
    eventId: input.eventId,
    category: 'policy.decision',
    occurredAt: input.occurredAt,
    outcome: input.decision.allowed ? 'allowed' : 'denied',
    tenantId: input.tenantId,
    teacherId: input.teacherId,
    classroomId: input.classroomId,
    appId: input.appId,
    summary: input.decision.allowed
      ? 'Policy allowed the reviewed app for the current context.'
      : 'Policy denied the reviewed app for the current context.',
    details: input.decision.reasons.map((reason) => {
      if (reason.scope) {
        return `${reason.scope}: ${reason.message}`
      }
      return reason.message
    }),
    capture: input.capture,
  })
}
