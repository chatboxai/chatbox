import { describe, expect, it } from 'vitest'
import {
  ChatBridgeAppAuthGrantSchema,
  ChatBridgePlatformAuthIdentitySchema,
  createChatBridgeAppGrantLookupKey,
  isChatBridgeAppAuthGrantActive,
  resolveChatBridgeAppAuthorization,
  resolveChatBridgeAuthBoundary,
} from './auth'

describe('chatbridge auth contracts', () => {
  it('models platform auth and app auth as separate domains', () => {
    const platformIdentity = ChatBridgePlatformAuthIdentitySchema.parse({
      userId: 'student-1',
    })

    const appGrant = ChatBridgeAppAuthGrantSchema.parse({
      schemaVersion: 1,
      grantId: 'grant-1',
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      permissionIds: ['drive.read'],
      credentialHandle: 'cred-handle-1',
      status: 'granted',
      createdAt: 100,
      updatedAt: 120,
      expiresAt: 1_000,
    })

    expect(platformIdentity).toEqual({
      provider: 'chatbox-platform',
      userId: 'student-1',
    })
    expect(appGrant.credentialHandle).toBe('cred-handle-1')
    expect('accessToken' in appGrant).toBe(false)
    expect('refreshToken' in appGrant).toBe(false)
  })

  it('fails closed when a grant tries to carry raw platform tokens', () => {
    const result = ChatBridgeAppAuthGrantSchema.safeParse({
      schemaVersion: 1,
      grantId: 'grant-1',
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      permissionIds: ['drive.read'],
      credentialHandle: 'cred-handle-1',
      status: 'granted',
      createdAt: 100,
      updatedAt: 120,
      accessToken: 'platform-access-token',
      refreshToken: 'platform-refresh-token',
    })

    expect(result.success).toBe(false)
  })

  it('resolves auth boundaries without conflating platform session auth and app grants', () => {
    expect(resolveChatBridgeAuthBoundary({ appId: 'debate-arena', authMode: 'none' })).toMatchObject({
      appGrantRequired: false,
      credentialOwner: 'none',
      platformSessionRequired: false,
    })

    expect(resolveChatBridgeAuthBoundary({ appId: 'story-builder', authMode: 'oauth' })).toMatchObject({
      appGrantRequired: true,
      credentialOwner: 'host',
      platformSessionRequired: true,
      requiresHostMediatedAccess: true,
    })
  })

  it('links app grants to the user and app identity that requested them', () => {
    const grant = ChatBridgeAppAuthGrantSchema.parse({
      schemaVersion: 1,
      grantId: 'grant-1',
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      permissionIds: ['drive.read'],
      credentialHandle: 'cred-handle-1',
      status: 'granted',
      createdAt: 100,
      updatedAt: 220,
      expiresAt: 1_000,
    })

    const otherGrant = ChatBridgeAppAuthGrantSchema.parse({
      schemaVersion: 1,
      grantId: 'grant-2',
      userId: 'student-2',
      appId: 'story-builder',
      authMode: 'oauth',
      permissionIds: ['drive.read'],
      credentialHandle: 'cred-handle-2',
      status: 'granted',
      createdAt: 100,
      updatedAt: 230,
      expiresAt: 1_000,
    })

    const resolution = resolveChatBridgeAppAuthorization({
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      grants: [otherGrant, grant],
      now: 500,
    })

    expect(createChatBridgeAppGrantLookupKey({ userId: 'student-1', appId: 'story-builder' })).toBe(
      'student-1::story-builder'
    )
    expect(resolution.lookupKey).toBe('student-1::story-builder')
    expect(resolution.activeGrant?.grantId).toBe('grant-1')
    expect(resolution.needsAppGrant).toBe(false)
  })

  it('treats revoked or expired app grants as unusable', () => {
    const expiredGrant = ChatBridgeAppAuthGrantSchema.parse({
      schemaVersion: 1,
      grantId: 'grant-1',
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      permissionIds: ['drive.read'],
      credentialHandle: 'cred-handle-1',
      status: 'granted',
      createdAt: 100,
      updatedAt: 120,
      expiresAt: 200,
    })

    const revokedGrant = ChatBridgeAppAuthGrantSchema.parse({
      schemaVersion: 1,
      grantId: 'grant-2',
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      permissionIds: ['drive.read'],
      credentialHandle: 'cred-handle-2',
      status: 'revoked',
      createdAt: 100,
      updatedAt: 130,
      revokedAt: 130,
    })

    expect(isChatBridgeAppAuthGrantActive(expiredGrant, { now: 500 })).toBe(false)
    expect(isChatBridgeAppAuthGrantActive(revokedGrant, { now: 500 })).toBe(false)
    expect(
      resolveChatBridgeAppAuthorization({
        userId: 'student-1',
        appId: 'story-builder',
        authMode: 'oauth',
        grants: [expiredGrant, revokedGrant],
        now: 500,
      }).needsAppGrant
    ).toBe(true)
  })
})
