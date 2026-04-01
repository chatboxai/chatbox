import {
  type ChatBridgeAppAuthGrant,
  ChatBridgeAppAuthGrantSchema,
  type ChatBridgeAuthBoundary,
  type ChatBridgeCredentialHandle,
  ChatBridgeCredentialHandleSchema,
  type ChatBridgeCredentialHandleValidationFailureCode,
  ChatBridgeCredentialHandleValidationResultSchema,
  createChatBridgeAppGrantLookupKey,
  isChatBridgeAppAuthGrantActive,
  isChatBridgeCredentialHandleActive,
  resolveChatBridgeAppAuthorization,
} from '@shared/chatbridge/auth'
import type { ChatBridgeAuthMode } from '@shared/chatbridge/manifest'

export type ChatBridgeAuthBrokerTraceEvent =
  | { type: 'handle.issued'; handleId: string; grantId: string; appId: string; userId: string }
  | { type: 'handle.refreshed'; handleId: string; grantId: string; appId: string; userId: string }
  | { type: 'handle.revoked'; handleId: string; grantId: string; appId: string; userId: string }
  | { type: 'handle.validation.failed'; handleId: string; code: ChatBridgeCredentialHandleValidationFailureCode }

export type ChatBridgeCredentialHandleMutationResult =
  | {
      ok: true
      handle: ChatBridgeCredentialHandle
    }
  | {
      ok: false
      code: ChatBridgeCredentialHandleValidationFailureCode
      details: string[]
      handle?: ChatBridgeCredentialHandle
    }

export type ChatBridgeAppLaunchAuthorizationResult =
  | {
      authorized: true
      boundary: ChatBridgeAuthBoundary
      grantedCapability: 'none' | 'platform-session' | 'credential-handle'
      credentialHandle: ChatBridgeCredentialHandle | null
    }
  | {
      authorized: false
      boundary: ChatBridgeAuthBoundary
      code: 'missing-app-grant' | 'inactive-app-grant' | 'permission-denied'
      details: string[]
      credentialHandle: null
    }

type CreateChatBridgeAuthBrokerOptions = {
  now?: () => number
  ttlMs?: number
  createId?: () => string
  onTrace?: (event: ChatBridgeAuthBrokerTraceEvent) => void
}

type IssueHandleInput = {
  grant: ChatBridgeAppAuthGrant
  permissionIds?: string[]
  ttlMs?: number
}

type ValidateHandleInput = {
  handleId: string
  userId: string
  appId: string
  permissionIds?: string[]
}

type AuthorizeLaunchInput = {
  userId: string
  appId: string
  authMode: ChatBridgeAuthMode
  grants: ChatBridgeAppAuthGrant[]
  permissionIds?: string[]
}

function defaultCreateId() {
  return crypto.randomUUID()
}

function dedupeInOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const value of values) {
    if (seen.has(value)) {
      continue
    }
    seen.add(value)
    deduped.push(value)
  }

  return deduped
}

function getPermissionGap(allowedPermissionIds: string[], requestedPermissionIds: string[]): string[] {
  const allowed = new Set(allowedPermissionIds)
  return dedupeInOrder(requestedPermissionIds).filter((permissionId) => !allowed.has(permissionId))
}

function mutationFailure(
  code: ChatBridgeCredentialHandleValidationFailureCode,
  details: string[],
  handle?: ChatBridgeCredentialHandle
): ChatBridgeCredentialHandleMutationResult {
  return {
    ok: false,
    code,
    details,
    handle,
  }
}

