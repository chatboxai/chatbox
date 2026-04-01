import '../setup'

import { describe, expect, it } from 'vitest'
import { ChatBridgeAppAuthGrantSchema } from '@shared/chatbridge/auth'
import { createChatBridgeAuthBroker } from 'src/main/chatbridge/auth-broker'
import { createChatBridgeResourceProxy } from 'src/main/chatbridge/resource-proxy'

describe('ChatBridge host-mediated resource proxy', () => {
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

  it('executes an approved Story Builder Drive action through the host-mediated proxy', async () => {
    const broker = createChatBridgeAuthBroker({
      now: () => 500,
      createId: () => 'handle-1',
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

    const proxy = createChatBridgeResourceProxy({
      validator: broker,
      now: () => 550,
    })
    proxy.registerAction(
      {
        appId: 'story-builder',
        resource: 'drive',
        action: 'drive.readDraft',
        permissionId: 'drive.read',
        description: 'Read a Story Builder draft from Drive.',
        inputSchema: {
          type: 'object',
          properties: {
            draftId: { type: 'string' },
          },
          required: ['draftId'],
        },
      },
      ({ payload }) => ({
        draftId: payload.draftId,
        outline: ['Opening image', 'Conflict beat', 'Ending beat'],
      })
    )

    const response = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-1',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      payload: {
        draftId: 'draft-42',
      },
    })

    expect(response).toMatchObject({
      status: 'success',
      result: {
        draftId: 'draft-42',
      },
      audit: {
        outcome: 'granted',
        permissionId: 'drive.read',
      },
    })
  })

  it('denies expired or unsupported resource actions without exposing raw partner credentials', async () => {
    let currentNow = 500
    const broker = createChatBridgeAuthBroker({
      now: () => currentNow,
      createId: () => 'handle-1',
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

    const proxy = createChatBridgeResourceProxy({
      validator: broker,
      now: () => currentNow,
    })
    proxy.registerAction(
      {
        appId: 'story-builder',
        resource: 'drive',
        action: 'drive.readDraft',
        permissionId: 'drive.read',
        description: 'Read a Story Builder draft from Drive.',
        inputSchema: {
          type: 'object',
          properties: {
            draftId: { type: 'string' },
          },
          required: ['draftId'],
        },
      },
      ({ payload }) => ({
        draftId: payload.draftId,
      })
    )

    const unsupported = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-2',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.deleteDraft',
      payload: {},
    })

    expect(unsupported).toMatchObject({
      status: 'denied',
      errorCode: 'unsupported-action',
    })

    currentNow = 1_000_000
    const expired = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-3',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      payload: {
        draftId: 'draft-42',
      },
    })

    expect(expired).toMatchObject({
      status: 'denied',
      errorCode: 'expired-handle',
    })
    expect(JSON.stringify(expired)).not.toContain('accessToken')
    expect(JSON.stringify(expired)).not.toContain('refreshToken')
  })
})
