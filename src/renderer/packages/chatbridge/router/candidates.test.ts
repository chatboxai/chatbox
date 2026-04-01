import { beforeEach, describe, expect, it } from 'vitest'
import { clearReviewedAppRegistry, defineReviewedApps } from '@shared/chatbridge/registry'
import type { ReviewedAppCatalogEntry } from '@shared/chatbridge/manifest'
import { getReviewedAppRouterCatalog } from './candidates'

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
          purpose: 'Resume a reviewed draft.',
        },
      ],
      toolSchemas: [
        {
          name: 'story_builder_resume',
          description: 'Resume the latest draft.',
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

describe('ChatBridge router candidates', () => {
  beforeEach(() => {
    clearReviewedAppRegistry()
  })

  it('exposes only eligible reviewed apps to router callers and keeps excluded decisions for debugging', () => {
    const storyBuilder = createReviewedAppCatalogEntry()
    const debateArena = createReviewedAppCatalogEntry({
      manifest: {
        ...createReviewedAppCatalogEntry().manifest,
        appId: 'debate-arena',
        name: 'Debate Arena',
        uiEntry: 'https://apps.example.com/debate-arena',
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
          deny: ['classroom:blocked-room'],
        },
        toolSchemas: [
          {
            name: 'debate_arena_open',
            description: 'Open a reviewed debate round.',
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

    expect(result.contextIssues).toEqual([])
    expect(result.candidates.map((candidate) => candidate.entry.manifest.appId)).toEqual(['story-builder'])
    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0]?.entry.manifest.appId).toBe('debate-arena')
    expect(result.excluded[0]?.reasons.map((reason) => reason.code)).toEqual(['context-denied'])
  })

  it('fails closed for invalid router contexts', () => {
    defineReviewedApps([createReviewedAppCatalogEntry()])

    const result = getReviewedAppRouterCatalog({
      tenantId: 'bad tenant id',
    })

    expect(result.context).toBeNull()
    expect(result.candidates).toEqual([])
    expect(result.excluded[0]?.reasons[0]?.code).toBe('invalid-context')
  })
})
