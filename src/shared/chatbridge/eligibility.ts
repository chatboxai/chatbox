import { ZodError, z } from 'zod'
import { ReviewedAppCatalogEntrySchema, type ReviewedAppCatalogEntry } from './manifest'
import { ChatBridgePolicySnapshotSchema, evaluateChatBridgePolicyForApp } from './policy'

const HOST_CONTEXT_PATTERN = /^[a-z0-9._:-]+$/i

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

function formatZodIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
    return `${path}: ${issue.message}`
  })
}

export const ChatBridgeEligibilityContextSchema = z
  .object({
    tenantId: z.string().trim().regex(HOST_CONTEXT_PATTERN).optional(),
    teacherId: z.string().trim().regex(HOST_CONTEXT_PATTERN).optional(),
    classroomId: z.string().trim().regex(HOST_CONTEXT_PATTERN).optional(),
    additionalContextTokens: z.array(z.string().trim().regex(HOST_CONTEXT_PATTERN)).default([]),
    teacherApproved: z.boolean().default(false),
    grantedPermissions: z.array(z.string().trim().min(1)).default([]),
    policySnapshot: ChatBridgePolicySnapshotSchema.optional(),
  })
  .strict()

export type ChatBridgeEligibilityContext = z.infer<typeof ChatBridgeEligibilityContextSchema>

export const ChatBridgeEligibilityReasonCodeSchema = z.enum([
  'invalid-context',
  'context-denied',
  'context-not-allowed',
  'teacher-approval-required',
  'required-permissions-missing',
  'policy-stale',
  'policy-denied',
  'policy-not-allowed',
])

export type ChatBridgeEligibilityReasonCode = z.infer<typeof ChatBridgeEligibilityReasonCodeSchema>

export const ChatBridgeEligibilityReasonSchema = z
  .object({
    code: ChatBridgeEligibilityReasonCodeSchema,
    message: z.string().trim().min(1),
    details: z.array(z.string().trim().min(1)).optional(),
  })
  .strict()

export type ChatBridgeEligibilityReason = z.infer<typeof ChatBridgeEligibilityReasonSchema>

export const ReviewedAppRouterCandidateSchema = z
  .object({
    entry: ReviewedAppCatalogEntrySchema,
    matchedContexts: z.array(z.string().trim().regex(HOST_CONTEXT_PATTERN)).default([]),
  })
  .strict()

export type ReviewedAppRouterCandidate = z.infer<typeof ReviewedAppRouterCandidateSchema>

export const ReviewedAppEligibilityDecisionSchema = z
  .object({
    entry: ReviewedAppCatalogEntrySchema,
    eligible: z.boolean(),
    matchedContexts: z.array(z.string().trim().regex(HOST_CONTEXT_PATTERN)).default([]),
    reasons: z.array(ChatBridgeEligibilityReasonSchema).default([]),
  })
  .strict()

export type ReviewedAppEligibilityDecision = z.infer<typeof ReviewedAppEligibilityDecisionSchema>

export const ReviewedAppEligibilityResultSchema = z
  .object({
    context: ChatBridgeEligibilityContextSchema.nullable(),
    contextIssues: z.array(z.string().trim().min(1)).default([]),
    candidates: z.array(ReviewedAppRouterCandidateSchema),
    decisions: z.array(ReviewedAppEligibilityDecisionSchema),
  })
  .strict()

export type ReviewedAppEligibilityResult = z.infer<typeof ReviewedAppEligibilityResultSchema>

function createReason(
  code: ChatBridgeEligibilityReasonCode,
  message: string,
  details?: string[]
): ChatBridgeEligibilityReason {
  const normalizedDetails = details ? dedupeInOrder(details.map((detail) => detail.trim()).filter(Boolean)) : []
  return normalizedDetails.length > 0 ? { code, message, details: normalizedDetails } : { code, message }
}

