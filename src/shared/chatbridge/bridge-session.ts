import { z } from 'zod'
import { ChatBridgeCompletionPayloadSchema } from './completion'

export const CHATBRIDGE_PROTOCOL_VERSION = 'chatbridge-bridge-v1' as const

export const BridgeSessionCapabilitySchema = z.enum(['render-html-preview'])
export type BridgeSessionCapability = z.infer<typeof BridgeSessionCapabilitySchema>

export const BridgeBootstrapEnvelopeSchema = z.object({
  bridgeSessionId: z.string(),
  appId: z.string(),
  appInstanceId: z.string(),
  expectedOrigin: z.string(),
  protocolVersion: z.literal(CHATBRIDGE_PROTOCOL_VERSION),
  capabilities: z.array(BridgeSessionCapabilitySchema).min(1),
  expiresAt: z.number().int(),
  bridgeToken: z.string(),
  bootstrapNonce: z.string(),
  issuedAt: z.number().int(),
})

export type BridgeBootstrapEnvelope = z.infer<typeof BridgeBootstrapEnvelopeSchema>

export const BridgeHostBootstrapMessageSchema = z.object({
  kind: z.literal('host.bootstrap'),
  envelope: BridgeBootstrapEnvelopeSchema,
})

export type BridgeHostBootstrapMessage = z.infer<typeof BridgeHostBootstrapMessageSchema>

export const BridgeHostRenderMessageSchema = z.object({
  kind: z.literal('host.render'),
  bridgeSessionId: z.string(),
  appInstanceId: z.string(),
  renderId: z.string(),
  html: z.string(),
})

export type BridgeHostRenderMessage = z.infer<typeof BridgeHostRenderMessageSchema>

const BridgeAppEventBaseSchema = z.object({
  bridgeSessionId: z.string(),
  appInstanceId: z.string(),
  bridgeToken: z.string(),
  sequence: z.number().int().positive(),
})

export const BridgeAppReadyEventSchema = BridgeAppEventBaseSchema.extend({
  kind: z.literal('app.ready'),
  ackNonce: z.string(),
})

export const BridgeAppStateEventSchema = BridgeAppEventBaseSchema.extend({
  kind: z.literal('app.state'),
  idempotencyKey: z.string().min(1),
  snapshot: z.record(z.string(), z.unknown()).optional(),
})

export const BridgeAppCompleteEventSchema = BridgeAppEventBaseSchema.extend({
  kind: z.literal('app.complete'),
  idempotencyKey: z.string().min(1),
  completion: ChatBridgeCompletionPayloadSchema,
})

export const BridgeAppErrorEventSchema = BridgeAppEventBaseSchema.extend({
  kind: z.literal('app.error'),
  idempotencyKey: z.string().min(1),
  error: z.string().optional(),
})

export const BridgeAppEventSchema = z.discriminatedUnion('kind', [
  BridgeAppReadyEventSchema,
  BridgeAppStateEventSchema,
  BridgeAppCompleteEventSchema,
  BridgeAppErrorEventSchema,
])

export type BridgeAppEvent = z.infer<typeof BridgeAppEventSchema>
export type BridgeReadyEvent = z.infer<typeof BridgeAppReadyEventSchema>

export type BridgeEventValidationReason =
  | 'unexpected-bridge-session'
  | 'unexpected-app-instance'
  | 'invalid-bridge-token'
  | 'invalid-bootstrap-nonce'
  | 'session-expired'
  | 'session-not-ready'
  | 'replayed-sequence'
  | 'duplicate-idempotency-key'

export type BridgeSessionState = {
  envelope: BridgeBootstrapEnvelope
  acknowledgedAt?: number
  lastAcceptedSequence: number
  acceptedIdempotencyKeys: Set<string>
}

export type BridgeEventValidationResult =
  | {
      accepted: true
      session: BridgeSessionState
    }
  | {
      accepted: false
      reason: BridgeEventValidationReason
      session: BridgeSessionState
    }

type CreateBridgeSessionOptions = {
  now?: () => number
  ttlMs?: number
  createId?: () => string
}

