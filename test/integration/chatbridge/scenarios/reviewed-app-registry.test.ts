import '../setup'

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearReviewedAppRegistry,
  defineReviewedApps,
  getReviewedApp,
  getReviewedAppCatalog,
} from '@shared/chatbridge/registry'
import { createReviewedAppCatalogEntryFixture } from '../fixtures/reviewed-app-manifests'

describe('ChatBridge reviewed app manifest registry', () => {
  beforeEach(() => {
    clearReviewedAppRegistry()
  })

  it('lets the host consume an approved app catalog safely', () => {
    const storyBuilder = createReviewedAppCatalogEntryFixture()
    const mathLab = createReviewedAppCatalogEntryFixture({
      manifest: {
        ...createReviewedAppCatalogEntryFixture().manifest,
        appId: 'math-lab',
        name: 'Math Lab',
        uiEntry: 'https://apps.example.com/math-lab',
        toolSchemas: [
          {
            name: 'math_lab_start',
            description: 'Launch a reviewed math activity.',
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

    const catalog = defineReviewedApps([storyBuilder, mathLab])

    expect(catalog.map((entry) => entry.manifest.appId)).toEqual(['story-builder', 'math-lab'])
    expect(getReviewedApp('story-builder')).toMatchObject({
      approval: {
        status: 'approved',
      },
      manifest: {
        authMode: 'oauth',
        supportedEvents: ['host.init', 'app.ready', 'app.state', 'app.complete', 'app.requestAuth'],
      },
    })
    expect(getReviewedAppCatalog().map((entry) => entry.manifest.name)).toEqual(['Story Builder', 'Math Lab'])
  })

  it('rejects malformed or unsupported catalog entries without mutating approved state', () => {
    const validEntry = createReviewedAppCatalogEntryFixture()
    const unsupportedEntry = createReviewedAppCatalogEntryFixture({
      manifest: {
        ...createReviewedAppCatalogEntryFixture().manifest,
        appId: 'broken-story-builder',
        protocolVersion: 2,
      },
    })

    expect(() => defineReviewedApps([validEntry, unsupportedEntry])).toThrowError(/Unsupported ChatBridge protocol version/)
    expect(getReviewedAppCatalog()).toEqual([])
  })
})
