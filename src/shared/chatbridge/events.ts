import { z } from 'zod'
import {
  type BridgeAppEvent,
  type BridgeReadyEvent,
} from './bridge-session'
import {
  ChatBridgeCompletionPayloadSchema,
} from './completion'
import {
  canResumeChatBridgeAppInstance,
  ChatBridgeAppErrorSchema,
  ChatBridgeAppInstanceSchema,
  type ChatBridgeAppInstance,
  type ChatBridgeAppInstanceStatus,
} from './instance'

export const CHATBRIDGE_APP_EVENT_SCHEMA_VERSION = 1 as const

export const ChatBridgeAppEventKindSchema = z.enum([
  'instance.created',
  'bridge.ready',
  'render.requested',
  'state.updated',
  'tool.called',
  'auth.requested',
  'auth.linked',
  'completion.recorded',
  'error.recorded',
  'resume.requested',
  'instance.cancelled',
  'instance.marked-stale',
])

export type ChatBridgeAppEventKind = z.infer<typeof ChatBridgeAppEventKindSchema>

export const ChatBridgeAppEventActorSchema = z.enum(['host', 'app', 'system'])
export type ChatBridgeAppEventActor = z.infer<typeof ChatBridgeAppEventActorSchema>

const ChatBridgeAppEventShapeSchema = z.object({
  schemaVersion: z.literal(CHATBRIDGE_APP_EVENT_SCHEMA_VERSION),
  id: z.string(),
  appInstanceId: z.string(),
  kind: ChatBridgeAppEventKindSchema,
  actor: ChatBridgeAppEventActorSchema,
  sequence: z.number().int().positive(),
  createdAt: z.number().int(),
  bridgeSessionId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  nextStatus: z.enum(['launching', 'ready', 'active', 'complete', 'error', 'cancelled', 'stale']),
  snapshot: z.record(z.string(), z.unknown()).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  completion: ChatBridgeCompletionPayloadSchema.optional(),
  error: ChatBridgeAppErrorSchema.optional(),
  authGrantId: z.string().optional(),
  summaryForModel: z.string().optional(),
})

function refineChatBridgeAppEvent(
  value: {
    kind: ChatBridgeAppEventKind
    actor: ChatBridgeAppEventActor
    completion?: unknown
    summaryForModel?: string
  },
  ctx: z.RefinementCtx
) {
  if (value.kind === 'completion.recorded' && !value.completion) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['completion'],
      message: 'Completion events require a structured completion payload.',
    })
  }

  if (value.kind !== 'completion.recorded' && value.completion !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['completion'],
      message: 'Only completion.recorded events may include structured completion payloads.',
    })
  }

  if (value.actor === 'app' && value.summaryForModel !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summaryForModel'],
      message: 'Apps cannot write summaryForModel directly.',
    })
  }
}

export const ChatBridgeAppEventSchema = ChatBridgeAppEventShapeSchema.superRefine(refineChatBridgeAppEvent)

export type ChatBridgeAppEvent = z.infer<typeof ChatBridgeAppEventSchema>

export const CreateChatBridgeAppEventInputSchema = ChatBridgeAppEventShapeSchema.omit({
  schemaVersion: true,
})
  .extend({
    createdAt: z.number().int().optional(),
  })
  .superRefine(refineChatBridgeAppEvent)

export type CreateChatBridgeAppEventInput = z.infer<typeof CreateChatBridgeAppEventInputSchema>

export type ChatBridgeAppEventTransitionReason =
  | 'unexpected-app-instance'
  | 'replayed-sequence'
  | 'illegal-transition'
  | 'instance-not-resumable'

export type ChatBridgeAppEventTransitionResult =
  | {
      accepted: true
      instance: ChatBridgeAppInstance
    }
  | {
      accepted: false
      reason: ChatBridgeAppEventTransitionReason
      instance: ChatBridgeAppInstance
    }

type CreateChatBridgeAppEventOptions = {
  now?: () => number
}

type NormalizeBridgeEventOptions = {
  id: string
  sequence: number
  createdAt?: number
}

type EventRule = {
  from: ChatBridgeAppInstanceStatus[]
  to: ChatBridgeAppInstanceStatus[]
  requiresResumable?: boolean
}

const EVENT_RULES: Record<ChatBridgeAppEventKind, EventRule> = {
  'instance.created': {
    from: ['launching'],
    to: ['launching'],
  },
  'bridge.ready': {
    from: ['launching', 'ready'],
    to: ['ready'],
  },
  'render.requested': {
    from: ['ready', 'active'],
    to: ['ready', 'active'],
  },
  'state.updated': {
    from: ['ready', 'active'],
    to: ['active'],
  },
  'tool.called': {
    from: ['active'],
    to: ['active'],
  },
  'auth.requested': {
    from: ['ready', 'active'],
    to: ['ready', 'active'],
  },
  'auth.linked': {
    from: ['ready', 'active', 'error'],
    to: ['ready', 'active'],
  },
  'completion.recorded': {
    from: ['ready', 'active'],
    to: ['complete'],
  },
  'error.recorded': {
    from: ['launching', 'ready', 'active', 'stale'],
    to: ['error'],
  },
  'resume.requested': {
    from: ['error', 'stale'],
    to: ['ready', 'active'],
    requiresResumable: true,
  },
  'instance.cancelled': {
    from: ['launching', 'ready', 'active', 'error', 'stale'],
    to: ['cancelled'],
  },
  'instance.marked-stale': {
    from: ['launching', 'ready', 'active', 'error'],
    to: ['stale'],
  },
}

function reject(instance: ChatBridgeAppInstance, reason: ChatBridgeAppEventTransitionReason): ChatBridgeAppEventTransitionResult {
  return {
    accepted: false,
    reason,
    instance,
  }
}

