import { describe, expect, it } from 'vitest'
import { ReviewedAppCatalogEntrySchema } from './manifest'

function createReviewedAppCatalogEntry() {
  return {
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
          purpose: 'Resume a saved draft from the host-approved drive connector.',
        },
      ],
      toolSchemas: [
        {
          name: 'story_builder_resume',
          description: 'Restore the latest reviewed Story Builder draft.',
          schemaVersion: 1,
          inputSchema: {
            type: 'object',
            properties: {
              draftId: { type: 'string', description: 'Draft identifier' },
            },
            required: ['draftId'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              resumed: { type: 'boolean' },
            },
            required: ['resumed'],
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
        allow: ['tenant:k12-demo', 'classroom:creative-writing'],
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
  } as const
}

describe('ReviewedAppCatalogEntrySchema', () => {
  it('parses a reviewed app manifest with approval metadata', () => {
    const parsed = ReviewedAppCatalogEntrySchema.parse(createReviewedAppCatalogEntry())

    expect(parsed.manifest).toMatchObject({
      appId: 'story-builder',
      authMode: 'oauth',
      supportedEvents: ['host.init', 'app.ready', 'app.state', 'app.complete', 'app.requestAuth'],
    })
    expect(parsed.approval).toEqual({
      status: 'approved',
      reviewedAt: 1_711_930_000_000,
      reviewedBy: 'platform-review',
      catalogVersion: 3,
    })
  })

  it('rejects uiEntry values that do not match the declared origin', () => {
    const entry = createReviewedAppCatalogEntry()

    expect(() =>
      ReviewedAppCatalogEntrySchema.parse({
        ...entry,
        manifest: {
          ...entry.manifest,
          uiEntry: 'https://evil.example.com/story-builder',
        },
      })
    ).toThrowError(/uiEntry must match manifest origin/)
  })

  it('rejects tool schemas whose required keys are missing from properties', () => {
    const entry = createReviewedAppCatalogEntry()

    expect(() =>
      ReviewedAppCatalogEntrySchema.parse({
        ...entry,
        manifest: {
          ...entry.manifest,
          toolSchemas: [
            {
              name: 'story_builder_resume',
              description: 'Restore the latest draft.',
              inputSchema: {
                type: 'object',
                properties: {
                  draftId: { type: 'string' },
                },
                required: ['missingDraftId'],
              },
            },
          ],
        },
      })
    ).toThrowError(/Required keys must exist in properties/)
  })

  it('rejects invalid auth and permission metadata', () => {
    const entry = createReviewedAppCatalogEntry()

    const result = ReviewedAppCatalogEntrySchema.safeParse({
      ...entry,
      manifest: {
        ...entry.manifest,
        authMode: 'token-broker',
        permissions: [
          {
            id: 'drive.read',
            resource: 'drive',
            access: 'grant',
            purpose: 'not valid',
          },
        ],
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.')).join(',')).toContain('manifest.authMode')
      expect(result.error.issues.map((issue) => issue.path.join('.')).join(',')).toContain('manifest.permissions.0.access')
    }
  })
})
