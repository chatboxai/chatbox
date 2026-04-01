import {
  type BridgeAppEvent,
  BridgeAppEventSchema,
  type BridgeBootstrapEnvelope,
  BridgeBootstrapEnvelopeSchema,
  type BridgeReadyEvent,
  type BridgeSessionCapability,
  CHATBRIDGE_PROTOCOL_VERSION,
} from './events'

export {
  type BridgeAppCompleteEvent,
  type BridgeAppErrorEvent,
  type BridgeAppEvent,
  BridgeAppEventSchema,
  type BridgeAppStateEvent,
  type BridgeBootstrapEnvelope,
  BridgeBootstrapEnvelopeSchema,
  BridgeHostBootstrapMessageSchema,
  type BridgeHostBootstrapMessage,
  BridgeHostRenderMessageSchema,
  type BridgeHostRenderMessage,
  BridgeSessionCapabilitySchema,
  type BridgeSessionCapability,
  BridgeAppCompleteEventSchema,
  BridgeAppErrorEventSchema,
  BridgeAppReadyEventSchema,
  type BridgeReadyEvent,
  BridgeAppStateEventSchema,
  CHATBRIDGE_PROTOCOL_VERSION,
} from './events'

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
