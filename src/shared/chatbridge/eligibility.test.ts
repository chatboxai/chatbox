import { describe, expect, it } from 'vitest'
import type { ReviewedAppCatalogEntry } from './manifest'
import { evaluateReviewedAppEligibility, resolveReviewedAppEligibility } from './eligibility'

function createReviewedAppCatalogEntry(overrides: Partial<ReviewedAppCatalogEntry> = {}): ReviewedAppCatalogEntry {
  const base: ReviewedAppCatalogEntry = {
    manifest: {
      appId: 'story-builder',
      name: 'Story Builder',
      version: '1.2.3',
      protocolVersion: 1,
      origin: 'https://apps.example.com',
      uiEntry: 'https://apps.example.com/story-builder',
      authMode: 'oauth',
      permissions: [
        {
          id: 'drive.read',
          resource: 'drive',
          access: 'read',
          required: true,
          purpose: 'Resume a saved draft from Drive.',
        },
      ],
      toolSchemas: [
        {
          name: 'story_builder_resume',
          description: 'Resume the latest reviewed draft.',
          schemaVersion: 1,
          inputSchema: {
            type: 'object',
            properties: {
              draftId: { type: 'string' },
            },
            required: ['draftId'],
          },
        },
      ],
      supportedEvents: ['host.init', 'app.ready', 'app.state', 'app.complete', 'app.requestAuth'],
      completionModes: ['summary', 'handoff'],
      timeouts: {
        launchMs: 15_000,
        idleMs: 120_000,
        completionMs: 10_000,
      },
      safetyMetadata: {
        reviewed: true,
        sandbox: 'hosted-iframe',
        handlesStudentData: true,
        requiresTeacherApproval: true,
      },
      tenantAvailability: {
        default: 'disabled',
        allow: ['tenant:k12-demo'],
        deny: [],
      },
    },
    approval: {
      status: 'approved',
      reviewedAt: 1_711_930_000_000,
      reviewedBy: 'platform-review',
      catalogVersion: 3,
    },
  }

  return {
    ...base,
    ...overrides,
    manifest: {
      ...base.manifest,
      ...overrides.manifest,
    },
    approval: {
      ...base.approval,
      ...overrides.approval,
    },
  }
}

