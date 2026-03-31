import { beforeEach, describe, expect, it } from 'vitest'
import type { ReviewedAppCatalogEntry } from './manifest'
import {
  assertReviewedAppCatalogEntrySupported,
  clearReviewedAppRegistry,
  defineReviewedApp,
  defineReviewedApps,
  getReviewedApp,
  getReviewedAppCatalog,
  hasReviewedApp,
  type ReviewedAppRegistrySupport,
  ReviewedAppRegistryError,
} from './registry'

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
          purpose: 'Resume a saved draft.',
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
      supportedEvents: ['host.init', 'app.ready', 'app.ready', 'app.complete'],
      completionModes: ['summary', 'summary', 'handoff'],
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
        allow: ['tenant:k12-demo', 'tenant:k12-demo'],
        deny: ['classroom:blocked', 'classroom:blocked'],
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

describe('Reviewed app registry', () => {
  beforeEach(() => {
    clearReviewedAppRegistry()
  })

  it('registers a reviewed app entry and normalizes duplicate catalog metadata', () => {
    const registered = defineReviewedApp(createReviewedAppCatalogEntry())

    expect(hasReviewedApp('story-builder')).toBe(true)
    expect(registered.manifest.supportedEvents).toEqual(['host.init', 'app.ready', 'app.complete'])
    expect(registered.manifest.completionModes).toEqual(['summary', 'handoff'])
    expect(registered.manifest.tenantAvailability.allow).toEqual(['tenant:k12-demo'])
    expect(registered.manifest.tenantAvailability.deny).toEqual(['classroom:blocked'])
  })

  it('exposes reviewed app catalog entries through lookup helpers', () => {
    defineReviewedApp(createReviewedAppCatalogEntry())
    const secondEntry = createReviewedAppCatalogEntry({
      manifest: {
        ...createReviewedAppCatalogEntry().manifest,
        appId: 'math-lab',
        name: 'Math Lab',
        uiEntry: 'https://apps.example.com/math-lab',
        toolSchemas: [
          {
            name: 'math_lab_start',
            description: 'Launch a math activity.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      },
    })
    defineReviewedApp(secondEntry)

    expect(getReviewedApp('math-lab')?.manifest.name).toBe('Math Lab')
    expect(getReviewedAppCatalog().map((entry) => entry.manifest.appId)).toEqual(['story-builder', 'math-lab'])
  })

  it('rejects unsupported protocol versions', () => {
    expect(() =>
      defineReviewedApp({
        ...createReviewedAppCatalogEntry(),
        manifest: {
          ...createReviewedAppCatalogEntry().manifest,
          protocolVersion: 2,
        },
      })
    ).toThrowError(ReviewedAppRegistryError)

    expect(() =>
      assertReviewedAppCatalogEntrySupported(
        {
          ...createReviewedAppCatalogEntry(),
          manifest: {
            ...createReviewedAppCatalogEntry().manifest,
            protocolVersion: 2,
          },
        },
        {
          protocolVersions: [2],
        }
      )
    ).not.toThrow()
  })

  it('rejects auth modes the host does not support', () => {
    const support: ReviewedAppRegistrySupport = {
      authModes: ['none', 'host-session'],
    }

    expect(() => defineReviewedApp(createReviewedAppCatalogEntry(), support)).toThrowError(/Unsupported auth mode/)
    expect(getReviewedAppCatalog()).toEqual([])
  })

  it('fails closed for bulk registration when any entry is invalid or unsupported', () => {
    const validEntry = createReviewedAppCatalogEntry()
    const invalidEntry = {
      ...createReviewedAppCatalogEntry({
        manifest: {
          ...createReviewedAppCatalogEntry().manifest,
          appId: 'broken-app',
          protocolVersion: 2,
        },
      }),
    }

    expect(() => defineReviewedApps([validEntry, invalidEntry])).toThrowError(/Unsupported ChatBridge protocol version/)
    expect(getReviewedAppCatalog()).toEqual([])
  })
})
