import { z } from 'zod'
import { ChatBridgeAuthModeSchema } from './manifest'

export const CHATBRIDGE_APP_AUTH_GRANT_SCHEMA_VERSION = 1 as const
export const CHATBRIDGE_CREDENTIAL_HANDLE_SCHEMA_VERSION = 1 as const

export const ChatBridgeAppGrantAuthModeSchema = z.enum(['oauth', 'api-key'])
export type ChatBridgeAppGrantAuthMode = z.infer<typeof ChatBridgeAppGrantAuthModeSchema>

export const ChatBridgeCredentialOwnerSchema = z.enum(['none', 'platform-session', 'host'])
export type ChatBridgeCredentialOwner = z.infer<typeof ChatBridgeCredentialOwnerSchema>

export const ChatBridgePlatformAuthIdentitySchema = z
  .object({
    userId: z.string().trim().min(1),
    provider: z.literal('chatbox-platform').default('chatbox-platform'),
  })
  .strict()
export type ChatBridgePlatformAuthIdentity = z.infer<typeof ChatBridgePlatformAuthIdentitySchema>

export const ChatBridgeAuthBoundarySchema = z
  .object({
    appId: z.string().trim().min(1),
    authMode: ChatBridgeAuthModeSchema,
    platformSessionRequired: z.boolean(),
    appGrantRequired: z.boolean(),
    credentialOwner: ChatBridgeCredentialOwnerSchema,
    requiresHostMediatedAccess: z.boolean(),
  })
  .strict()
export type ChatBridgeAuthBoundary = z.infer<typeof ChatBridgeAuthBoundarySchema>

export const ChatBridgeAppAuthGrantStatusSchema = z.enum(['granted', 'revoked', 'expired'])
export type ChatBridgeAppAuthGrantStatus = z.infer<typeof ChatBridgeAppAuthGrantStatusSchema>

export const ChatBridgeAppAuthGrantSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_APP_AUTH_GRANT_SCHEMA_VERSION),
    grantId: z.string().trim().min(1),
    userId: z.string().trim().min(1),
    appId: z.string().trim().min(1),
    authMode: ChatBridgeAppGrantAuthModeSchema,
    permissionIds: z.array(z.string().trim().min(1)).default([]),
    credentialHandle: z.string().trim().min(1),
    status: ChatBridgeAppAuthGrantStatusSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative().optional(),
    revokedAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((grant, ctx) => {
    if (grant.updatedAt < grant.createdAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'updatedAt cannot be earlier than createdAt',
        path: ['updatedAt'],
      })
    }

    if (grant.status === 'revoked' && typeof grant.revokedAt !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'revoked grants must record revokedAt',
        path: ['revokedAt'],
      })
    }

    if (grant.status !== 'revoked' && typeof grant.revokedAt === 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'revokedAt is only valid for revoked grants',
        path: ['revokedAt'],
      })
    }

    if (typeof grant.expiresAt === 'number' && grant.expiresAt < grant.createdAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expiresAt cannot be earlier than createdAt',
        path: ['expiresAt'],
      })
    }
  })
export type ChatBridgeAppAuthGrant = z.infer<typeof ChatBridgeAppAuthGrantSchema>

export const ChatBridgeAppAuthorizationResolutionSchema = z
  .object({
    boundary: ChatBridgeAuthBoundarySchema,
    lookupKey: z.string().trim().min(1),
    activeGrant: ChatBridgeAppAuthGrantSchema.nullable(),
    needsAppGrant: z.boolean(),
  })
  .strict()
export type ChatBridgeAppAuthorizationResolution = z.infer<typeof ChatBridgeAppAuthorizationResolutionSchema>

export const ChatBridgeCredentialHandleStatusSchema = z.enum(['active', 'revoked', 'expired'])
export type ChatBridgeCredentialHandleStatus = z.infer<typeof ChatBridgeCredentialHandleStatusSchema>

export const ChatBridgeCredentialHandleSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_CREDENTIAL_HANDLE_SCHEMA_VERSION),
    handleId: z.string().trim().min(1),
    grantId: z.string().trim().min(1),
    userId: z.string().trim().min(1),
    appId: z.string().trim().min(1),
    authMode: ChatBridgeAppGrantAuthModeSchema,
    permissionIds: z.array(z.string().trim().min(1)).default([]),
    status: ChatBridgeCredentialHandleStatusSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    lastRefreshedAt: z.number().int().nonnegative(),
    revokedAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((handle, ctx) => {
    if (handle.expiresAt < handle.issuedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expiresAt cannot be earlier than issuedAt',
        path: ['expiresAt'],
      })
    }

    if (handle.lastRefreshedAt < handle.issuedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lastRefreshedAt cannot be earlier than issuedAt',
        path: ['lastRefreshedAt'],
      })
    }

    if (handle.status === 'revoked' && typeof handle.revokedAt !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'revoked handles must record revokedAt',
        path: ['revokedAt'],
      })
    }

    if (handle.status !== 'revoked' && typeof handle.revokedAt === 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'revokedAt is only valid for revoked handles',
        path: ['revokedAt'],
      })
    }
  })
