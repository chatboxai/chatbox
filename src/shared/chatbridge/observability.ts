import { z } from 'zod'
import { ReviewedAppCatalogEntrySchema, type ReviewedAppCatalogEntry } from './manifest'

export const CHATBRIDGE_OBSERVABILITY_SCHEMA_VERSION = 1 as const
const DEFAULT_OBSERVABILITY_EVENT_LIMIT = 200

export const ChatBridgeAppHealthStatusSchema = z.enum(['healthy', 'degraded', 'disabled'])
export type ChatBridgeAppHealthStatus = z.infer<typeof ChatBridgeAppHealthStatusSchema>

export const ChatBridgeObservabilitySeveritySchema = z.enum(['info', 'warn', 'error'])
export type ChatBridgeObservabilitySeverity = z.infer<typeof ChatBridgeObservabilitySeveritySchema>

export const ChatBridgeObservabilityEventKindSchema = z.enum([
  'session-attached',
  'session-ready',
  'host-render-sent',
  'app-event-accepted',
  'app-event-rejected',
  'app-event-invalid',
  'recovery-required',
  'kill-switch-applied',
  'kill-switch-cleared',
])
export type ChatBridgeObservabilityEventKind = z.infer<typeof ChatBridgeObservabilityEventKindSchema>

export const ChatBridgeObservabilityEventSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_OBSERVABILITY_SCHEMA_VERSION),
    eventId: z.string().trim().min(1),
    occurredAt: z.number().int().nonnegative(),
    kind: ChatBridgeObservabilityEventKindSchema,
    severity: ChatBridgeObservabilitySeveritySchema,
    status: ChatBridgeAppHealthStatusSchema,
    appId: z.string().trim().min(1),
    appName: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    appInstanceId: z.string().trim().min(1).optional(),
    bridgeSessionId: z.string().trim().min(1).optional(),
    traceCode: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1),
    details: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
export type ChatBridgeObservabilityEvent = z.infer<typeof ChatBridgeObservabilityEventSchema>

export const ChatBridgeAppHealthRecordSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_OBSERVABILITY_SCHEMA_VERSION),
    appId: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
    status: ChatBridgeAppHealthStatusSchema,
    updatedAt: z.number().int().nonnegative(),
    summary: z.string().trim().min(1),
    details: z.array(z.string().trim().min(1)).default([]),
    lastEventKind: ChatBridgeObservabilityEventKindSchema.optional(),
  })
  .strict()
export type ChatBridgeAppHealthRecord = z.infer<typeof ChatBridgeAppHealthRecordSchema>

export const ChatBridgeActiveSessionBehaviorSchema = z.enum(['allow-to-complete', 'recover-inline'])
export type ChatBridgeActiveSessionBehavior = z.infer<typeof ChatBridgeActiveSessionBehaviorSchema>

export const ChatBridgeAppKillSwitchSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_OBSERVABILITY_SCHEMA_VERSION),
    controlId: z.string().trim().min(1),
    appId: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1),
    disabledAt: z.number().int().nonnegative(),
    disabledBy: z.string().trim().min(1),
    activeSessionBehavior: ChatBridgeActiveSessionBehaviorSchema.default('allow-to-complete'),
  })
  .strict()
export type ChatBridgeAppKillSwitch = z.infer<typeof ChatBridgeAppKillSwitchSchema>

export const ChatBridgeLaunchControlReasonCodeSchema = z.enum(['available', 'app-disabled', 'app-version-disabled'])
export type ChatBridgeLaunchControlReasonCode = z.infer<typeof ChatBridgeLaunchControlReasonCodeSchema>

export const ChatBridgeLaunchControlDecisionSchema = z
  .object({
    appId: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
    allowed: z.boolean(),
    reasonCode: ChatBridgeLaunchControlReasonCodeSchema,
    summary: z.string().trim().min(1),
    activeSessionBehavior: ChatBridgeActiveSessionBehaviorSchema,
    killSwitch: ChatBridgeAppKillSwitchSchema.nullable().default(null),
    health: ChatBridgeAppHealthRecordSchema.nullable().default(null),
  })
  .strict()
export type ChatBridgeLaunchControlDecision = z.infer<typeof ChatBridgeLaunchControlDecisionSchema>

export const ChatBridgeActiveSessionDispositionSchema = z
  .object({
    appId: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
    action: z.enum(['continue', 'recover-inline']),
    summary: z.string().trim().min(1),
    killSwitch: ChatBridgeAppKillSwitchSchema.nullable().default(null),
    health: ChatBridgeAppHealthRecordSchema.nullable().default(null),
  })
  .strict()