type CreateBridgeSessionInput = {
  appId: string
  appInstanceId: string
  expectedOrigin: string
  capabilities: BridgeSessionCapability[]
}

function defaultCreateId() {
  return crypto.randomUUID()
}

function isExpired(session: BridgeSessionState, now: number) {
  return session.envelope.expiresAt <= now
}

function validateBaseEvent(session: BridgeSessionState, event: BridgeAppEvent, now: number): BridgeEventValidationReason | null {
  if (session.envelope.bridgeSessionId !== event.bridgeSessionId) {
    return 'unexpected-bridge-session'
  }
  if (session.envelope.appInstanceId !== event.appInstanceId) {
    return 'unexpected-app-instance'
  }
  if (session.envelope.bridgeToken !== event.bridgeToken) {
    return 'invalid-bridge-token'
  }
  if (isExpired(session, now)) {
    return 'session-expired'
  }
  return null
}

function reject(session: BridgeSessionState, reason: BridgeEventValidationReason): BridgeEventValidationResult {
  return {
    accepted: false,
    reason,
    session,
  }
}

export function createBridgeSession(
  input: CreateBridgeSessionInput,
  options: CreateBridgeSessionOptions = {}
): {
  session: BridgeSessionState
  envelope: BridgeBootstrapEnvelope
} {
  const now = options.now?.() ?? Date.now()
  const ttlMs = options.ttlMs ?? 60_000
  const createId = options.createId ?? defaultCreateId

  const envelope = BridgeBootstrapEnvelopeSchema.parse({
    bridgeSessionId: createId(),
    appId: input.appId,
    appInstanceId: input.appInstanceId,
    expectedOrigin: input.expectedOrigin,
    protocolVersion: CHATBRIDGE_PROTOCOL_VERSION,
    capabilities: input.capabilities,
    expiresAt: now + ttlMs,
    bridgeToken: createId(),
    bootstrapNonce: createId(),
    issuedAt: now,
  })

  return {
    envelope,
    session: {
      envelope,
      lastAcceptedSequence: 0,
      acceptedIdempotencyKeys: new Set<string>(),
    },
  }
}

export function acknowledgeBridgeSession(
  session: BridgeSessionState,
  event: BridgeReadyEvent,
  options: Pick<CreateBridgeSessionOptions, 'now'> = {}
): BridgeEventValidationResult {
  const now = options.now?.() ?? Date.now()
  const baseFailure = validateBaseEvent(session, event, now)
  if (baseFailure) {
    return reject(session, baseFailure)
  }
  if (event.ackNonce !== session.envelope.bootstrapNonce) {
    return reject(session, 'invalid-bootstrap-nonce')
  }
  if (event.sequence <= session.lastAcceptedSequence) {
    return reject(session, 'replayed-sequence')
  }

  return {
    accepted: true,
    session: {
      ...session,
      acknowledgedAt: now,
      lastAcceptedSequence: event.sequence,
    },
  }
}

export function acceptBridgeAppEvent(
  session: BridgeSessionState,
  event: Exclude<BridgeAppEvent, BridgeReadyEvent>,
  options: Pick<CreateBridgeSessionOptions, 'now'> = {}
): BridgeEventValidationResult {
  const now = options.now?.() ?? Date.now()
  const baseFailure = validateBaseEvent(session, event, now)
  if (baseFailure) {
    return reject(session, baseFailure)
  }
  if (!session.acknowledgedAt) {
    return reject(session, 'session-not-ready')
  }
  if (event.sequence <= session.lastAcceptedSequence) {
    return reject(session, 'replayed-sequence')
  }
  if (session.acceptedIdempotencyKeys.has(event.idempotencyKey)) {
    return reject(session, 'duplicate-idempotency-key')
  }

  const nextKeys = new Set(session.acceptedIdempotencyKeys)
  nextKeys.add(event.idempotencyKey)

  return {
    accepted: true,
    session: {
      ...session,
      lastAcceptedSequence: event.sequence,
      acceptedIdempotencyKeys: nextKeys,
    },
  }
}
