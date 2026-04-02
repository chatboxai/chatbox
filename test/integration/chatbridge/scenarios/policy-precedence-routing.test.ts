import '../setup'

import { beforeEach, describe, expect, it } from 'vitest'
import { clearReviewedAppRegistry, defineReviewedApps } from '@shared/chatbridge/registry'
import { createReviewedAppCatalogEntryFixture } from '../fixtures/reviewed-app-manifests'
import { getReviewedAppRouteDecision } from '@/packages/chatbridge/router'

describe('ChatBridge policy precedence in routing', () => {
  beforeEach(() => {
    clearReviewedAppRegistry()
  })

  it('keeps district-level denies absolute and lets teacher/classroom only narrow from approved apps', () => {
    defineReviewedApps([
      createReviewedAppCatalogEntryFixture({
        manifest: {
          appId: 'story-builder',
          name: 'Story Builder',
          tenantAvailability: {
            default: 'enabled',
            allow: [],
            deny: [],
          },
          safetyMetadata: {
            reviewed: true,
            sandbox: 'hosted-iframe',
            handlesStudentData: true,
            requiresTeacherApproval: false,
          },
        },
      }),
      createReviewedAppCatalogEntryFixture({
        manifest: {
          appId: 'debate-arena',
          name: 'Debate Arena',
          uiEntry: 'https://apps.example.com/debate-arena',
          authMode: 'none',
          permissions: [],
          supportedEvents: ['host.init', 'app.ready', 'app.state', 'app.complete'],
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
              name: 'debate_arena_round',
              description: 'Open a debate round and draft claims, rebuttals, or opening statements.',
              schemaVersion: 1,
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        },
      }),
    ])

    const result = getReviewedAppRouteDecision({
      promptInput: 'Open Debate Arena and help me draft claims for class.',
      contextInput: {
        tenantId: 'k12-demo',
        teacherId: 'teacher-7',
        classroomId: 'classroom-river',
        teacherApproved: true,
        grantedPermissions: ['drive.read'],
        policySnapshot: {
          schemaVersion: 1,
          tenantId: 'k12-demo',
          fetchedAt: 100,
          expiresAt: 9_999_999_999_999,
          tenant: {
            allowAppIds: ['story-builder'],
            denyAppIds: ['debate-arena'],
          },
          teacher: {
            teacherId: 'teacher-7',
            rules: {
              allowAppIds: ['story-builder', 'debate-arena'],
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
      },
    })

    expect(result.catalog.candidates.map((candidate) => candidate.entry.manifest.appId)).toEqual(['story-builder'])
    expect(result.catalog.excluded.find((decision) => decision.entry.manifest.appId === 'debate-arena')?.reasons.map((reason) => reason.code)).toContain(
      'policy-denied'
    )
    expect(result.decision.kind).toBe('clarify')
    expect(result.decision.selectedAppId).not.toBe('debate-arena')
  })

  it('fails closed when the policy snapshot is stale before a new app activation', () => {
    defineReviewedApps([createReviewedAppCatalogEntryFixture()])

    const result = getReviewedAppRouteDecision({
      promptInput: 'Open Story Builder and continue my outline.',
      contextInput: {
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
      },
    })

    expect(result.catalog.candidates).toEqual([])
    expect(result.catalog.excluded[0]?.reasons.map((reason) => reason.code)).toContain('policy-stale')
    expect(result.decision).toMatchObject({
      kind: 'refuse',
      reasonCode: 'no-eligible-apps',
    })
  })
})
