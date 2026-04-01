import '../setup'

import { describe, expect, it } from 'vitest'
import { ChatBridgeAppAuthGrantSchema, resolveChatBridgeAppAuthorization } from '@shared/chatbridge/auth'
import { createReviewedAppCatalogEntryFixture } from '../fixtures/reviewed-app-manifests'

describe('ChatBridge auth boundary separation', () => {
  it('keeps platform session login separate from host-owned app grants for oauth apps', () => {
    const storyBuilder = createReviewedAppCatalogEntryFixture()
    const platformSessionTokens = {
      accessToken: 'platform-access-token',
      refreshToken: 'platform-refresh-token',
    }
    const appGrant = ChatBridgeAppAuthGrantSchema.parse({
      schemaVersion: 1,
      grantId: 'grant-1',
      userId: 'student-1',
      appId: storyBuilder.manifest.appId,
      authMode: 'oauth',
      permissionIds: ['drive.read'],
      credentialHandle: 'drive-handle-1',
      status: 'granted',
      createdAt: 100,
      updatedAt: 200,
      expiresAt: 5_000,
    })

    const resolution = resolveChatBridgeAppAuthorization({
      userId: 'student-1',
      appId: storyBuilder.manifest.appId,
      authMode: storyBuilder.manifest.authMode,
      grants: [appGrant],
      now: 500,
    })

    expect(platformSessionTokens.accessToken).toBe('platform-access-token')
    expect(storyBuilder.manifest.authMode).toBe('oauth')
    expect(resolution.boundary).toMatchObject({
      appGrantRequired: true,
      credentialOwner: 'host',
      platformSessionRequired: true,
      requiresHostMediatedAccess: true,
    })
    expect(resolution.activeGrant?.credentialHandle).toBe('drive-handle-1')
    expect(resolution.activeGrant).not.toHaveProperty('accessToken')
    expect(resolution.activeGrant).not.toHaveProperty('refreshToken')
  })

  it('does not require an app grant when an app only depends on the platform session', () => {
    const classroomCompass = createReviewedAppCatalogEntryFixture({
      manifest: {
        appId: 'classroom-compass',
        name: 'Classroom Compass',
        uiEntry: 'https://apps.example.com/classroom-compass',
        authMode: 'host-session',
        permissions: [],
      },
    })

    const resolution = resolveChatBridgeAppAuthorization({
      userId: 'teacher-1',
      appId: classroomCompass.manifest.appId,
      authMode: classroomCompass.manifest.authMode,
      grants: [],
      now: 500,
    })

    expect(resolution.boundary).toMatchObject({
      appGrantRequired: false,
      credentialOwner: 'platform-session',
      platformSessionRequired: true,
      requiresHostMediatedAccess: false,
    })
    expect(resolution.activeGrant).toBeNull()
    expect(resolution.needsAppGrant).toBe(false)
  })
})
