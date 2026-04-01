import { z } from 'zod'
import type { MessageAppPart } from '../types/session'

export const CHATBRIDGE_DEGRADED_COMPLETION_SCHEMA_VERSION = 1 as const
const CHATBRIDGE_DEGRADED_COMPLETION_VALUES_KEY = 'chatbridgeDegradedCompletion'

export const ChatBridgeDegradedCompletionKindSchema = z.enum([
  'partial-completion',
  'missing-completion',
  'invalid-completion',
  'stale-checkpoint',
  'runtime-error',
])

export type ChatBridgeDegradedCompletionKind = z.infer<typeof ChatBridgeDegradedCompletionKindSchema>

export const ChatBridgeRecoveryItemToneSchema = z.enum(['neutral', 'safe', 'warning', 'blocked'])
export type ChatBridgeRecoveryItemTone = z.infer<typeof ChatBridgeRecoveryItemToneSchema>

export const ChatBridgeRecoveryItemSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  tone: ChatBridgeRecoveryItemToneSchema.default('neutral'),
})

export type ChatBridgeRecoveryItem = z.infer<typeof ChatBridgeRecoveryItemSchema>

export const ChatBridgeRecoveryPanelSchema = z.object({
  eyebrow: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  items: z.array(ChatBridgeRecoveryItemSchema).default([]),
})

export type ChatBridgeRecoveryPanel = z.infer<typeof ChatBridgeRecoveryPanelSchema>

export const ChatBridgeRecoveryActionIdSchema = z.enum([
  'retry-completion',
  'continue-in-chat',
  'dismiss-runtime',
  'resume-from-checkpoint',
  'ask-for-explanation',
  'inspect-invalid-fields',
])

export type ChatBridgeRecoveryActionId = z.infer<typeof ChatBridgeRecoveryActionIdSchema>

export const ChatBridgeRecoveryActionSchema = z.object({
  id: ChatBridgeRecoveryActionIdSchema,
  label: z.string(),
  variant: z.enum(['primary', 'secondary']).default('secondary'),
})

export type ChatBridgeRecoveryAction = z.infer<typeof ChatBridgeRecoveryActionSchema>

export const ChatBridgeRecoveryAcknowledgementSchema = z.object({
  requestedActionId: ChatBridgeRecoveryActionIdSchema,
  title: z.string(),
  description: z.string(),
  statusLabel: z.string().optional(),
})

export type ChatBridgeRecoveryAcknowledgement = z.infer<typeof ChatBridgeRecoveryAcknowledgementSchema>

export const ChatBridgeDegradedCompletionSchema = z.object({
  schemaVersion: z.literal(CHATBRIDGE_DEGRADED_COMPLETION_SCHEMA_VERSION).default(CHATBRIDGE_DEGRADED_COMPLETION_SCHEMA_VERSION),
  kind: ChatBridgeDegradedCompletionKindSchema,
  statusLabel: z.string(),
  title: z.string(),
  description: z.string(),
  supportPanel: ChatBridgeRecoveryPanelSchema.optional(),
  actions: z.array(ChatBridgeRecoveryActionSchema).default([]),
  acknowledgement: ChatBridgeRecoveryAcknowledgementSchema.optional(),
})

export type ChatBridgeDegradedCompletion = z.infer<typeof ChatBridgeDegradedCompletionSchema>

function getAppLabel(part: Pick<MessageAppPart, 'appName' | 'appId'>) {
  return part.appName?.trim() || part.appId.trim() || 'App'
}

function createDefaultStaleCheckpoint(part: Pick<MessageAppPart, 'appName' | 'appId' | 'fallbackText' | 'statusText'>) {
  const appLabel = getAppLabel(part)

  return ChatBridgeDegradedCompletionSchema.parse({
    kind: 'stale-checkpoint',
    statusLabel: part.statusText || 'Stale checkpoint',
    title: `${appLabel} needs a fresh checkpoint`,
    description:
      part.fallbackText ||
      'The last cached checkpoint expired, so the host kept the degraded ending explicit instead of pretending the runtime resumed.',
    supportPanel: {
      eyebrow: 'Trust rail',
      title: 'What still holds',
      description: 'Only the last validated snapshot remains available for follow-up questions or recovery.',
      items: [
        {
          label: 'Validated checkpoint remains visible',
          description: 'The thread keeps the last safe state inline.',
          tone: 'safe',
        },
        {
          label: 'Stale cache is blocked from model memory',
          description: 'The host does not treat expired runtime state as current truth.',
          tone: 'blocked',
        },
      ],
    },
    actions: [
      { id: 'resume-from-checkpoint', label: 'Resume checkpoint', variant: 'primary' },
      { id: 'ask-for-explanation', label: 'Ask for explanation', variant: 'secondary' },
    ],
  })
}

