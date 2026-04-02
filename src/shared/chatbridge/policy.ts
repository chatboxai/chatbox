import { z } from 'zod'

const POLICY_ID_PATTERN = /^[a-z0-9._:-]+$/i

export const CHATBRIDGE_POLICY_SCHEMA_VERSION = 1 as const

export const ChatBridgePolicyScopeSchema = z.enum(['tenant', 'teacher', 'classroom'])
export type ChatBridgePolicyScope = z.infer<typeof ChatBridgePolicyScopeSchema>

export const ChatBridgePolicyReasonCodeSchema = z.enum([
  'policy-stale',
  'policy-denied',
  'policy-not-allowed',
])
export type ChatBridgePolicyReasonCode = z.infer<typeof ChatBridgePolicyReasonCodeSchema>

export const ChatBridgePolicyReasonSchema = z
  .object({
    code: ChatBridgePolicyReasonCodeSchema,
    scope: ChatBridgePolicyScopeSchema,
    message: z.string().trim().min(1),
    details: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
export type ChatBridgePolicyReason = z.infer<typeof ChatBridgePolicyReasonSchema>

export const ChatBridgePolicyRuleSetSchema = z
  .object({
    allowAppIds: z.array(z.string().trim().min(1)).default([]),
    denyAppIds: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
export type ChatBridgePolicyRuleSet = z.infer<typeof ChatBridgePolicyRuleSetSchema>

export const ChatBridgePolicyTeacherRuleSchema = z
  .object({
    teacherId: z.string().trim().regex(POLICY_ID_PATTERN),
    rules: ChatBridgePolicyRuleSetSchema,
  })
  .strict()
export type ChatBridgePolicyTeacherRule = z.infer<typeof ChatBridgePolicyTeacherRuleSchema>

export const ChatBridgePolicyClassroomRuleSchema = z
  .object({
    classroomId: z.string().trim().regex(POLICY_ID_PATTERN),
    rules: ChatBridgePolicyRuleSetSchema,
  })
  .strict()
export type ChatBridgePolicyClassroomRule = z.infer<typeof ChatBridgePolicyClassroomRuleSchema>

export const ChatBridgePolicySnapshotSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_POLICY_SCHEMA_VERSION),
    tenantId: z.string().trim().regex(POLICY_ID_PATTERN),
    fetchedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    tenant: ChatBridgePolicyRuleSetSchema,
    teacher: ChatBridgePolicyTeacherRuleSchema.optional(),
    classroom: ChatBridgePolicyClassroomRuleSchema.optional(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.expiresAt < snapshot.fetchedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expiresAt cannot be earlier than fetchedAt',
        path: ['expiresAt'],
      })
    }
  })
export type ChatBridgePolicySnapshot = z.infer<typeof ChatBridgePolicySnapshotSchema>

export const ChatBridgePolicyEvaluationContextSchema = z
  .object({
    tenantId: z.string().trim().regex(POLICY_ID_PATTERN).optional(),
    teacherId: z.string().trim().regex(POLICY_ID_PATTERN).optional(),
    classroomId: z.string().trim().regex(POLICY_ID_PATTERN).optional(),
    policySnapshot: ChatBridgePolicySnapshotSchema.optional(),
  })
  .strict()
export type ChatBridgePolicyEvaluationContext = z.infer<typeof ChatBridgePolicyEvaluationContextSchema>

export const ChatBridgePolicyDecisionSchema = z
  .object({
    appId: z.string().trim().min(1),
    allowed: z.boolean(),
    stale: z.boolean().default(false),
    appliedScopes: z.array(ChatBridgePolicyScopeSchema).default([]),
    reasons: z.array(ChatBridgePolicyReasonSchema).default([]),
  })
  .strict()
export type ChatBridgePolicyDecision = z.infer<typeof ChatBridgePolicyDecisionSchema>

function normalizeUnique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function createReason(
  code: ChatBridgePolicyReasonCode,
  scope: ChatBridgePolicyScope,
  message: string,
  details: string[] = []
): ChatBridgePolicyReason {
  return {
    code,
    scope,
    message,
    details: normalizeUnique(details),
  }
}

export function isChatBridgePolicySnapshotStale(
  snapshot: ChatBridgePolicySnapshot,
  options: { now?: number } = {}
): boolean {
  const now = options.now ?? Date.now()
  return snapshot.expiresAt <= now
}

function evaluateRuleSet(
  appId: string,
  scope: ChatBridgePolicyScope,
  rules: ChatBridgePolicyRuleSet
): ChatBridgePolicyReason | null {
  const allowAppIds = normalizeUnique(rules.allowAppIds)
  const denyAppIds = normalizeUnique(rules.denyAppIds)

  if (denyAppIds.includes(appId)) {
    return createReason(
      'policy-denied',
      scope,
      `${scope} policy explicitly denies this reviewed app.`,
      [`${scope} deny: ${appId}`]
    )
  }

  if (allowAppIds.length > 0 && !allowAppIds.includes(appId)) {
    return createReason(
      'policy-not-allowed',
      scope,
      `${scope} policy narrowed the reviewed app set and excluded this app.`,
      [`${scope} allow: ${allowAppIds.join(', ')}`]
    )
  }

  return null
}

export function evaluateChatBridgePolicyForApp(
  appIdInput: string,
  context: ChatBridgePolicyEvaluationContext,
  options: { now?: number } = {}
): ChatBridgePolicyDecision {
  const appId = appIdInput.trim()
  if (!context.policySnapshot) {
    return {
      appId,
      allowed: true,
      stale: false,
      appliedScopes: [],
      reasons: [],
    }
  }

  const snapshot = context.policySnapshot
  const appliedScopes: ChatBridgePolicyScope[] = ['tenant']

  if (isChatBridgePolicySnapshotStale(snapshot, options)) {
    return {
      appId,
      allowed: false,
      stale: true,
      appliedScopes,
      reasons: [
        createReason(
          'policy-stale',
          'tenant',
          'Policy data is stale, so new reviewed-app activations fail closed.',
          [`tenant: ${snapshot.tenantId}`]
        ),
      ],
    }
  }

  const tenantReason = evaluateRuleSet(appId, 'tenant', snapshot.tenant)
  if (tenantReason) {
    return {
      appId,
      allowed: false,
      stale: false,
      appliedScopes,
      reasons: [tenantReason],
    }
  }

  if (snapshot.teacher && context.teacherId && snapshot.teacher.teacherId === context.teacherId) {
    appliedScopes.push('teacher')
    const teacherReason = evaluateRuleSet(appId, 'teacher', snapshot.teacher.rules)
    if (teacherReason) {
      return {
        appId,
        allowed: false,
        stale: false,
        appliedScopes,
        reasons: [teacherReason],
      }
    }
  }

  if (snapshot.classroom && context.classroomId && snapshot.classroom.classroomId === context.classroomId) {
    appliedScopes.push('classroom')
    const classroomReason = evaluateRuleSet(appId, 'classroom', snapshot.classroom.rules)
    if (classroomReason) {
      return {
        appId,
        allowed: false,
        stale: false,
        appliedScopes,
        reasons: [classroomReason],
      }
    }
  }

  return {
    appId,
    allowed: true,
    stale: false,
    appliedScopes,
    reasons: [],
  }
}
