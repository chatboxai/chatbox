import { describe, expect, it } from 'vitest'
import { ChatBridgeAppAuthGrantSchema } from '@shared/chatbridge/auth'
import { createChatBridgeAuthBroker } from './index'

describe('chatbridge auth broker', () => {
  function createGrant(overrides: Partial<ReturnType<typeof ChatBridgeAppAuthGrantSchema.parse>> = {}) {
    return ChatBridgeAppAuthGrantSchema.parse({
      schemaVersion: 1,
      grantId: 'grant-1',
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      permissionIds: ['drive.read', 'drive.write'],
      credentialHandle: 'grant-handle',
      status: 'granted',
      createdAt: 100,
      updatedAt: 120,
      expiresAt: 10_000,
      ...overrides,
    })
  }

  it('issues and validates a scoped credential handle for an active app grant', () => {
    const broker = createChatBridgeAuthBroker({
      now: () => 500,
      createId: () => 'handle-1',
    })

    const issued = broker.issueHandle({
      grant: createGrant(),
      permissionIds: ['drive.read'],
    })

    expect(issued.ok).toBe(true)
    if (!issued.ok) {
      return
    }

    expect(issued.handle.handleId).toBe('handle-1')
    expect(issued.handle.permissionIds).toEqual(['drive.read'])
    expect(issued.handle).not.toHaveProperty('accessToken')

    const validation = broker.validateHandle({
      handleId: 'handle-1',
      userId: 'student-1',
      appId: 'story-builder',
      permissionIds: ['drive.read'],
    })

    expect(validation.valid).toBe(true)
  })

  it('refreshes active handles and revokes them explicitly', () => {
    let currentNow = 500
    const broker = createChatBridgeAuthBroker({
      now: () => currentNow,
      createId: () => 'handle-1',
    })

    const issued = broker.issueHandle({
      grant: createGrant(),
      permissionIds: ['drive.read'],
    })

    expect(issued.ok).toBe(true)
    if (!issued.ok) {
      return
    }

    currentNow = 700
    const refreshed = broker.refreshHandle('handle-1', 1_000)
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) {
      return
    }
    expect(refreshed.handle.expiresAt).toBe(1_700)
    expect(refreshed.handle.lastRefreshedAt).toBe(700)

    currentNow = 750
    const revoked = broker.revokeHandle('handle-1')
    expect(revoked.ok).toBe(true)
    if (!revoked.ok) {
      return
    }
    expect(revoked.handle.status).toBe('revoked')

    const validation = broker.validateHandle({
      handleId: 'handle-1',
      userId: 'student-1',
      appId: 'story-builder',
      permissionIds: ['drive.read'],
    })

    expect(validation).toMatchObject({
      valid: false,
      code: 'revoked-handle',
    })
  })

  it('authorizes launch with a credential handle for authenticated apps and with platform session for host-session apps', () => {
    const broker = createChatBridgeAuthBroker({
      now: () => 500,
      createId: () => 'handle-1',
    })

    const oauthLaunch = broker.authorizeAppLaunch({
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      grants: [createGrant()],
      permissionIds: ['drive.read'],
    })

    expect(oauthLaunch).toMatchObject({
      authorized: true,
      grantedCapability: 'credential-handle',
    })
    if (!oauthLaunch.authorized) {
      return
    }
    expect(oauthLaunch.credentialHandle?.handleId).toBe('handle-1')

    const hostSessionLaunch = broker.authorizeAppLaunch({
      userId: 'teacher-1',
      appId: 'classroom-compass',
      authMode: 'host-session',
      grants: [],
    })

    expect(hostSessionLaunch).toEqual({
      authorized: true,
      boundary: expect.objectContaining({
        appId: 'classroom-compass',
        authMode: 'host-session',
      }),
      grantedCapability: 'platform-session',
      credentialHandle: null,
    })
  })

  it('fails closed for missing, expired, or over-scoped handles', () => {
    let currentNow = 500
    const broker = createChatBridgeAuthBroker({
      now: () => currentNow,
      createId: () => 'handle-1',
    })

    const issued = broker.issueHandle({
      grant: createGrant({ expiresAt: 700 }),
      permissionIds: ['drive.read'],
      ttlMs: 100,
    })

    expect(issued.ok).toBe(true)
    if (!issued.ok) {
      return
    }

    const overScoped = broker.authorizeResourceAccess({
      handleId: 'handle-1',
      userId: 'student-1',
      appId: 'story-builder',
      permissionIds: ['drive.write'],
    })
    expect(overScoped).toMatchObject({
      valid: false,
      code: 'permission-denied',
    })

    currentNow = 1_000
    const expired = broker.authorizeResourceAccess({
      handleId: 'handle-1',
      userId: 'student-1',
      appId: 'story-builder',
      permissionIds: ['drive.read'],
    })
    expect(expired).toMatchObject({
      valid: false,
      code: 'expired-handle',
    })

    const missing = broker.authorizeResourceAccess({
      handleId: 'missing-handle',
      userId: 'student-1',
      appId: 'story-builder',
      permissionIds: ['drive.read'],
    })
    expect(missing).toMatchObject({
      valid: false,
      code: 'missing-handle',
    })
  })
})
