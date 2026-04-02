import { z } from 'zod'
import { ChatBridgeAuditCaptureSchema } from './audit'
import { ChatBridgeJsonSchemaSchema } from './manifest'

export const CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION = 1 as const

export const ChatBridgeResourceProxyActionSchema = z
  .object({
    action: z.string().trim().min(1),
    resource: z.string().trim().min(1),
    permissionId: z.string().trim().min(1),
    description: z.string().trim().min(1),
    inputSchema: ChatBridgeJsonSchemaSchema,
  })
  .strict()
export type ChatBridgeResourceProxyAction = z.infer<typeof ChatBridgeResourceProxyActionSchema>

export const ChatBridgeResourceProxyRequestSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION),
    requestId: z.string().trim().min(1),
    handleId: z.string().trim().min(1),
    userId: z.string().trim().min(1),
    appId: z.string().trim().min(1),
    resource: z.string().trim().min(1),
    action: z.string().trim().min(1),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
export type ChatBridgeResourceProxyRequest = z.infer<typeof ChatBridgeResourceProxyRequestSchema>

export const ChatBridgeResourceProxyAuditOutcomeSchema = z.enum(['granted', 'denied', 'error'])
export type ChatBridgeResourceProxyAuditOutcome = z.infer<typeof ChatBridgeResourceProxyAuditOutcomeSchema>

export const ChatBridgeResourceProxyAuditEntrySchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION),
    category: z.literal('resource.action').default('resource.action'),
    requestId: z.string().trim().min(1),
    handleId: z.string().trim().min(1),
    userId: z.string().trim().min(1),
    appId: z.string().trim().min(1),
    resource: z.string().trim().min(1),
    action: z.string().trim().min(1),
    permissionId: z.string().trim().min(1).optional(),
    outcome: ChatBridgeResourceProxyAuditOutcomeSchema,
    loggedAt: z.number().int().nonnegative(),
    details: z.array(z.string().trim().min(1)).default([]),
    redactedKeys: z.array(z.string().trim().min(1)).default([]),
    capture: ChatBridgeAuditCaptureSchema.default({ level: 'metadata' }),
    forensicPayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.capture.level === 'metadata' && value.forensicPayload !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forensicPayload'],
        message: 'forensicPayload is only allowed when forensic capture is enabled.',
      })
    }

    if (value.capture.level === 'forensic' && value.forensicPayload === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forensicPayload'],
        message: 'forensicPayload is required when forensic capture is enabled.',
      })
    }
  })
export type ChatBridgeResourceProxyAuditEntry = z.infer<typeof ChatBridgeResourceProxyAuditEntrySchema>

export const ChatBridgeResourceProxyErrorCodeSchema = z.enum([
  'missing-handle',
  'revoked-handle',
  'expired-handle',
  'user-mismatch',
  'app-mismatch',
  'permission-denied',
  'unsupported-action',
  'handler-error',
])
export type ChatBridgeResourceProxyErrorCode = z.infer<typeof ChatBridgeResourceProxyErrorCodeSchema>

export const ChatBridgeResourceProxyResponseSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION),
    requestId: z.string().trim().min(1),
    status: z.enum(['success', 'denied', 'error']),
    resource: z.string().trim().min(1),
    action: z.string().trim().min(1),
    result: z.record(z.string(), z.unknown()).default({}),
    errorCode: ChatBridgeResourceProxyErrorCodeSchema.optional(),
    message: z.string().trim().min(1),
    audit: ChatBridgeResourceProxyAuditEntrySchema,
  })
  .strict()
export type ChatBridgeResourceProxyResponse = z.infer<typeof ChatBridgeResourceProxyResponseSchema>
