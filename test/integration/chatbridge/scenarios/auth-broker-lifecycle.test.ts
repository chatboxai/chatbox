import '../setup'

import { describe, expect, it } from 'vitest'
import { ChatBridgeAppAuthGrantSchema } from '@shared/chatbridge/auth'
import { createChatBridgeAuthBroker } from 'src/main/chatbridge/auth-broker'

describe('ChatBridge auth broker lifecycle', () => {
  function createGrant() {
    return ChatBridgeAppAuthGrantSchema.parse({
      schemaVersion: 1,
      grantId: 'grant-1',
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      permissionIds: ['drive.read', 'drive.write'],
      credentialHandle: 'grant-handle-1',
      status: 'granted',
      createdAt: 100,
      updatedAt: 120,
      expiresAt: 10_000,
    })
  }

  it('issues a scoped handle at app launch and validates it for host-mediated resource access', () => {
    const broker = createChatBridgeAuthBroker({
      now: () => 500,
      createId: () => 'launch-handle-1',
    })

    const launch = broker.authorizeAppLaunch({
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      grants: [createGrant()],
      permissionIds: ['drive.read'],
    })

    expect(launch).toMatchObject({
      authorized: true,
      grantedCapability: 'credential-handle',
    })
    if (!launch.authorized || !launch.credentialHandle) {
      return
    }

    const access = broker.authorizeResourceAccess({
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      permissionIds: ['drive.read'],
    })

    expect(access).toMatchObject({
      valid: true,
      handle: {
        handleId: 'launch-handle-1',
      },
    })
  })

  it('fails closed when a handle is revoked or requested beyond its approved scope', () => {
    let currentNow = 500
    const broker = createChatBridgeAuthBroker({
      now: () => currentNow,
      createId: () => 'launch-handle-1',
    })

    const launch = broker.authorizeAppLaunch({
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      grants: [createGrant()],
      permissionIds: ['drive.read'],
    })

    expect(launch.authorized).toBe(true)
    if (!launch.authorized || !launch.credentialHandle) {
      return
    }

    const overScoped = broker.authorizeResourceAccess({
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      permissionIds: ['drive.write'],
    })
    expect(overScoped).toMatchObject({
      valid: false,
      code: 'permission-denied',
    })

    broker.revokeHandle(launch.credentialHandle.handleId)
    const revoked = broker.authorizeResourceAccess({
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      permissionIds: ['drive.read'],
    })
    expect(revoked).toMatchObject({
      valid: false,
      code: 'revoked-handle',
    })

    currentNow = 20_000
    const expiredBroker = createChatBridgeAuthBroker({
      now: () => currentNow,
      createId: () => 'expired-handle-1',
    })
    const expiredLaunch = expiredBroker.authorizeAppLaunch({
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      grants: [createGrant()],
      permissionIds: ['drive.read'],
    })

    expect(expiredLaunch.authorized).toBe(false)
    if (expiredLaunch.authorized) {
      return
    }

    expect(expiredLaunch.code).toBe('missing-app-grant')
  })
})