function createDefaultRuntimeError(part: Pick<MessageAppPart, 'appName' | 'appId' | 'error' | 'fallbackText' | 'statusText'>) {
  const appLabel = getAppLabel(part)

  return ChatBridgeDegradedCompletionSchema.parse({
    kind: 'runtime-error',
    statusLabel: part.statusText || 'Runtime error',
    title: `${appLabel} ended in a degraded state`,
    description:
      part.error?.trim() ||
      part.fallbackText ||
      'The host kept the failure inline, preserved validated context, and avoided promoting an unsafe completion as final output.',
    supportPanel: {
      eyebrow: 'Trust rail',
      title: 'What still holds',
      description: 'Only host-owned diagnostics and the latest validated state remain available in the thread.',
      items: [
        {
          label: 'Conversation can continue safely',
          description: 'The assistant can keep helping without reopening the runtime immediately.',
          tone: 'safe',
        },
        {
          label: 'Unsafe runtime output stays quarantined',
          description: 'Malformed or missing completion payloads remain blocked from model memory.',
          tone: 'blocked',
        },
      ],
    },
    actions: [
      { id: 'continue-in-chat', label: 'Continue safely', variant: 'primary' },
      { id: 'dismiss-runtime', label: 'Dismiss runtime', variant: 'secondary' },
    ],
  })
}

export function parseChatBridgeDegradedCompletion(value: unknown): ChatBridgeDegradedCompletion | null {
  const parsed = ChatBridgeDegradedCompletionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function readChatBridgeDegradedCompletion(
  part: Pick<MessageAppPart, 'values' | 'lifecycle' | 'appId' | 'appName' | 'error' | 'fallbackText' | 'statusText'>
): ChatBridgeDegradedCompletion | null {
  const explicit = parseChatBridgeDegradedCompletion(
    part.values && typeof part.values === 'object' ? part.values[CHATBRIDGE_DEGRADED_COMPLETION_VALUES_KEY] : undefined
  )

  if (explicit) {
    return explicit
  }

  if (part.lifecycle === 'stale') {
    return createDefaultStaleCheckpoint(part)
  }

  if (part.lifecycle === 'error' && (part.error || part.fallbackText)) {
    return createDefaultRuntimeError(part)
  }

  return null
}

export function writeChatBridgeDegradedCompletionValues(
  values: Record<string, unknown> | undefined,
  degradedCompletion: ChatBridgeDegradedCompletion
) {
  return {
    ...(values || {}),
    [CHATBRIDGE_DEGRADED_COMPLETION_VALUES_KEY]: ChatBridgeDegradedCompletionSchema.parse(degradedCompletion),
  }
}

function buildActionAcknowledgement(
  actionId: ChatBridgeRecoveryActionId,
  appLabel: string
): ChatBridgeRecoveryAcknowledgement {
  switch (actionId) {
    case 'retry-completion':
      return {
        requestedActionId: actionId,
        statusLabel: 'Retry requested',
        title: 'Retry requested',
        description: `The host recorded a retry request for ${appLabel} without promoting partial output as a successful completion.`,
      }
    case 'continue-in-chat':
      return {
        requestedActionId: actionId,
        statusLabel: 'Continue safely',
        title: 'Conversation can continue safely',
        description: 'The assistant can keep helping from the last validated state while the degraded ending stays explicit in the thread.',
      }
    case 'dismiss-runtime':
      return {
        requestedActionId: actionId,
        statusLabel: 'Runtime dismissed',
        title: 'Runtime dismissed',
        description: 'The host left the degraded ending inline so the user can continue the conversation without reopening the runtime.',
      }
    case 'resume-from-checkpoint':
      return {
        requestedActionId: actionId,
        statusLabel: 'Resume checkpoint',
        title: 'Resuming from the last validated checkpoint',
        description: 'The host will prefer the latest validated snapshot instead of inventing completion data from the stale runtime state.',
      }
    case 'ask-for-explanation':
      return {
        requestedActionId: actionId,
        statusLabel: 'Explain gap',
        title: 'Bounded explanation requested',
        description: 'The assistant can explain what happened using only validated host-owned state and diagnostics.',
      }
    case 'inspect-invalid-fields':
      return {
        requestedActionId: actionId,
        statusLabel: 'Inspect invalid fields',
        title: 'Invalid fields remain quarantined',
        description: 'The host can expose safe diagnostics while malformed completion fields stay blocked from model memory.',
      }
  }
}

export function applyChatBridgeRecoveryAction(
  part: MessageAppPart,
  actionId: ChatBridgeRecoveryActionId
): MessageAppPart {
  const degradedCompletion = readChatBridgeDegradedCompletion(part)
  if (!degradedCompletion) {
    return part
  }

  if (!degradedCompletion.actions.some((action) => action.id === actionId)) {
    return part
  }

  const acknowledgement = buildActionAcknowledgement(actionId, getAppLabel(part))
  const nextDegradedCompletion = ChatBridgeDegradedCompletionSchema.parse({
    ...degradedCompletion,
    acknowledgement,
  })

  return {
    ...part,
    statusText: acknowledgement.statusLabel || part.statusText,
    values: writeChatBridgeDegradedCompletionValues(part.values, nextDegradedCompletion),
  }
}
