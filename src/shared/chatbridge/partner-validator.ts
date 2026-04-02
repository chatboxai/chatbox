import { z } from 'zod'
import { CHATBRIDGE_PROTOCOL_VERSION } from './bridge-session'
import { CHATBRIDGE_COMPLETION_SCHEMA_VERSION } from './completion'
import {
  ChatBridgeAuthBoundarySchema,
  resolveChatBridgeAuthBoundary,
} from './auth'
import {
  CHATBRIDGE_AUTH_MODES,
  CHATBRIDGE_COMPLETION_MODES,
  CHATBRIDGE_EVENTS,
  ChatBridgeAuthModeSchema,
  ChatBridgeCompletionModeSchema,
  ChatBridgeEventSchema,
  ReviewedAppCatalogEntrySchema,
  type ReviewedAppCatalogEntry,
  SUPPORTED_CHATBRIDGE_PROTOCOL_VERSION,
} from './manifest'
import {
  assertReviewedAppCatalogEntrySupported,
  normalizeReviewedAppCatalogEntry,
  type ReviewedAppRegistrySupport,
  ReviewedAppRegistryError,
} from './registry'

const ChatBridgePartnerIssueSeveritySchema = z.enum(['error', 'warning'])
export type ChatBridgePartnerIssueSeverity = z.infer<typeof ChatBridgePartnerIssueSeveritySchema>

export const ChatBridgePartnerValidationIssueCodeSchema = z.enum([
  'invalid-manifest',
  'unsupported-protocol-version',
  'unsupported-auth-mode',
  'unsupported-event',
  'unsupported-completion-mode',
  'missing-host-init',
  'missing-app-ready',
  'missing-app-complete',
  'missing-app-request-auth',
  'missing-app-state',
  'missing-app-error',
])
export type ChatBridgePartnerValidationIssueCode = z.infer<typeof ChatBridgePartnerValidationIssueCodeSchema>

