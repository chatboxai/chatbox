import { beforeEach, describe, expect, it } from 'vitest'
import { clearReviewedAppRegistry, defineReviewedApps } from '@shared/chatbridge/registry'
import { getReviewedAppRouteDecision } from './decision'

describe('getReviewedAppRouteDecision', () => {
  beforeEach(() => {
    clearReviewedAppRegistry()
  })

  it('returns an invoke decision for an explicit reviewed-app request', () => {
    defineReviewedApps([
      {
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
              purpose: 'Resume a saved story draft.',
            },
          ],
          toolSchemas: [
            {
              name: 'story_builder_resume',
              description: 'Resume a story draft or outline.',
              schemaVersion: 1,
              inputSchema: {
                type: 'object',
                properties: {},
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
            requiresTeacherApproval: false,
          },
          tenantAvailability: {
            default: 'enabled',
            allow: [],
            deny: [],
          },
        },
        approval: {
          status: 'approved',
          reviewedAt: 1_711_930_000_000,
          reviewedBy: 'platform-review',
          catalogVersion: 3,
        },
      },
    ])

    const result = getReviewedAppRouteDecision({
      promptInput: 'Open Story Builder and continue my draft outline.',
      contextInput: {
        tenantId: 'k12-demo',
        grantedPermissions: ['drive.read'],
      },
    })

    expect(result.catalog.candidates).toHaveLength(1)
    expect(result.decision.kind).toBe('invoke')
    expect(result.decision.selectedAppId).toBe('story-builder')
  })
})
