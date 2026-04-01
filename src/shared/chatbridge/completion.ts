import { z } from 'zod'

export const CHATBRIDGE_COMPLETION_SCHEMA_VERSION = 1 as const

export const ChatBridgeCompletionSuggestedSummarySchema = z
  .object({
    title: z.string().min(1).optional(),
    text: z.string().min(1),
    bullets: z.array(z.string().min(1)).max(5).optional(),
  })
  .strict()

export type ChatBridgeCompletionSuggestedSummary = z.infer<typeof ChatBridgeCompletionSuggestedSummarySchema>

export const ChatBridgeCompletionResumabilitySchema = z
  .object({
    resumable: z.boolean(),
    checkpointId: z.string().min(1).optional(),
    resumeHint: z.string().min(1).optional(),
    resumeToken: z.string().min(1).optional(),
  })
  .strict()

export type ChatBridgeCompletionResumability = z.infer<typeof ChatBridgeCompletionResumabilitySchema>

export const ChatBridgeCompletionErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean().optional(),
  })
  .strict()

export type ChatBridgeCompletionError = z.infer<typeof ChatBridgeCompletionErrorSchema>

const ChatBridgeCompletionPayloadBaseSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_COMPLETION_SCHEMA_VERSION),
    outcomeData: z.record(z.string(), z.unknown()).optional(),
    suggestedSummary: ChatBridgeCompletionSuggestedSummarySchema.optional(),
  })
  .strict()

export const ChatBridgeSuccessCompletionPayloadSchema = ChatBridgeCompletionPayloadBaseSchema.extend({
  status: z.literal('success'),
  resumability: ChatBridgeCompletionResumabilitySchema.optional(),
})

export const ChatBridgeInterruptedCompletionPayloadSchema = ChatBridgeCompletionPayloadBaseSchema.extend({
  status: z.literal('interrupted'),
  reason: z.string().min(1),
  resumability: ChatBridgeCompletionResumabilitySchema,
})

export const ChatBridgeFailedCompletionPayloadSchema = ChatBridgeCompletionPayloadBaseSchema.extend({
  status: z.literal('failed'),
  error: ChatBridgeCompletionErrorSchema,
  resumability: ChatBridgeCompletionResumabilitySchema.optional(),
})

export const ChatBridgeCompletionPayloadSchema = z.discriminatedUnion('status', [
  ChatBridgeSuccessCompletionPayloadSchema,
  ChatBridgeInterruptedCompletionPayloadSchema,
  ChatBridgeFailedCompletionPayloadSchema,
])

export type ChatBridgeCompletionPayload = z.infer<typeof ChatBridgeCompletionPayloadSchema>
export type ChatBridgeSuccessCompletionPayload = z.infer<typeof ChatBridgeSuccessCompletionPayloadSchema>
export type ChatBridgeInterruptedCompletionPayload = z.infer<typeof ChatBridgeInterruptedCompletionPayloadSchema>
export type ChatBridgeFailedCompletionPayload = z.infer<typeof ChatBridgeFailedCompletionPayloadSchema>
