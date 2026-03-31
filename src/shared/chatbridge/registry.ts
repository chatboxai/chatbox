import { ZodError } from 'zod'
import {
  CHATBRIDGE_AUTH_MODES,
  CHATBRIDGE_COMPLETION_MODES,
  CHATBRIDGE_EVENTS,
  type ChatBridgeAuthMode,
  type ChatBridgeCompletionMode,
  type ChatBridgeEvent,
  type ChatBridgeTenantAvailability,
  type ReviewedAppCatalogEntry,
  ReviewedAppCatalogEntrySchema,
  SUPPORTED_CHATBRIDGE_PROTOCOL_VERSION,
} from './manifest'

export type ReviewedAppRegistryErrorCode =
  | 'invalid-manifest'
  | 'unsupported-protocol-version'
  | 'unsupported-auth-mode'
  | 'unsupported-event'
  | 'unsupported-completion-mode'

export class ReviewedAppRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: ReviewedAppRegistryErrorCode,
    public readonly details?: string[]
  ) {
    super(message)
    this.name = 'ReviewedAppRegistryError'
  }
}

export interface ReviewedAppRegistrySupport {
  protocolVersions?: number[]
  authModes?: ChatBridgeAuthMode[]
  supportedEvents?: ChatBridgeEvent[]
  completionModes?: ChatBridgeCompletionMode[]
}

const DEFAULT_REVIEWED_APP_REGISTRY_SUPPORT: Required<ReviewedAppRegistrySupport> = {
  protocolVersions: [SUPPORTED_CHATBRIDGE_PROTOCOL_VERSION],
  authModes: [...CHATBRIDGE_AUTH_MODES],
  supportedEvents: [...CHATBRIDGE_EVENTS],
  completionModes: [...CHATBRIDGE_COMPLETION_MODES],
}

const reviewedAppRegistry = new Map<string, ReviewedAppCatalogEntry>()

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

function normalizeAvailability(availability: ChatBridgeTenantAvailability): ChatBridgeTenantAvailability {
  return {
    default: availability.default,
    allow: dedupeInOrder(availability.allow),
    deny: dedupeInOrder(availability.deny),
  }
}

function resolveSupport(options?: ReviewedAppRegistrySupport): Required<ReviewedAppRegistrySupport> {
  return {
    protocolVersions: options?.protocolVersions ?? DEFAULT_REVIEWED_APP_REGISTRY_SUPPORT.protocolVersions,
    authModes: options?.authModes ?? DEFAULT_REVIEWED_APP_REGISTRY_SUPPORT.authModes,
    supportedEvents: options?.supportedEvents ?? DEFAULT_REVIEWED_APP_REGISTRY_SUPPORT.supportedEvents,
    completionModes: options?.completionModes ?? DEFAULT_REVIEWED_APP_REGISTRY_SUPPORT.completionModes,
  }
}

function formatZodIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
    return `${path}: ${issue.message}`
  })
}

export function normalizeReviewedAppCatalogEntry(input: unknown): ReviewedAppCatalogEntry {
  try {
    const parsed = ReviewedAppCatalogEntrySchema.parse(input)
    return {
      manifest: {
        ...parsed.manifest,
        supportedEvents: dedupeInOrder(parsed.manifest.supportedEvents),
        completionModes: dedupeInOrder(parsed.manifest.completionModes),
        tenantAvailability: normalizeAvailability(parsed.manifest.tenantAvailability),
      },
      approval: parsed.approval,
    }
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ReviewedAppRegistryError('Invalid reviewed app manifest', 'invalid-manifest', formatZodIssues(error))
    }
    throw error
  }
}

export function assertReviewedAppCatalogEntrySupported(
  entry: ReviewedAppCatalogEntry,
  options?: ReviewedAppRegistrySupport
): ReviewedAppCatalogEntry {
  const support = resolveSupport(options)

  if (!support.protocolVersions.includes(entry.manifest.protocolVersion)) {
    throw new ReviewedAppRegistryError(
      `Unsupported ChatBridge protocol version: ${entry.manifest.protocolVersion}`,
      'unsupported-protocol-version'
    )
  }

  if (!support.authModes.includes(entry.manifest.authMode)) {
    throw new ReviewedAppRegistryError(`Unsupported auth mode: ${entry.manifest.authMode}`, 'unsupported-auth-mode')
  }

  const unsupportedEvents = entry.manifest.supportedEvents.filter((event) => !support.supportedEvents.includes(event))
  if (unsupportedEvents.length > 0) {
    throw new ReviewedAppRegistryError(
      `Unsupported bridge events: ${unsupportedEvents.join(', ')}`,
      'unsupported-event',
      unsupportedEvents
    )
  }

  const unsupportedCompletionModes = entry.manifest.completionModes.filter(
    (mode) => !support.completionModes.includes(mode)
  )
  if (unsupportedCompletionModes.length > 0) {
    throw new ReviewedAppRegistryError(
      `Unsupported completion modes: ${unsupportedCompletionModes.join(', ')}`,
      'unsupported-completion-mode',
      unsupportedCompletionModes
    )
  }

  return entry
}

export function defineReviewedApp(entryInput: unknown, options?: ReviewedAppRegistrySupport): ReviewedAppCatalogEntry {
  const entry = assertReviewedAppCatalogEntrySupported(normalizeReviewedAppCatalogEntry(entryInput), options)

  if (reviewedAppRegistry.has(entry.manifest.appId)) {
    console.warn(`Reviewed ChatBridge app "${entry.manifest.appId}" is already registered. Overwriting.`)
  }

  reviewedAppRegistry.set(entry.manifest.appId, entry)
  return entry
}

export function defineReviewedApps(entriesInput: unknown[], options?: ReviewedAppRegistrySupport): ReviewedAppCatalogEntry[] {
  const normalizedEntries = entriesInput.map((entryInput) =>
    assertReviewedAppCatalogEntrySupported(normalizeReviewedAppCatalogEntry(entryInput), options)
  )

  for (const entry of normalizedEntries) {
    if (reviewedAppRegistry.has(entry.manifest.appId)) {
      console.warn(`Reviewed ChatBridge app "${entry.manifest.appId}" is already registered. Overwriting.`)
    }
  }

  for (const entry of normalizedEntries) {
    reviewedAppRegistry.set(entry.manifest.appId, entry)
  }

  return normalizedEntries
}

export function getReviewedApp(appId: string): ReviewedAppCatalogEntry | undefined {
  return reviewedAppRegistry.get(appId)
}

export function getReviewedAppCatalog(): ReviewedAppCatalogEntry[] {
  return Array.from(reviewedAppRegistry.values())
}

export function hasReviewedApp(appId: string): boolean {
  return reviewedAppRegistry.has(appId)
}

export function clearReviewedAppRegistry(): void {
  reviewedAppRegistry.clear()
}