export type ChatBridgeCredentialHandle = z.infer<typeof ChatBridgeCredentialHandleSchema>

export const ChatBridgeCredentialHandleValidationFailureCodeSchema = z.enum([
  'missing-handle',
  'revoked-handle',
  'expired-handle',
  'user-mismatch',
  'app-mismatch',
  'permission-denied',
])
export type ChatBridgeCredentialHandleValidationFailureCode = z.infer<
  typeof ChatBridgeCredentialHandleValidationFailureCodeSchema
>

export const ChatBridgeCredentialHandleValidationResultSchema = z.union([
  z
    .object({
      valid: z.literal(true),
      handle: ChatBridgeCredentialHandleSchema,
    })
    .strict(),
  z
    .object({
      valid: z.literal(false),
      code: ChatBridgeCredentialHandleValidationFailureCodeSchema,
      details: z.array(z.string().trim().min(1)).default([]),
      handle: ChatBridgeCredentialHandleSchema.optional(),
    })
    .strict(),
])
export type ChatBridgeCredentialHandleValidationResult = z.infer<typeof ChatBridgeCredentialHandleValidationResultSchema>

export function createChatBridgeAppGrantLookupKey(input: { userId: string; appId: string }): string {
  const userId = input.userId.trim()
  const appId = input.appId.trim()

  if (!userId || !appId) {
    throw new Error('Both userId and appId are required to create an app grant lookup key.')
  }

  return `${userId}::${appId}`
}

export function resolveChatBridgeAuthBoundary(input: { appId: string; authMode: z.infer<typeof ChatBridgeAuthModeSchema> }) {
  const appId = input.appId.trim()

  switch (input.authMode) {
    case 'none':
      return ChatBridgeAuthBoundarySchema.parse({
        appId,
        authMode: input.authMode,
        platformSessionRequired: false,
        appGrantRequired: false,
        credentialOwner: 'none',
        requiresHostMediatedAccess: false,
      })
    case 'host-session':
      return ChatBridgeAuthBoundarySchema.parse({
        appId,
        authMode: input.authMode,
        platformSessionRequired: true,
        appGrantRequired: false,
        credentialOwner: 'platform-session',
        requiresHostMediatedAccess: false,
      })
    case 'oauth':
    case 'api-key':
      return ChatBridgeAuthBoundarySchema.parse({
        appId,
        authMode: input.authMode,
        platformSessionRequired: true,
        appGrantRequired: true,
        credentialOwner: 'host',
        requiresHostMediatedAccess: true,
      })
  }
}

export function isChatBridgeAppAuthGrantActive(
  grant: ChatBridgeAppAuthGrant,
  options: { now?: number } = {}
): boolean {
  if (grant.status !== 'granted') {
    return false
  }

  const now = options.now ?? Date.now()

  if (typeof grant.expiresAt === 'number' && grant.expiresAt <= now) {
    return false
  }

  return true
}

export function isChatBridgeCredentialHandleActive(
  handle: ChatBridgeCredentialHandle,
  options: { now?: number } = {}
): boolean {
  if (handle.status !== 'active') {
    return false
  }

  const now = options.now ?? Date.now()

  if (handle.expiresAt <= now) {
    return false
  }

  return true
}

export function resolveChatBridgeAppAuthorization(input: {
  userId: string
  appId: string
  authMode: z.infer<typeof ChatBridgeAuthModeSchema>
  grants: ChatBridgeAppAuthGrant[]
  now?: number
}): ChatBridgeAppAuthorizationResolution {
  const lookupKey = createChatBridgeAppGrantLookupKey({
    userId: input.userId,
    appId: input.appId,
  })
  const boundary = resolveChatBridgeAuthBoundary({
    appId: input.appId,
    authMode: input.authMode,
  })

  if (!boundary.appGrantRequired) {
    return {
      boundary,
      lookupKey,
      activeGrant: null,
      needsAppGrant: false,
    }
  }

  const activeGrant =
    input.grants
      .filter((grant) => createChatBridgeAppGrantLookupKey(grant) === lookupKey)
      .filter((grant) => isChatBridgeAppAuthGrantActive(grant, { now: input.now }))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null

  return {
    boundary,
    lookupKey,
    activeGrant,
    needsAppGrant: activeGrant === null,
  }
}
