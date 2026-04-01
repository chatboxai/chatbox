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

export const BridgeAppEventBaseSchema = z.object({
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
  result: ChatBridgeCompletionPayloadSchema,
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
export type BridgeAppStateEvent = z.infer<typeof BridgeAppStateEventSchema>
export type BridgeAppCompleteEvent = z.infer<typeof BridgeAppCompleteEventSchema>
export type BridgeAppErrorEvent = z.infer<typeof BridgeAppErrorEventSchema>
