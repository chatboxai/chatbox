import type { ReviewedAppCatalogEntry } from '@shared/chatbridge/manifest'

export function createReviewedAppCatalogEntryFixture(
  overrides: Partial<ReviewedAppCatalogEntry> = {}
): ReviewedAppCatalogEntry {
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
          purpose: 'Resume a saved draft from a reviewed connector.',
        },
      ],
      toolSchemas: [
        {
          name: 'story_builder_resume',
          description: 'Restore the latest Story Builder draft.',
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
      launchSurfaces: {
        'desktop-electron': {
          sandbox: 'hosted-iframe',
        },
      },
      tenantAvailability: {
        default: 'disabled',
        allow: ['tenant:k12-demo'],
        deny: [],
      },
      healthcheck: {
        url: 'https://apps.example.com/healthz',
        intervalMs: 30_000,
        timeoutMs: 2_000,
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
