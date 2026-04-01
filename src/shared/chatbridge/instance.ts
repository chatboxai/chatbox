import { z } from 'zod'
import { CHATBRIDGE_PROTOCOL_VERSION } from './bridge-session'
import { ChatBridgeCompletionPayloadSchema } from './completion'

export const CHATBRIDGE_APP_INSTANCE_SCHEMA_VERSION = 1 as const

export const ChatBridgeAppInstanceStatusSchema = z.enum([
  'launching',
  'ready',
  'active',
  'complete',
  'error',
  'cancelled',
  'stale',
])

export type ChatBridgeAppInstanceStatus = z.infer<typeof ChatBridgeAppInstanceStatusSchema>

export const ChatBridgeAppOwnerSchema = z.object({
  authority: z.literal('host'),
  conversationSessionId: z.string(),
  initiatedBy: z.enum(['assistant', 'user', 'system']),
  tenantId: z.string().optional(),
  userId: z.string().optional(),
})

export type ChatBridgeAppOwner = z.infer<typeof ChatBridgeAppOwnerSchema>

export const ChatBridgeAppResumabilityModeSchema = z.enum([
  'resumable',
  'restartable',
  'not-resumable',
  'unknown',
])

export type ChatBridgeAppResumabilityMode = z.infer<typeof ChatBridgeAppResumabilityModeSchema>

export const ChatBridgeAppResumabilitySchema = z.object({
  mode: ChatBridgeAppResumabilityModeSchema,
  resumeKey: z.string().optional(),
  reason: z.string().optional(),
})

export type ChatBridgeAppResumability = z.infer<typeof ChatBridgeAppResumabilitySchema>

export const ChatBridgeAppErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.number().int(),
})

export type ChatBridgeAppError = z.infer<typeof ChatBridgeAppErrorSchema>

export const ChatBridgeAppCompletionStateSchema = z.object({
  status: z.enum(['pending', 'normalized', 'skipped']),
  payload: ChatBridgeCompletionPayloadSchema.optional(),
  suggestedSummary: z.string().optional(),
  summaryForModel: z.string().optional(),
  normalizedAt: z.number().int().optional(),
})

export type ChatBridgeAppCompletionState = z.infer<typeof ChatBridgeAppCompletionStateSchema>

export const ChatBridgeAppAuthLinkageSchema = z.object({
  status: z.enum(['not-required', 'pending', 'linked', 'revoked']),
  grantIds: z.array(z.string()),
})

export type ChatBridgeAppAuthLinkage = z.infer<typeof ChatBridgeAppAuthLinkageSchema>

export const ChatBridgeAppInstanceSchema = z.object({
  schemaVersion: z.literal(CHATBRIDGE_APP_INSTANCE_SCHEMA_VERSION),
  id: z.string(),
  appId: z.string(),
  appVersion: z.string(),
  protocolVersion: z.string(),
  bridgeSessionId: z.string().optional(),
  status: ChatBridgeAppInstanceStatusSchema,
  owner: ChatBridgeAppOwnerSchema,
  resumability: ChatBridgeAppResumabilitySchema,
  summaryForModel: z.string().optional(),
  completion: ChatBridgeAppCompletionStateSchema,
  auth: ChatBridgeAppAuthLinkageSchema,
  lastSnapshot: z.record(z.string(), z.unknown()).optional(),
  error: ChatBridgeAppErrorSchema.optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  lastEventAt: z.number().int(),
  lastEventSequence: z.number().int().nonnegative(),
})

export type ChatBridgeAppInstance = z.infer<typeof ChatBridgeAppInstanceSchema>

export const CreateChatBridgeAppInstanceInputSchema = z.object({
  id: z.string(),
  appId: z.string(),
  appVersion: z.string(),
  protocolVersion: z.string().default(CHATBRIDGE_PROTOCOL_VERSION),
  bridgeSessionId: z.string().optional(),
  owner: ChatBridgeAppOwnerSchema,
  resumability: ChatBridgeAppResumabilitySchema,
  createdAt: z.number().int().optional(),
})

export type CreateChatBridgeAppInstanceInput = z.input<typeof CreateChatBridgeAppInstanceInputSchema>

type CreateChatBridgeAppInstanceOptions = {
  now?: () => number
}

export function createChatBridgeAppInstance(
  input: CreateChatBridgeAppInstanceInput,
  options: CreateChatBridgeAppInstanceOptions = {}
) {
  const parsedInput = CreateChatBridgeAppInstanceInputSchema.parse(input)
  const now = parsedInput.createdAt ?? options.now?.() ?? Date.now()

  return ChatBridgeAppInstanceSchema.parse({
    schemaVersion: CHATBRIDGE_APP_INSTANCE_SCHEMA_VERSION,
    id: parsedInput.id,
    appId: parsedInput.appId,
    appVersion: parsedInput.appVersion,
    protocolVersion: parsedInput.protocolVersion,
    bridgeSessionId: parsedInput.bridgeSessionId,
    status: 'launching',
    owner: parsedInput.owner,
    resumability: parsedInput.resumability,
    completion: {
      status: 'pending',
    },
    auth: {
      status: 'not-required',
      grantIds: [],
    },
    createdAt: now,
    updatedAt: now,
    lastEventAt: now,
    lastEventSequence: 0,
  })
}

export function canResumeChatBridgeAppInstance(instance: ChatBridgeAppInstance) {
  if (instance.resumability.mode === 'not-resumable') {
    return false
  }

  return instance.status === 'error' || instance.status === 'stale'
}

export function isTerminalChatBridgeAppInstanceStatus(status: ChatBridgeAppInstanceStatus) {
  return status === 'complete' || status === 'cancelled'
}
