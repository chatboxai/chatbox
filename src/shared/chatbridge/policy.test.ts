import { describe, expect, it } from 'vitest'
import {
  ChatBridgePolicyEvaluationContextSchema,
  ChatBridgePolicySnapshotSchema,
  evaluateChatBridgePolicyForApp,
  isChatBridgePolicySnapshotStale,
} from './policy'

function createPolicyContext(overrides: Record<string, unknown> = {}) {
  return ChatBridgePolicyEvaluationContextSchema.parse({
    tenantId: 'tenant-k12',
    teacherId: 'teacher-7',
    classroomId: 'classroom-river',
    policySnapshot: {
      schemaVersion: 1,
      tenantId: 'tenant-k12',
      fetchedAt: 100,
      expiresAt: 1_000,
      tenant: {
        allowAppIds: ['story-builder', 'debate-arena'],
        denyAppIds: ['math-lab'],
      },
      teacher: {
        teacherId: 'teacher-7',
        rules: {
          allowAppIds: ['story-builder'],
          denyAppIds: [],
        },
      },
      classroom: {
        classroomId: 'classroom-river',
        rules: {
          allowAppIds: ['story-builder'],
          denyAppIds: [],
        },
      },
    },
    ...overrides,
  })
}

describe('chatbridge policy resolution', () => {
  it('treats tenant denies as absolute even when lower scopes would allow the app', () => {
    const context = createPolicyContext({
      policySnapshot: {
        schemaVersion: 1,
        tenantId: 'tenant-k12',
        fetchedAt: 100,
        expiresAt: 1_000,
        tenant: {
          allowAppIds: ['story-builder', 'debate-arena'],
          denyAppIds: ['debate-arena'],
        },
        teacher: {
          teacherId: 'teacher-7',
          rules: {
            allowAppIds: ['debate-arena'],
            denyAppIds: [],
          },
        },
        classroom: {
          classroomId: 'classroom-river',
          rules: {
            allowAppIds: ['debate-arena'],
            denyAppIds: [],
          },
        },
      },
    })

    const result = evaluateChatBridgePolicyForApp('debate-arena', context, { now: 500 })

    expect(result.allowed).toBe(false)
    expect(result.appliedScopes).toEqual(['tenant'])
    expect(result.reasons[0]).toMatchObject({
      code: 'policy-denied',
      scope: 'tenant',
    })
  })

  it('lets lower scopes narrow the app set without expanding past tenant approval', () => {
    const context = createPolicyContext()

    const storyBuilder = evaluateChatBridgePolicyForApp('story-builder', context, { now: 500 })
    const debateArena = evaluateChatBridgePolicyForApp('debate-arena', context, { now: 500 })

    expect(storyBuilder).toMatchObject({
      allowed: true,
      appliedScopes: ['tenant', 'teacher', 'classroom'],
    })
    expect(debateArena.allowed).toBe(false)
    expect(debateArena.reasons[0]).toMatchObject({
      code: 'policy-not-allowed',
      scope: 'teacher',
    })
  })

  it('fails closed when the policy snapshot is stale', () => {
    const snapshot = ChatBridgePolicySnapshotSchema.parse({
      schemaVersion: 1,
      tenantId: 'tenant-k12',
      fetchedAt: 100,
      expiresAt: 200,
      tenant: {
        allowAppIds: ['story-builder'],
        denyAppIds: [],
      },
    })

    expect(isChatBridgePolicySnapshotStale(snapshot, { now: 201 })).toBe(true)

    const result = evaluateChatBridgePolicyForApp(
      'story-builder',
      createPolicyContext({
        teacherId: undefined,
        classroomId: undefined,
        policySnapshot: snapshot,
      }),
      { now: 201 }
    )

    expect(result).toMatchObject({
      allowed: false,
      stale: true,
      reasons: [
        {
          code: 'policy-stale',
        },
      ],
    })
  })

  it('allows apps when no policy snapshot is present', () => {
    const result = evaluateChatBridgePolicyForApp(
      'story-builder',
      ChatBridgePolicyEvaluationContextSchema.parse({
        tenantId: 'tenant-k12',
      })
    )

    expect(result).toEqual({
      appId: 'story-builder',
      allowed: true,
      stale: false,
      appliedScopes: [],
      reasons: [],
    })
  })
})