function createDefaultError(event: ChatBridgeAppEvent) {
  const completionFailure =
    event.kind === 'completion.recorded' && event.completion?.status === 'failed'
      ? event.completion.error
      : null

  return {
    code: completionFailure?.code ?? 'app_error',
    message: completionFailure?.message ?? 'App lifecycle event reported an error state.',
    occurredAt: event.createdAt,
    recoverable: completionFailure?.retryable,
    details: event.payload,
  }
}

export function createChatBridgeAppEvent(
  input: CreateChatBridgeAppEventInput,
  options: CreateChatBridgeAppEventOptions = {}
) {
  return ChatBridgeAppEventSchema.parse({
    ...input,
    schemaVersion: CHATBRIDGE_APP_EVENT_SCHEMA_VERSION,
    createdAt: input.createdAt ?? options.now?.() ?? Date.now(),
  })
}

export function normalizeBridgeAppEventToChatBridgeAppEvent(
  event: BridgeAppEvent,
  options: NormalizeBridgeEventOptions
) {
  const base = {
    id: options.id,
    appInstanceId: event.appInstanceId,
    actor: 'app' as const,
    sequence: options.sequence,
    createdAt: options.createdAt,
    bridgeSessionId: event.bridgeSessionId,
  }

  if (event.kind === 'app.ready') {
    return createChatBridgeAppEvent({
      ...base,
      kind: 'bridge.ready',
      nextStatus: 'ready',
      payload: {
        bridgeSequence: event.sequence,
        ackNonce: event.ackNonce,
      },
    })
  }

  if (event.kind === 'app.state') {
    return createChatBridgeAppEvent({
      ...base,
      kind: 'state.updated',
      nextStatus: 'active',
      idempotencyKey: event.idempotencyKey,
      snapshot: event.snapshot,
      payload: {
        bridgeSequence: event.sequence,
      },
    })
  }

  if (event.kind === 'app.complete') {
    return createChatBridgeAppEvent({
      ...base,
      kind: 'completion.recorded',
      nextStatus: 'complete',
      idempotencyKey: event.idempotencyKey,
      payload: {
        bridgeSequence: event.sequence,
      },
      completion: event.completion,
    })
  }

  return createChatBridgeAppEvent({
    ...base,
    kind: 'error.recorded',
    nextStatus: 'error',
    idempotencyKey: event.idempotencyKey,
    error: event.error
      ? {
          code: 'app_error',
          message: event.error,
          occurredAt: options.createdAt ?? Date.now(),
        }
      : undefined,
    payload: {
      bridgeSequence: event.sequence,
    },
  })
}

export function applyChatBridgeAppEvent(
  instance: ChatBridgeAppInstance,
  event: ChatBridgeAppEvent
): ChatBridgeAppEventTransitionResult {
  const parsedInstance = ChatBridgeAppInstanceSchema.parse(instance)
  const parsedEvent = ChatBridgeAppEventSchema.parse(event)

  if (parsedInstance.id !== parsedEvent.appInstanceId) {
    return reject(parsedInstance, 'unexpected-app-instance')
  }

  if (parsedEvent.sequence <= parsedInstance.lastEventSequence) {
    return reject(parsedInstance, 'replayed-sequence')
  }

  const rule = EVENT_RULES[parsedEvent.kind]
  if (!rule.from.includes(parsedInstance.status) || !rule.to.includes(parsedEvent.nextStatus)) {
    return reject(parsedInstance, 'illegal-transition')
  }

  if (rule.requiresResumable && !canResumeChatBridgeAppInstance(parsedInstance)) {
    return reject(parsedInstance, 'instance-not-resumable')
  }

  const nextAuth =
    parsedEvent.kind === 'auth.requested'
      ? {
          ...parsedInstance.auth,
          status: 'pending' as const,
        }
      : parsedEvent.kind === 'auth.linked'
        ? {
            status: 'linked' as const,
            grantIds: parsedEvent.authGrantId
              ? Array.from(new Set([...parsedInstance.auth.grantIds, parsedEvent.authGrantId]))
              : parsedInstance.auth.grantIds,
          }
        : parsedInstance.auth

  const nextCompletion =
    parsedEvent.kind === 'completion.recorded'
      ? {
          ...parsedInstance.completion,
          payload: parsedEvent.completion,
          suggestedSummary: parsedEvent.completion?.suggestedSummary?.text,
          summaryForModel: parsedEvent.summaryForModel ?? parsedInstance.completion.summaryForModel,
          status: parsedEvent.summaryForModel ? ('normalized' as const) : parsedInstance.completion.status,
        }
      : parsedInstance.completion

  const nextError =
    parsedEvent.nextStatus === 'error'
      ? parsedEvent.error ?? createDefaultError(parsedEvent)
      : parsedEvent.nextStatus === 'stale'
        ? parsedInstance.error
        : undefined

  return {
    accepted: true,
    instance: ChatBridgeAppInstanceSchema.parse({
      ...parsedInstance,
      bridgeSessionId: parsedEvent.bridgeSessionId ?? parsedInstance.bridgeSessionId,
      status: parsedEvent.nextStatus,
      auth: nextAuth,
      completion: nextCompletion,
      summaryForModel: parsedEvent.summaryForModel ?? parsedInstance.summaryForModel,
      lastSnapshot: parsedEvent.snapshot ?? parsedInstance.lastSnapshot,
      error: nextError,
      updatedAt: parsedEvent.createdAt,
      lastEventAt: parsedEvent.createdAt,
      lastEventSequence: parsedEvent.sequence,
    }),
  }
}

export function isBridgeReadyEvent(event: BridgeAppEvent): event is BridgeReadyEvent {
  return event.kind === 'app.ready'
}