export const ChatBridgePartnerValidationIssueSchema = z
  .object({
    code: ChatBridgePartnerValidationIssueCodeSchema,
    severity: ChatBridgePartnerIssueSeveritySchema,
    message: z.string().trim().min(1),
    details: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
export type ChatBridgePartnerValidationIssue = z.infer<typeof ChatBridgePartnerValidationIssueSchema>

export const ChatBridgePartnerSupportedContractSchema = z
  .object({
    protocolVersions: z.array(z.number().int().positive()).min(1),
    authModes: z.array(ChatBridgeAuthModeSchema).min(1),
    supportedEvents: z.array(ChatBridgeEventSchema).min(1),
    completionModes: z.array(ChatBridgeCompletionModeSchema).min(1),
  })
  .strict()
export type ChatBridgePartnerSupportedContract = z.infer<typeof ChatBridgePartnerSupportedContractSchema>

export const ChatBridgePartnerBridgeRuntimeEventSchema = z.enum([
  'app.ready',
  'app.state',
  'app.complete',
  'app.error',
])
export type ChatBridgePartnerBridgeRuntimeEvent = z.infer<typeof ChatBridgePartnerBridgeRuntimeEventSchema>

export const ChatBridgePartnerContractGuidanceSchema = z
  .object({
    bridgeProtocol: z.literal(CHATBRIDGE_PROTOCOL_VERSION),
    bridgeRuntimeEvents: z.array(ChatBridgePartnerBridgeRuntimeEventSchema).min(1),
    requiredManifestEvents: z.array(ChatBridgeEventSchema).min(1),
    recommendedManifestEvents: z.array(ChatBridgeEventSchema).default([]),
    authBoundary: ChatBridgeAuthBoundarySchema,
    completionSchemaVersion: z.literal(CHATBRIDGE_COMPLETION_SCHEMA_VERSION),
    completionModes: z.array(ChatBridgeCompletionModeSchema).min(1),
    hostSummaryRule: z.string().trim().min(1),
    debuggingChecklist: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
export type ChatBridgePartnerContractGuidance = z.infer<typeof ChatBridgePartnerContractGuidanceSchema>

export const ChatBridgePartnerManifestValidationReportSchema = z
  .object({
    valid: z.boolean(),
    entry: ReviewedAppCatalogEntrySchema.nullable(),
    issues: z.array(ChatBridgePartnerValidationIssueSchema).default([]),
    support: ChatBridgePartnerSupportedContractSchema,
    guidance: ChatBridgePartnerContractGuidanceSchema.nullable(),
  })
  .strict()
export type ChatBridgePartnerManifestValidationReport = z.infer<
  typeof ChatBridgePartnerManifestValidationReportSchema
>

function dedupeInOrder<T>(values: T[]): T[] {
  const seen = new Set<T>()
  const deduped: T[] = []

  for (const value of values) {
    if (seen.has(value)) {
      continue
    }
    seen.add(value)
    deduped.push(value)
  }

  return deduped
}

function createIssue(
  code: ChatBridgePartnerValidationIssueCode,
  severity: ChatBridgePartnerIssueSeverity,
  message: string,
  details?: string[]
): ChatBridgePartnerValidationIssue {
  return ChatBridgePartnerValidationIssueSchema.parse({
    code,
    severity,
    message,
    details: dedupeInOrder((details ?? []).map((detail) => detail.trim()).filter(Boolean)),
  })
}

function resolvePartnerSupport(options?: ReviewedAppRegistrySupport): ChatBridgePartnerSupportedContract {
  return ChatBridgePartnerSupportedContractSchema.parse({
    protocolVersions: options?.protocolVersions ?? [SUPPORTED_CHATBRIDGE_PROTOCOL_VERSION],
    authModes: options?.authModes ?? [...CHATBRIDGE_AUTH_MODES],
    supportedEvents: options?.supportedEvents ?? [...CHATBRIDGE_EVENTS],
    completionModes: options?.completionModes ?? [...CHATBRIDGE_COMPLETION_MODES],
  })
}

function mapRegistryError(error: ReviewedAppRegistryError): ChatBridgePartnerValidationIssue {
  return createIssue(error.code, 'error', error.message, error.details)
}

function createGuidance(entry: ReviewedAppCatalogEntry): ChatBridgePartnerContractGuidance {
  const authBoundary = resolveChatBridgeAuthBoundary({
    appId: entry.manifest.appId,
    authMode: entry.manifest.authMode,
  })

  const requiredManifestEvents = dedupeInOrder([
    'host.init',
    'app.ready',
    'app.complete',
    ...(authBoundary.appGrantRequired ? (['app.requestAuth'] as const) : []),
  ])

  const recommendedManifestEvents = dedupeInOrder(
    (['app.state', 'app.error'] as const).filter((event) => !requiredManifestEvents.includes(event))
  )

  return ChatBridgePartnerContractGuidanceSchema.parse({
    bridgeProtocol: CHATBRIDGE_PROTOCOL_VERSION,
    bridgeRuntimeEvents: ['app.ready', 'app.state', 'app.complete', 'app.error'],
    requiredManifestEvents,
    recommendedManifestEvents,
    authBoundary,
    completionSchemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
    completionModes: entry.manifest.completionModes,
    hostSummaryRule:
      'Apps may suggest summaries in app.complete payloads, but only the host may write summaryForModel or promote context into later turns.',
    debuggingChecklist: [
      'Validate the reviewed manifest before asking for platform review.',
      'Treat host.bootstrap as the launch-scoped bridge envelope and only acknowledge it once expectedOrigin, bridgeToken, and bootstrapNonce match.',
      'Send monotonically increasing bridge sequence numbers and unique idempotency keys for app.state, app.complete, and app.error.',
      'For oauth or api-key apps, request access through the host-managed auth flow and never store raw long-lived credentials inside the partner runtime.',
      `Emit app.complete with completion schema version ${CHATBRIDGE_COMPLETION_SCHEMA_VERSION} and keep model-visible memory host-owned.`,
    ],
  })
}

function pushMissingEventIssues(
  entry: ReviewedAppCatalogEntry,
  issues: ChatBridgePartnerValidationIssue[]
) {
  const supportedEvents = new Set(entry.manifest.supportedEvents)

  if (!supportedEvents.has('host.init')) {
    issues.push(
      createIssue(
        'missing-host-init',
        'error',
        'Reviewed partner manifests must declare host.init so the host bootstrap contract stays explicit.'
      )
    )
  }

  if (!supportedEvents.has('app.ready')) {
    issues.push(
      createIssue(
        'missing-app-ready',
        'error',
        'Reviewed partner manifests must declare app.ready so the host can confirm the runtime acknowledged the launch-scoped bridge session.'
      )
    )
  }

  if (!supportedEvents.has('app.complete')) {
    issues.push(
      createIssue(
        'missing-app-complete',
        'error',
        'Reviewed partner manifests must declare app.complete because completion signaling is mandatory before the host can normalize post-app memory.'
      )
    )
  }

  const authBoundary = resolveChatBridgeAuthBoundary({
    appId: entry.manifest.appId,
    authMode: entry.manifest.authMode,
  })

  if (authBoundary.appGrantRequired && !supportedEvents.has('app.requestAuth')) {
    issues.push(
      createIssue(
        'missing-app-request-auth',
        'error',
        'OAuth and API-key reviewed apps must declare app.requestAuth so the host-managed credential flow stays explicit.'
      )
    )
  }

  if (!supportedEvents.has('app.state')) {
    issues.push(
      createIssue(
        'missing-app-state',
        'warning',
        'The manifest omits app.state. The app can still launch, but partners lose the standard way to expose resumable snapshots and mid-session debugging context.'
      )
    )
  }

  if (!supportedEvents.has('app.error')) {
    issues.push(
      createIssue(
        'missing-app-error',
        'warning',
        'The manifest omits app.error. Runtime failures can still surface through transport errors, but explicit degraded recovery works better when the app can report app.error.'
      )
    )
  }
}

export function validateChatBridgePartnerManifest(
  entryInput: unknown,
  options?: ReviewedAppRegistrySupport
): ChatBridgePartnerManifestValidationReport {
  const support = resolvePartnerSupport(options)
  const issues: ChatBridgePartnerValidationIssue[] = []
  let entry: ReviewedAppCatalogEntry | null = null

  try {
    entry = normalizeReviewedAppCatalogEntry(entryInput)
  } catch (error) {
    if (error instanceof ReviewedAppRegistryError) {
      issues.push(mapRegistryError(error))
      return ChatBridgePartnerManifestValidationReportSchema.parse({
        valid: false,
        entry: null,
        issues,
        support,
        guidance: null,
      })
    }

    throw error
  }

  try {
    assertReviewedAppCatalogEntrySupported(entry, options)
  } catch (error) {
    if (error instanceof ReviewedAppRegistryError) {
      issues.push(mapRegistryError(error))
    } else {
      throw error
    }
  }

  pushMissingEventIssues(entry, issues)
  const hasErrors = issues.some((issue) => issue.severity === 'error')

  return ChatBridgePartnerManifestValidationReportSchema.parse({
    valid: !hasErrors,
    entry,
    issues,
    support,
    guidance: createGuidance(entry),
  })
}
