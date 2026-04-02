import { describe, expect, it } from 'vitest'
import { createChatBridgeAuditEvent, createChatBridgePolicyAuditEvent } from './audit'

describe('chatbridge audit', () => {
  it('minimizes metadata captures and redacts sensitive or content-bearing fields by default', () => {
    const event = createChatBridgeAuditEvent({
      eventId: 'audit-1',
      category: 'resource.action',
      occurredAt: 100,
      outcome: 'granted',
      details: ['Read a reviewed Drive draft through the host proxy.'],
      payload: {
        draftId: 'draft-42',
        chapterCount: 3,
        selectedText: 'Student paragraph about marine biology.',
        accessToken: 'secret-token',
      },
    })

    expect(event.capture).toEqual({ level: 'metadata' })
    expect(event.details).toEqual(
      expect.arrayContaining([
        'Read a reviewed Drive draft through the host proxy.',
        'draftId: draft-42',
        'chapterCount: 3',
      ])
    )
    expect(event.redactedKeys).toEqual(expect.arrayContaining(['selectedText', 'accessToken']))
    expect(event).not.toHaveProperty('forensicPayload')
    expect(JSON.stringify(event)).not.toContain('Student paragraph')
    expect(JSON.stringify(event)).not.toContain('secret-token')
  })

  it('requires explicit approval for forensic capture and still redacts credential material', () => {
    expect(() =>
      createChatBridgeAuditEvent({
        eventId: 'audit-2',
        category: 'lifecycle.completion',
        occurredAt: 200,
        outcome: 'failed',
        payload: {
          selectedText: 'Student draft text.',
        },
        capture: { level: 'forensic' } as never,
      })
    ).toThrow(/caseId|approvedBy|justification/i)

    const approved = createChatBridgeAuditEvent({
      eventId: 'audit-3',
      category: 'lifecycle.completion',
      occurredAt: 210,
      outcome: 'failed',
      payload: {
        selectedText: 'Student draft text.',
        accessToken: 'secret-token',
        nested: {
          refreshToken: 'refresh-secret',
          teacherNote: 'Keep only for forensic review.',
        },
      },
      capture: {
        level: 'forensic',
        caseId: 'case-9',
        approvedBy: 'safety-ops',
        justification: 'Escalated review for a support incident.',
      },
    })

    expect(approved.capture.level).toBe('forensic')
    expect(approved.forensicPayload).toMatchObject({
      selectedText: 'Student draft text.',
      accessToken: '[redacted]',
      nested: {
        refreshToken: '[redacted]',
        teacherNote: 'Keep only for forensic review.',
      },
    })
    expect(approved.redactedKeys).toEqual(expect.arrayContaining(['accessToken', 'nested.refreshToken']))
  })

  it('creates policy audit records from explicit allow or deny decisions', () => {
    const audit = createChatBridgePolicyAuditEvent({
      eventId: 'policy-1',
      occurredAt: 300,
      tenantId: 'district-1',
      appId: 'debate-arena',
      classroomId: 'room-9a',
      decision: {
        appId: 'debate-arena',
        allowed: false,
        stale: false,
        appliedScopes: ['tenant', 'classroom'],
        reasons: [
          {
            code: 'policy-denied',
            message: 'Classroom policy denied Debate Arena for this room.',
            scope: 'classroom',
            details: ['appId: debate-arena'],
          },
        ],
      },
    })

    expect(audit).toMatchObject({
      category: 'policy.decision',
      outcome: 'denied',
      tenantId: 'district-1',
      appId: 'debate-arena',
      classroomId: 'room-9a',
      summary: 'Policy denied the reviewed app for the current context.',
    })
    expect(audit.details).toContain('classroom: Classroom policy denied Debate Arena for this room.')
  })
})
