import '../setup'

import { describe, expect, it } from 'vitest'
import { createChatBridgePolicyAuditEvent } from '@shared/chatbridge/audit'
import { ChatBridgeAppAuthGrantSchema } from '@shared/chatbridge/auth'
import { evaluateChatBridgePolicyForApp } from '@shared/chatbridge/policy'
import { createChatBridgeAuthBroker } from 'src/main/chatbridge/auth-broker'
import { createChatBridgeResourceProxy } from 'src/main/chatbridge/resource-proxy'

describe('ChatBridge privacy-aware audit operations', () => {
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

  it('captures minimized policy, auth, and resource audit records without raw student content by default', async () => {
    const policyDecision = evaluateChatBridgePolicyForApp('debate-arena', {
      tenantId: 'district-1',
      teacherId: 'teacher-7',
      classroomId: 'room-9a',
      policySnapshot: {
        schemaVersion: 1,
        tenantId: 'district-1',
        fetchedAt: 100,
        expiresAt: 10_000,
        tenant: {
          allowAppIds: ['story-builder', 'debate-arena'],
          denyAppIds: [],
        },
        teacher: {
          teacherId: 'teacher-7',
          rules: {
            allowAppIds: ['story-builder'],
            denyAppIds: [],
          },
        },
        classroom: {
          classroomId: 'room-9a',
          rules: {
            allowAppIds: ['story-builder'],
            denyAppIds: [],
          },
        },
      },
    })

    const policyAudit = createChatBridgePolicyAuditEvent({
      eventId: 'policy-1',
      occurredAt: 150,
      tenantId: 'district-1',
      teacherId: 'teacher-7',
      classroomId: 'room-9a',
      appId: 'debate-arena',
      decision: policyDecision,
    })

    const authAudits: unknown[] = []
    const broker = createChatBridgeAuthBroker({
      now: () => 500,
      createId: () => 'handle-1',
      onAudit: (event) => authAudits.push(event),
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

    const resourceAudits: unknown[] = []
    const proxy = createChatBridgeResourceProxy({
      validator: broker,
      now: () => 550,
      onAudit: (event) => resourceAudits.push(event),
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
        selectedText: 'Student paragraph about the climax.',
        accessToken: 'secret-token',
      },
    })

    expect(policyAudit).toMatchObject({
      category: 'policy.decision',
      outcome: 'denied',
    })
    expect(authAudits[0]).toMatchObject({
      category: 'auth.handle',
      outcome: 'issued',
    })
    expect(response.audit).toMatchObject({
      category: 'resource.action',
      outcome: 'granted',
      capture: {
        level: 'metadata',
      },
    })
    expect(response.audit.details).toEqual(expect.arrayContaining(['draftId: draft-42']))
    expect(response.audit.redactedKeys).toEqual(expect.arrayContaining(['selectedText', 'accessToken']))

    const auditLog = JSON.stringify([policyAudit, ...authAudits, ...resourceAudits])
    expect(auditLog).not.toContain('Student paragraph about the climax.')
    expect(auditLog).not.toContain('secret-token')
  })

  it('keeps forensic capture explicit and still redacts raw credential material', async () => {
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
      auditCapture: {
        level: 'forensic',
        caseId: 'case-8',
        approvedBy: 'safety-ops',
        justification: 'Escalated investigation into a reported app failure.',
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

    const response = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-2',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      payload: {
        draftId: 'draft-42',
        selectedText: 'Student paragraph about the climax.',
        accessToken: 'secret-token',
      },
    })

    expect(response.audit.capture).toEqual({
      level: 'forensic',
      caseId: 'case-8',
      approvedBy: 'safety-ops',
      justification: 'Escalated investigation into a reported app failure.',
    })
    expect(response.audit.forensicPayload).toMatchObject({
      draftId: 'draft-42',
      selectedText: 'Student paragraph about the climax.',
      accessToken: '[redacted]',
    })
    expect(response.audit.redactedKeys).toContain('accessToken')
  })
})
