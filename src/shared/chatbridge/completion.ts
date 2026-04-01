import { z } from 'zod'

export const CHATBRIDGE_COMPLETION_SCHEMA_VERSION = 1 as const

export const ChatBridgeCompletionStatusSchema = z.enum([
  'success',
  'interrupted',
  'failure',
])

export type ChatBridgeCompletionStatus = z.infer<typeof ChatBridgeCompletionStatusSchema>

export const ChatBridgeCompletionOutcomeSchema = z.object({
  code: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})

export type ChatBridgeCompletionOutcome = z.infer<typeof ChatBridgeCompletionOutcomeSchema>

export const ChatBridgeCompletionResumabilityHintSchema = z.object({
  mode: z.enum(['resumable', 'restartable', 'not-resumable', 'unknown']),
  resumeKey: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
})

export type ChatBridgeCompletionResumabilityHint = z.infer<typeof ChatBridgeCompletionResumabilityHintSchema>

export const ChatBridgeCompletionErrorSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  recoverable: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})

export type ChatBridgeCompletionError = z.infer<typeof ChatBridgeCompletionErrorSchema>

const ChatBridgeCompletionPayloadBaseSchema = z.object({
  schemaVersion: z.literal(CHATBRIDGE_COMPLETION_SCHEMA_VERSION),
  outcome: ChatBridgeCompletionOutcomeSchema,
  suggestedSummary: z.string().trim().min(1).optional(),
  resumability: ChatBridgeCompletionResumabilityHintSchema.optional(),
})

export const ChatBridgeCompletionSuccessPayloadSchema = ChatBridgeCompletionPayloadBaseSchema.extend({
  status: z.literal('success'),
})

export type ChatBridgeCompletionSuccessPayload = z.infer<typeof ChatBridgeCompletionSuccessPayloadSchema>

export const ChatBridgeCompletionInterruptedPayloadSchema = ChatBridgeCompletionPayloadBaseSchema.extend({
  status: z.literal('interrupted'),
})

export type ChatBridgeCompletionInterruptedPayload = z.infer<typeof ChatBridgeCompletionInterruptedPayloadSchema>

export const ChatBridgeCompletionFailurePayloadSchema = ChatBridgeCompletionPayloadBaseSchema.extend({
  status: z.literal('failure'),
  error: ChatBridgeCompletionErrorSchema,
})

export type ChatBridgeCompletionFailurePayload = z.infer<typeof ChatBridgeCompletionFailurePayloadSchema>

export const ChatBridgeCompletionPayloadSchema = z.discriminatedUnion('status', [
  ChatBridgeCompletionSuccessPayloadSchema,
  ChatBridgeCompletionInterruptedPayloadSchema,
  ChatBridgeCompletionFailurePayloadSchema,
])

export type ChatBridgeCompletionPayload = z.infer<typeof ChatBridgeCompletionPayloadSchema>