describe('reviewed app eligibility', () => {
  it('returns only reviewed apps whose host context matches availability and approval requirements', () => {
    const storyBuilder = createReviewedAppCatalogEntry()
    const mathLab = createReviewedAppCatalogEntry({
      manifest: {
        ...createReviewedAppCatalogEntry().manifest,
        appId: 'math-lab',
        name: 'Math Lab',
        uiEntry: 'https://apps.example.com/math-lab',
        authMode: 'none',
        permissions: [],
        safetyMetadata: {
          reviewed: true,
          sandbox: 'hosted-iframe',
          handlesStudentData: false,
          requiresTeacherApproval: false,
        },
        tenantAvailability: {
          default: 'enabled',
          allow: [],
          deny: [],
        },
        toolSchemas: [
          {
            name: 'math_lab_start',
            description: 'Launch a reviewed math activity.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {
                lessonId: { type: 'string' },
              },
              required: ['lessonId'],
            },
          },
        ],
      },
    })

    const result = resolveReviewedAppEligibility([storyBuilder, mathLab], {
      tenantId: 'k12-demo',
      teacherApproved: true,
      grantedPermissions: ['drive.read'],
    })

    expect(result.candidates.map((candidate) => candidate.entry.manifest.appId)).toEqual(['story-builder', 'math-lab'])
    expect(result.decisions[0]).toMatchObject({
      eligible: true,
      matchedContexts: ['tenant:k12-demo'],
      reasons: [],
    })
    expect(result.decisions[1]).toMatchObject({
      eligible: true,
      matchedContexts: [],
      reasons: [],
    })
  })

  it('explains when an app is denied or not allowed for the current context', () => {
    const deniedApp = createReviewedAppCatalogEntry({
      manifest: {
        ...createReviewedAppCatalogEntry().manifest,
        tenantAvailability: {
          default: 'enabled',
          allow: [],
          deny: ['classroom:blocked-room'],
        },
      },
    })
    const gatedApp = createReviewedAppCatalogEntry({
      manifest: {
        ...createReviewedAppCatalogEntry().manifest,
        appId: 'debate-arena',
        name: 'Debate Arena',
        uiEntry: 'https://apps.example.com/debate-arena',
        tenantAvailability: {
          default: 'disabled',
          allow: ['classroom:debate-club'],
          deny: [],
        },
        toolSchemas: [
          {
            name: 'debate_arena_open',
            description: 'Launch a reviewed debate round.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      },
    })

    const deniedDecision = evaluateReviewedAppEligibility(deniedApp, {
      classroomId: 'blocked-room',
      teacherApproved: true,
      grantedPermissions: ['drive.read'],
      additionalContextTokens: [],
    })
    const gatedDecision = evaluateReviewedAppEligibility(gatedApp, {
      classroomId: 'history-room',
      teacherApproved: true,
      grantedPermissions: ['drive.read'],
      additionalContextTokens: [],
    })

    expect(deniedDecision.eligible).toBe(false)
    expect(deniedDecision.reasons.map((reason) => reason.code)).toContain('context-denied')
    expect(gatedDecision.eligible).toBe(false)
    expect(gatedDecision.reasons.map((reason) => reason.code)).toContain('context-not-allowed')
  })

  it('requires teacher approval and required permissions before an app becomes eligible', () => {
    const result = evaluateReviewedAppEligibility(createReviewedAppCatalogEntry(), {
      tenantId: 'k12-demo',
      teacherApproved: false,
      grantedPermissions: [],
      additionalContextTokens: [],
    })

    expect(result.eligible).toBe(false)
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      'teacher-approval-required',
      'required-permissions-missing',
    ])
  })

  it('fails closed when the host eligibility context is malformed', () => {
    const result = resolveReviewedAppEligibility([createReviewedAppCatalogEntry()], {
      tenantId: 'bad tenant id',
      additionalContextTokens: [42],
    })

    expect(result.context).toBeNull()
    expect(result.candidates).toEqual([])
    expect(result.contextIssues.length).toBeGreaterThan(0)
    expect(result.decisions[0].eligible).toBe(false)
    expect(result.decisions[0].reasons[0]?.code).toBe('invalid-context')
  })

  it('applies tenant, teacher, and classroom policy precedence before exposing candidates', () => {
    const storyBuilder = createReviewedAppCatalogEntry({
      manifest: {
        ...createReviewedAppCatalogEntry().manifest,
        safetyMetadata: {
          reviewed: true,
          sandbox: 'hosted-iframe',
          handlesStudentData: true,
          requiresTeacherApproval: false,
        },
        tenantAvailability: {
          default: 'enabled',
          allow: [],
          deny: [],
        },
      },
    })
    const debateArena = createReviewedAppCatalogEntry({
      manifest: {
        ...createReviewedAppCatalogEntry().manifest,
        appId: 'debate-arena',
        name: 'Debate Arena',
        uiEntry: 'https://apps.example.com/debate-arena',
        authMode: 'none',
        permissions: [],
        safetyMetadata: {
          reviewed: true,
          sandbox: 'hosted-iframe',
          handlesStudentData: false,
          requiresTeacherApproval: false,
        },
        tenantAvailability: {
          default: 'enabled',
          allow: [],
          deny: [],
        },
        toolSchemas: [
          {
            name: 'debate_arena_open',
            description: 'Launch a reviewed debate round.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      },
    })

    const result = resolveReviewedAppEligibility([storyBuilder, debateArena], {
      tenantId: 'k12-demo',
      teacherId: 'teacher-7',
      classroomId: 'room-9a',
      teacherApproved: true,
      grantedPermissions: ['drive.read'],
      policySnapshot: {
        schemaVersion: 1,
        tenantId: 'k12-demo',
        fetchedAt: 100,
        expiresAt: 9_999_999_999_999,
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

    expect(result.candidates.map((candidate) => candidate.entry.manifest.appId)).toEqual(['story-builder'])
    expect(result.decisions[1]).toMatchObject({
      eligible: false,
    })
    expect(result.decisions[1]?.reasons.map((reason) => reason.code)).toContain('policy-not-allowed')
  })

  it('fails closed for new activations when the policy snapshot is stale', () => {
    const result = resolveReviewedAppEligibility([createReviewedAppCatalogEntry()], {
      tenantId: 'k12-demo',
      teacherApproved: true,
      grantedPermissions: ['drive.read'],
      policySnapshot: {
        schemaVersion: 1,
        tenantId: 'k12-demo',
        fetchedAt: 100,
        expiresAt: 101,
        tenant: {
          allowAppIds: ['story-builder'],
          denyAppIds: [],
        },
      },
    })

    expect(result.candidates).toEqual([])
    expect(result.decisions[0]?.reasons.map((reason) => reason.code)).toContain('policy-stale')
  })
})