export function createChatBridgeAuthBroker(options: CreateChatBridgeAuthBrokerOptions = {}) {
  const now = () => options.now?.() ?? Date.now()
  const ttlMs = options.ttlMs ?? 10 * 60_000
  const createId = options.createId ?? defaultCreateId
  const handles = new Map<string, ChatBridgeCredentialHandle>()

  function emitTrace(event: ChatBridgeAuthBrokerTraceEvent) {
    options.onTrace?.(event)
  }

  function storeHandle(handle: ChatBridgeCredentialHandle) {
    handles.set(handle.handleId, handle)
    return handle
  }

  function getHandle(handleId: string) {
    return handles.get(handleId) ?? null
  }

  function issueHandle(input: IssueHandleInput): ChatBridgeCredentialHandleMutationResult {
    const grant = ChatBridgeAppAuthGrantSchema.parse(input.grant)
    if (!isChatBridgeAppAuthGrantActive(grant, { now: now() })) {
      return mutationFailure('expired-handle', ['Cannot issue a credential handle from an inactive app grant.'])
    }

    const requestedPermissionIds = dedupeInOrder(input.permissionIds ?? grant.permissionIds)
    const missingPermissions = getPermissionGap(grant.permissionIds, requestedPermissionIds)
    if (missingPermissions.length > 0) {
      return mutationFailure(
        'permission-denied',
        [`Requested permissions exceed the active app grant: ${missingPermissions.join(', ')}`]
      )
    }

    const issuedAt = now()
    const handle = ChatBridgeCredentialHandleSchema.parse({
      schemaVersion: 1,
      handleId: createId(),
      grantId: grant.grantId,
      userId: grant.userId,
      appId: grant.appId,
      authMode: grant.authMode,
      permissionIds: requestedPermissionIds,
      status: 'active',
      issuedAt,
      expiresAt: issuedAt + (input.ttlMs ?? ttlMs),
      lastRefreshedAt: issuedAt,
    })

    storeHandle(handle)
    emitTrace({
      type: 'handle.issued',
      handleId: handle.handleId,
      grantId: handle.grantId,
      appId: handle.appId,
      userId: handle.userId,
    })

    return {
      ok: true,
      handle,
    }
  }

  function refreshHandle(handleId: string, overrideTtlMs?: number): ChatBridgeCredentialHandleMutationResult {
    const existingHandle = getHandle(handleId)
    if (!existingHandle) {
      emitTrace({ type: 'handle.validation.failed', handleId, code: 'missing-handle' })
      return mutationFailure('missing-handle', ['Credential handle was not found.'])
    }

    if (existingHandle.status === 'revoked') {
      emitTrace({ type: 'handle.validation.failed', handleId, code: 'revoked-handle' })
      return mutationFailure('revoked-handle', ['Revoked credential handles cannot be refreshed.'], existingHandle)
    }

    if (!isChatBridgeCredentialHandleActive(existingHandle, { now: now() })) {
      const expiredHandle = ChatBridgeCredentialHandleSchema.parse({
        ...existingHandle,
        status: 'expired',
      })
      storeHandle(expiredHandle)
      emitTrace({ type: 'handle.validation.failed', handleId, code: 'expired-handle' })
      return mutationFailure('expired-handle', ['Expired credential handles cannot be refreshed.'], expiredHandle)
    }

    const refreshedAt = now()
    const refreshedHandle = ChatBridgeCredentialHandleSchema.parse({
      ...existingHandle,
      expiresAt: refreshedAt + (overrideTtlMs ?? ttlMs),
      lastRefreshedAt: refreshedAt,
    })
    storeHandle(refreshedHandle)
    emitTrace({
      type: 'handle.refreshed',
      handleId: refreshedHandle.handleId,
      grantId: refreshedHandle.grantId,
      appId: refreshedHandle.appId,
      userId: refreshedHandle.userId,
    })

    return {
      ok: true,
      handle: refreshedHandle,
    }
  }

  function revokeHandle(handleId: string): ChatBridgeCredentialHandleMutationResult {
    const existingHandle = getHandle(handleId)
    if (!existingHandle) {
      emitTrace({ type: 'handle.validation.failed', handleId, code: 'missing-handle' })
      return mutationFailure('missing-handle', ['Credential handle was not found.'])
    }

    const revokedAt = now()
    const revokedHandle = ChatBridgeCredentialHandleSchema.parse({
      ...existingHandle,
      status: 'revoked',
      revokedAt,
    })
    storeHandle(revokedHandle)
    emitTrace({
      type: 'handle.revoked',
      handleId: revokedHandle.handleId,
      grantId: revokedHandle.grantId,
      appId: revokedHandle.appId,
      userId: revokedHandle.userId,
    })

    return {
      ok: true,
      handle: revokedHandle,
    }
  }

  function validateHandle(input: ValidateHandleInput) {
    const existingHandle = getHandle(input.handleId)
    if (!existingHandle) {
      const result = {
        valid: false,
        code: 'missing-handle',
        details: ['Credential handle was not found.'],
      } as const
      emitTrace({ type: 'handle.validation.failed', handleId: input.handleId, code: result.code })
      return ChatBridgeCredentialHandleValidationResultSchema.parse(result)
    }

    if (existingHandle.status === 'revoked') {
      const result = {
        valid: false,
        code: 'revoked-handle',
        details: ['Credential handle has already been revoked.'],
        handle: existingHandle,
      } as const
      emitTrace({ type: 'handle.validation.failed', handleId: input.handleId, code: result.code })
      return ChatBridgeCredentialHandleValidationResultSchema.parse(result)
    }

    if (!isChatBridgeCredentialHandleActive(existingHandle, { now: now() })) {
      const expiredHandle = ChatBridgeCredentialHandleSchema.parse({
        ...existingHandle,
        status: 'expired',
      })
      storeHandle(expiredHandle)
      const result = {
        valid: false,
        code: 'expired-handle',
        details: ['Credential handle has expired and must be reissued.'],
        handle: expiredHandle,
      } as const
      emitTrace({ type: 'handle.validation.failed', handleId: input.handleId, code: result.code })
      return ChatBridgeCredentialHandleValidationResultSchema.parse(result)
    }

    if (existingHandle.userId !== input.userId) {
      const result = {
        valid: false,
        code: 'user-mismatch',
        details: ['Credential handle is bound to a different user.'],
        handle: existingHandle,
      } as const
      emitTrace({ type: 'handle.validation.failed', handleId: input.handleId, code: result.code })
      return ChatBridgeCredentialHandleValidationResultSchema.parse(result)
    }

    if (existingHandle.appId !== input.appId) {
      const result = {
        valid: false,
        code: 'app-mismatch',
        details: ['Credential handle is bound to a different reviewed app.'],
        handle: existingHandle,
      } as const
      emitTrace({ type: 'handle.validation.failed', handleId: input.handleId, code: result.code })
      return ChatBridgeCredentialHandleValidationResultSchema.parse(result)
    }

    const requestedPermissionIds = dedupeInOrder(input.permissionIds ?? [])
    const missingPermissions = getPermissionGap(existingHandle.permissionIds, requestedPermissionIds)
    if (missingPermissions.length > 0) {
      const result = {
        valid: false,
        code: 'permission-denied',
        details: [`Credential handle is missing required permissions: ${missingPermissions.join(', ')}`],
        handle: existingHandle,
      } as const
      emitTrace({ type: 'handle.validation.failed', handleId: input.handleId, code: result.code })
      return ChatBridgeCredentialHandleValidationResultSchema.parse(result)
    }

    return ChatBridgeCredentialHandleValidationResultSchema.parse({
      valid: true,
      handle: existingHandle,
    })
  }

  function authorizeAppLaunch(input: AuthorizeLaunchInput): ChatBridgeAppLaunchAuthorizationResult {
    const authorization = resolveChatBridgeAppAuthorization({
      userId: input.userId,
      appId: input.appId,
      authMode: input.authMode,
      grants: input.grants,
      now: now(),
    })

    if (!authorization.boundary.appGrantRequired) {
      return {
        authorized: true,
        boundary: authorization.boundary,
        grantedCapability:
          authorization.boundary.credentialOwner === 'platform-session' ? 'platform-session' : 'none',
        credentialHandle: null,
      }
    }

    if (authorization.activeGrant === null) {
      return {
        authorized: false,
        boundary: authorization.boundary,
        code: 'missing-app-grant',
        details: ['No active app grant exists for this user and reviewed app.'],
        credentialHandle: null,
      }
    }

    if (!isChatBridgeAppAuthGrantActive(authorization.activeGrant, { now: now() })) {
      return {
        authorized: false,
        boundary: authorization.boundary,
        code: 'inactive-app-grant',
        details: ['The app grant is no longer active and cannot issue a credential handle.'],
        credentialHandle: null,
      }
    }

    const issued = issueHandle({
      grant: authorization.activeGrant,
      permissionIds: input.permissionIds,
    })

    if (!issued.ok) {
      return {
        authorized: false,
        boundary: authorization.boundary,
        code: 'permission-denied',
        details: issued.details,
        credentialHandle: null,
      }
    }

    return {
      authorized: true,
      boundary: authorization.boundary,
      grantedCapability: 'credential-handle',
      credentialHandle: issued.handle,
    }
  }

  return {
    issueHandle,
    refreshHandle,
    revokeHandle,
    validateHandle,
    authorizeAppLaunch,
    authorizeResourceAccess: validateHandle,
    getHandle,
    getHandles() {
      return Array.from(handles.values())
    },
    getGrantLookupKey(input: { userId: string; appId: string }) {
      return createChatBridgeAppGrantLookupKey(input)
    },
  }
}