export type ChatBridgeActiveSessionDisposition = z.infer<typeof ChatBridgeActiveSessionDispositionSchema>

const observabilityEvents: ChatBridgeObservabilityEvent[] = []
const healthRegistry = new Map<string, ChatBridgeAppHealthRecord>()
const killSwitchRegistry = new Map<string, ChatBridgeAppKillSwitch>()

function getRegistryKey(appId: string, version?: string) {
  return `${appId}::${version ?? '*'}`
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function trimDetails(details: string[] | undefined) {
  return Array.from(new Set((details ?? []).map((detail) => normalizeWhitespace(detail)).filter(Boolean)))
}

function updateHealthFromObservabilityEvent(event: ChatBridgeObservabilityEvent) {
  const nextHealth = ChatBridgeAppHealthRecordSchema.parse({
    schemaVersion: CHATBRIDGE_OBSERVABILITY_SCHEMA_VERSION,
    appId: event.appId,
    ...(event.version ? { version: event.version } : {}),
    status: event.status,
    updatedAt: event.occurredAt,
    summary: event.summary,
    details: event.details,
    lastEventKind: event.kind,
  })

  healthRegistry.set(getRegistryKey(nextHealth.appId, nextHealth.version), nextHealth)
  return nextHealth
}

function getHealthRecord(appId: string, version?: string) {
  return healthRegistry.get(getRegistryKey(appId, version)) ?? healthRegistry.get(getRegistryKey(appId))
}

function getKillSwitchKey(appId: string, version?: string) {
  return getRegistryKey(appId, version)
}

function getMatchingKillSwitch(appId: string, version?: string) {
  return killSwitchRegistry.get(getKillSwitchKey(appId, version)) ?? killSwitchRegistry.get(getKillSwitchKey(appId))
}

export function createChatBridgeObservabilityEvent(
  input: Omit<ChatBridgeObservabilityEvent, 'schemaVersion' | 'details'> & {
    details?: string[]
  }
) {
  return ChatBridgeObservabilityEventSchema.parse({
    ...input,
    schemaVersion: CHATBRIDGE_OBSERVABILITY_SCHEMA_VERSION,
    details: trimDetails(input.details),
  })
}

export function recordChatBridgeObservabilityEvent(
  input: Omit<ChatBridgeObservabilityEvent, 'schemaVersion' | 'details'> & {
    details?: string[]
  },
  options: { limit?: number } = {}
) {
  const event = createChatBridgeObservabilityEvent(input)
  observabilityEvents.push(event)

  const limit = Math.max(1, options.limit ?? DEFAULT_OBSERVABILITY_EVENT_LIMIT)
  while (observabilityEvents.length > limit) {
    observabilityEvents.shift()
  }

  updateHealthFromObservabilityEvent(event)
  return event
}

export function listChatBridgeObservabilityEvents(options: {
  appId?: string
  version?: string
  limit?: number
} = {}) {
  const filtered = observabilityEvents.filter((event) => {
    if (options.appId && event.appId !== options.appId) {
      return false
    }
    if (options.version && event.version !== options.version) {
      return false
    }
    return true
  })

  if (!options.limit || options.limit >= filtered.length) {
    return [...filtered]
  }

  return filtered.slice(-options.limit)
}

export function setChatBridgeAppHealthRecord(
  input: Omit<ChatBridgeAppHealthRecord, 'schemaVersion' | 'details'> & {
    details?: string[]
  }
) {
  const record = ChatBridgeAppHealthRecordSchema.parse({
    ...input,
    schemaVersion: CHATBRIDGE_OBSERVABILITY_SCHEMA_VERSION,
    details: trimDetails(input.details),
  })

  healthRegistry.set(getRegistryKey(record.appId, record.version), record)
  return record
}

export function getChatBridgeAppHealthRecord(appId: string, version?: string) {
  return getHealthRecord(appId, version) ?? null
}

export function applyChatBridgeAppKillSwitch(
  input: Omit<ChatBridgeAppKillSwitch, 'schemaVersion'>
) {
  const killSwitch = ChatBridgeAppKillSwitchSchema.parse({
    ...input,
    schemaVersion: CHATBRIDGE_OBSERVABILITY_SCHEMA_VERSION,
  })

  killSwitchRegistry.set(getKillSwitchKey(killSwitch.appId, killSwitch.version), killSwitch)
  recordChatBridgeObservabilityEvent({
    eventId: `${killSwitch.controlId}:applied`,
    occurredAt: killSwitch.disabledAt,
    kind: 'kill-switch-applied',
    severity: 'error',
    status: 'disabled',
    appId: killSwitch.appId,
    ...(killSwitch.version ? { version: killSwitch.version } : {}),
    summary: killSwitch.version
      ? `${killSwitch.appId} ${killSwitch.version} is disabled for new launches.`
      : `${killSwitch.appId} is disabled for new launches.`,
    details: [
      `reason: ${killSwitch.reason}`,
      `disabledBy: ${killSwitch.disabledBy}`,
      `activeSessions: ${killSwitch.activeSessionBehavior}`,
    ],
  })
  return killSwitch
}

export function clearChatBridgeAppKillSwitch(input: { appId: string; version?: string; clearedAt: number; clearedBy: string }) {
  const existing = getMatchingKillSwitch(input.appId, input.version)
  if (!existing) {
    return null
  }

  killSwitchRegistry.delete(getKillSwitchKey(existing.appId, existing.version))
  recordChatBridgeObservabilityEvent({
    eventId: `${existing.controlId}:cleared`,
    occurredAt: input.clearedAt,
    kind: 'kill-switch-cleared',
    severity: 'info',
    status: 'healthy',
    appId: existing.appId,
    ...(existing.version ? { version: existing.version } : {}),
    summary: existing.version
      ? `${existing.appId} ${existing.version} kill switch was cleared.`
      : `${existing.appId} kill switch was cleared.`,
    details: [`clearedBy: ${input.clearedBy}`],
  })
  return existing
}

export function getChatBridgeAppKillSwitch(appId: string, version?: string) {
  return getMatchingKillSwitch(appId, version) ?? null
}

export function listChatBridgeAppKillSwitches() {
  return Array.from(killSwitchRegistry.values())
}

export function evaluateReviewedAppLaunchControl(entryInput: ReviewedAppCatalogEntry): ChatBridgeLaunchControlDecision {
  const entry = ReviewedAppCatalogEntrySchema.parse(entryInput)
  const killSwitch = getMatchingKillSwitch(entry.manifest.appId, entry.manifest.version)
  const health = getHealthRecord(entry.manifest.appId, entry.manifest.version) ?? null

  if (!killSwitch) {
    return ChatBridgeLaunchControlDecisionSchema.parse({
      appId: entry.manifest.appId,
      version: entry.manifest.version,
      allowed: true,
      reasonCode: 'available',
      summary: `${entry.manifest.name} is available for reviewed launches.`,
      activeSessionBehavior: 'allow-to-complete',
      killSwitch: null,
      health,
    })
  }

  const isVersionScoped = typeof killSwitch.version === 'string'
  return ChatBridgeLaunchControlDecisionSchema.parse({
    appId: entry.manifest.appId,
    version: entry.manifest.version,
    allowed: false,
    reasonCode: isVersionScoped ? 'app-version-disabled' : 'app-disabled',
    summary: isVersionScoped
      ? `${entry.manifest.name} ${entry.manifest.version} is disabled for new launches while active-session behavior remains explicit.`
      : `${entry.manifest.name} is disabled for new launches while active-session behavior remains explicit.`,
    activeSessionBehavior: killSwitch.activeSessionBehavior,
    killSwitch,
    health,
  })
}

export function evaluateReviewedAppActiveSessionDisposition(input: {
  appId: string
  version?: string
  appName?: string
}): ChatBridgeActiveSessionDisposition {
  const killSwitch = getMatchingKillSwitch(input.appId, input.version)
  const health = getHealthRecord(input.appId, input.version) ?? null
  const label = normalizeWhitespace(input.appName ?? input.appId) || input.appId

  if (!killSwitch) {
    return ChatBridgeActiveSessionDispositionSchema.parse({
      appId: input.appId,
      ...(input.version ? { version: input.version } : {}),
      action: 'continue',
      summary: `${label} has no active kill switch, so active sessions can continue normally.`,
      killSwitch: null,
      health,
    })
  }

  if (killSwitch.activeSessionBehavior === 'recover-inline') {
    return ChatBridgeActiveSessionDispositionSchema.parse({
      appId: input.appId,
      ...(input.version ? { version: input.version } : {}),
      action: 'recover-inline',
      summary: `${label} is disabled for new launches and active sessions should transition into host-owned recovery.`,
      killSwitch,
      health,
    })
  }

  return ChatBridgeActiveSessionDispositionSchema.parse({
    appId: input.appId,
    ...(input.version ? { version: input.version } : {}),
    action: 'continue',
    summary: `${label} is disabled for new launches, but active sessions may continue to completion.`,
    killSwitch,
    health,
  })
}

export function clearChatBridgeObservabilityState() {
  observabilityEvents.length = 0
  healthRegistry.clear()
  killSwitchRegistry.clear()
}