export function getChatBridgeEligibilityContextTokens(context: ChatBridgeEligibilityContext): string[] {
  const tokens = [
    context.tenantId ? `tenant:${context.tenantId}` : null,
    context.teacherId ? `teacher:${context.teacherId}` : null,
    context.classroomId ? `classroom:${context.classroomId}` : null,
    ...context.additionalContextTokens,
  ].filter((value): value is string => Boolean(value))

  return dedupeInOrder(tokens)
}

function getMatchedContexts(entry: ReviewedAppCatalogEntry, activeContextTokens: Set<string>): string[] {
  return entry.manifest.tenantAvailability.allow.filter((contextToken) => activeContextTokens.has(contextToken))
}

function getMissingRequiredPermissions(
  entry: ReviewedAppCatalogEntry,
  grantedPermissions: Set<string>
): string[] {
  return entry.manifest.permissions
    .filter((permission) => permission.required && !grantedPermissions.has(permission.id))
    .map((permission) => permission.id)
}

export function evaluateReviewedAppEligibility(
  entry: ReviewedAppCatalogEntry,
  context: ChatBridgeEligibilityContext
): ReviewedAppEligibilityDecision {
  const contextTokens = getChatBridgeEligibilityContextTokens(context)
  const activeContextTokens = new Set(contextTokens)
  const matchedContexts = getMatchedContexts(entry, activeContextTokens)
  const deniedContexts = entry.manifest.tenantAvailability.deny.filter((contextToken) => activeContextTokens.has(contextToken))
  const missingRequiredPermissions = getMissingRequiredPermissions(entry, new Set(context.grantedPermissions))
  const reasons: ChatBridgeEligibilityReason[] = []

  if (deniedContexts.length > 0) {
    reasons.push(
      createReason('context-denied', 'App availability is explicitly denied for the current host context.', deniedContexts)
    )
  }

  if (entry.manifest.safetyMetadata.requiresTeacherApproval && !context.teacherApproved) {
    reasons.push(
      createReason(
        'teacher-approval-required',
        'Teacher approval is required before this reviewed app can enter the candidate list.'
      )
    )
  }

  if (missingRequiredPermissions.length > 0) {
    reasons.push(
      createReason(
        'required-permissions-missing',
        'Required reviewed-app permissions are not available in the current host context.',
        missingRequiredPermissions
      )
    )
  }

  if (entry.manifest.tenantAvailability.default === 'disabled' && matchedContexts.length === 0) {
    reasons.push(
      createReason(
        'context-not-allowed',
        'App availability defaults to disabled and no allowed host context matched the current request.',
        entry.manifest.tenantAvailability.allow
      )
    )
  }

  const policyDecision = evaluateChatBridgePolicyForApp(entry.manifest.appId, context)
  for (const policyReason of policyDecision.reasons) {
    reasons.push(createReason(policyReason.code, policyReason.message, policyReason.details))
  }

  return {
    entry,
    eligible: reasons.length === 0,
    matchedContexts,
    reasons,
  }
}

export function resolveReviewedAppEligibility(
  entries: ReviewedAppCatalogEntry[],
  contextInput: unknown
): ReviewedAppEligibilityResult {
  const parsedContext = ChatBridgeEligibilityContextSchema.safeParse(contextInput)
  if (!parsedContext.success) {
    const issues = formatZodIssues(parsedContext.error)
    return {
      context: null,
      contextIssues: issues,
      candidates: [],
      decisions: entries.map((entry) => ({
        entry,
        eligible: false,
        matchedContexts: [],
        reasons: [
          createReason('invalid-context', 'Eligibility context failed validation and was rejected.', issues),
        ],
      })),
    }
  }

  const context = parsedContext.data
  const decisions = entries.map((entry) => evaluateReviewedAppEligibility(entry, context))

  return {
    context,
    contextIssues: [],
    candidates: decisions
      .filter((decision) => decision.eligible)
      .map((decision) => ({
        entry: decision.entry,
        matchedContexts: decision.matchedContexts,
      })),
    decisions,
  }
}
