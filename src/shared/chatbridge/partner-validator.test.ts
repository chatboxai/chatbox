import { describe, expect, it } from 'vitest'
import type { ReviewedAppCatalogEntry } from './manifest'
import { validateChatBridgePartnerManifest } from './partner-validator'

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
          purpose: 'Resume a saved draft through the host-managed drive connector.',
        },
      ],
      toolSchemas: [
        {
          name: 'story_builder_resume',
          description: 'Resume the latest approved Story Builder draft.',
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

describe('validateChatBridgePartnerManifest', () => {
  it('returns partner guidance for a reviewed manifest that matches the current host contract', () => {
    const report = validateChatBridgePartnerManifest(createReviewedAppCatalogEntry())

    expect(report.valid).toBe(true)
    expect(report.entry?.manifest.appId).toBe('story-builder')
    expect(report.guidance).toMatchObject({
      bridgeProtocol: 'chatbridge-bridge-v1',
      requiredManifestEvents: ['host.init', 'app.ready', 'app.complete', 'app.requestAuth'],
      recommendedManifestEvents: ['app.state', 'app.error'],
      authBoundary: {
        appGrantRequired: true,
        requiresHostMediatedAccess: true,
      },
      completionSchemaVersion: 1,
      completionModes: ['summary', 'handoff'],
    })
    expect(report.guidance?.hostSummaryRule).toContain('summaryForModel')
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'missing-app-error',
        severity: 'warning',
      }),
    ])
  })

  it('fails closed when the manifest misses required auth and completion events', () => {
    const report = validateChatBridgePartnerManifest(
      createReviewedAppCatalogEntry({
        manifest: {
          ...createReviewedAppCatalogEntry().manifest,
          supportedEvents: ['host.init', 'app.ready'],
        },
      })
    )

    expect(report.valid).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['missing-app-complete', 'missing-app-request-auth', 'missing-app-state', 'missing-app-error'])
    )
  })

  it('surfaces malformed manifest issues as structured partner-facing diagnostics', () => {
    const report = validateChatBridgePartnerManifest({
      manifest: {
        appId: 'story-builder',
        name: 'Story Builder',
      },
    })

    expect(report.valid).toBe(false)
    expect(report.entry).toBeNull()
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-manifest',
        severity: 'error',
      }),
    ])
    expect(report.issues[0]?.details.join(' ')).toContain('manifest.version')
  })
})
