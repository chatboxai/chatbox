import { describe, expect, it } from 'vitest'
import { ChatBridgeAppAuthGrantSchema } from '@shared/chatbridge/auth'
import { createChatBridgeAuthBroker } from '../auth-broker'
import { createChatBridgeResourceProxy } from './index'

describe('chatbridge resource proxy', () => {
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

  async function createAuthorizedProxy() {
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

    const proxy = createChatBridgeResourceProxy({
      validator: broker,
      now: () => 600,
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
        title: 'Chapter 1 Draft',
      })
    )

    return { broker, launch, proxy }
  }

  it('returns a normalized success response for approved resource actions', async () => {
    const { launch, proxy } = await createAuthorizedProxy()
    expect(launch.authorized).toBe(true)
    if (!launch.authorized || !launch.credentialHandle) {
      return
    }

    const response = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-1',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      payload: {
        draftId: 'draft-123',
        selectedText: 'Student paragraph about the opening scene.',
        accessToken: 'secret-token',
      },
    })

    expect(response).toMatchObject({
      status: 'success',
      result: {
        draftId: 'draft-123',
        title: 'Chapter 1 Draft',
      },
      audit: {
        category: 'resource.action',
        outcome: 'granted',
        permissionId: 'drive.read',
        capture: {
          level: 'metadata',
        },
      },
    })
    expect(response.audit.details).toEqual(expect.arrayContaining(['draftId: draft-123']))
    expect(response.audit.redactedKeys).toEqual(expect.arrayContaining(['selectedText', 'accessToken']))
    expect(JSON.stringify(response.audit)).not.toContain('Student paragraph')
    expect(JSON.stringify(response.audit)).not.toContain('secret-token')
  })

  it('denies unsupported actions and invalid handles with normalized audit entries', async () => {
    const { launch, proxy } = await createAuthorizedProxy()
    expect(launch.authorized).toBe(true)
    if (!launch.authorized || !launch.credentialHandle) {
      return
    }

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
      audit: {
        outcome: 'denied',
      },
    })

    const invalid = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-3',
      handleId: 'missing-handle',
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      payload: {
        draftId: 'draft-123',
      },
    })
    expect(invalid).toMatchObject({
      status: 'denied',
      errorCode: 'missing-handle',
      audit: {
        outcome: 'denied',
      },
    })
  })

  it('returns a normalized error response when the provider handler fails', async () => {
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

    const proxy = createChatBridgeResourceProxy({
      validator: broker,
      now: () => 600,
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
      () => {
        throw new Error('Drive is temporarily unavailable')
      }
    )

    expect(launch.authorized).toBe(true)
    if (!launch.authorized || !launch.credentialHandle) {
      return
    }

    const response = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-4',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      payload: {
        draftId: 'draft-123',
      },
    })

    expect(response).toMatchObject({
      status: 'error',
      errorCode: 'handler-error',
      audit: {
        outcome: 'error',
      },
    })
  })

  it('supports explicitly gated forensic capture without retaining raw credentials', async () => {
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

    const proxy = createChatBridgeResourceProxy({
      validator: broker,
      now: () => 600,
      auditCapture: {
        level: 'forensic',
        caseId: 'case-4',
        approvedBy: 'safety-ops',
        justification: 'Escalated support review.',
      },
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

    expect(launch.authorized).toBe(true)
    if (!launch.authorized || !launch.credentialHandle) {
      return
    }

    const response = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-5',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      payload: {
        draftId: 'draft-123',
        selectedText: 'Student paragraph about the opening scene.',
        accessToken: 'secret-token',
      },
    })

    expect(response.audit.capture).toEqual({
      level: 'forensic',
      caseId: 'case-4',
      approvedBy: 'safety-ops',
      justification: 'Escalated support review.',
    })
    expect(response.audit.forensicPayload).toMatchObject({
      draftId: 'draft-123',
      selectedText: 'Student paragraph about the opening scene.',
      accessToken: '[redacted]',
    })
    expect(response.audit.redactedKeys).toContain('accessToken')
  })

  it('emits LangSmith-ready trace events for granted resource actions', async () => {
    const traceEvents: Array<{ name: string; metadata?: Record<string, unknown> }> = []
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

    const proxy = createChatBridgeResourceProxy({
      validator: broker,
      now: () => 600,
      traceAdapter: {
        enabled: true,
        startRun: async () => ({
          runId: 'unused',
          end: async () => {},
        }),
        recordEvent: async (event) => {
          traceEvents.push({
            name: event.name,
            metadata: event.metadata,
          })
        },
      },
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

    expect(launch.authorized).toBe(true)
    if (!launch.authorized || !launch.credentialHandle) {
      return
    }

    await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-6',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      payload: {
        draftId: 'draft-123',
      },
    })

    expect(traceEvents.map((event) => event.name)).toEqual(['chatbridge.resource_proxy.success'])
    expect(traceEvents[0]?.metadata).toMatchObject({
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      outcome: 'success',
    })
  })
})
