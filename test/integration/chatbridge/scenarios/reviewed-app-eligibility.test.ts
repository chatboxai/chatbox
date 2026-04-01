import '../setup'

import { beforeEach, describe, expect, it } from 'vitest'
import { clearReviewedAppRegistry, defineReviewedApps } from '@shared/chatbridge/registry'
import { getReviewedAppRouterCatalog } from '@/packages/chatbridge/router'
import { createReviewedAppCatalogEntryFixture } from '../fixtures/reviewed-app-manifests'

describe('ChatBridge reviewed app eligibility filtering', () => {
  beforeEach(() => {
    clearReviewedAppRegistry()
  })

  it('returns only approved candidates for the current host context and keeps exclusions explainable', () => {
    const storyBuilder = createReviewedAppCatalogEntryFixture()
    const debateArena = createReviewedAppCatalogEntryFixture({
      manifest: {
        ...createReviewedAppCatalogEntryFixture().manifest,
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
          deny: ['classroom:blocked-room'],
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

    defineReviewedApps([storyBuilder, debateArena])

    const result = getReviewedAppRouterCatalog({
      tenantId: 'k12-demo',
      classroomId: 'blocked-room',
      teacherApproved: true,
      grantedPermissions: ['drive.read'],
    })

    expect(result.candidates.map((candidate) => candidate.entry.manifest.appId)).toEqual(['story-builder'])
    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0]).toMatchObject({
      eligible: false,
      entry: {
        manifest: {
          appId: 'debate-arena',
        },
      },
    })
    expect(result.excluded[0]?.reasons.map((reason) => reason.code)).toEqual(['context-denied'])
  })

  it('fails closed when the host context is malformed', () => {
    defineReviewedApps([createReviewedAppCatalogEntryFixture()])

    const result = getReviewedAppRouterCatalog({
      tenantId: 'bad tenant id',
    })

    expect(result.candidates).toEqual([])
    expect(result.contextIssues.length).toBeGreaterThan(0)
    expect(result.excluded[0]?.reasons[0]?.code).toBe('invalid-context')
  })
})
