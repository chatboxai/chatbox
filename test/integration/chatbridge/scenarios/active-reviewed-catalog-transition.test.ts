import '../setup'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearReviewedAppRegistry,
  type ReviewedAppCatalogEntry,
  type ReviewedAppRouterCandidate,
} from '@shared/chatbridge'
import {
  ensureDefaultReviewedAppsRegistered,
  getLegacyReviewedAppCatalogEntries,
} from '@shared/chatbridge/reviewed-app-catalog'
import { resolveReviewedAppRouteDecision } from '@shared/chatbridge/routing'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

function toCandidates(entries: ReviewedAppCatalogEntry[]): ReviewedAppRouterCandidate[] {
  return entries.map((entry) => ({
    entry,
    matchedContexts: [],
  }))
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-active-reviewed-catalog-transition',
      primaryFamily: 'catalog',
      evidenceFamilies: ['routing'],
      storyId: 'CB-508',
    },
    testCase,
    execute
  )
}

describe('ChatBridge active reviewed catalog transition', () => {
  beforeEach(() => {
    clearReviewedAppRegistry()
  })

  afterEach(() => {
    clearReviewedAppRegistry()
  })

  it('publishes the active flagship set and keeps legacy apps parked outside the default runtime', () =>
    traceScenario('publishes the active flagship set and keeps legacy apps parked outside the default runtime', () => {
      const activeCatalog = ensureDefaultReviewedAppsRegistered()

      expect(activeCatalog.map((entry) => entry.manifest.appId)).toEqual(['chess', 'drawing-kit', 'weather-dashboard'])
      expect(getLegacyReviewedAppCatalogEntries().map((entry) => entry.manifest.appId)).toEqual([
        'debate-arena',
        'story-builder',
      ])
    }))

  it('routes explicit Drawing Kit and Weather requests through the active reviewed catalog while refusing legacy app names', () =>
    traceScenario(
      'routes explicit Drawing Kit and Weather requests through the active reviewed catalog while refusing legacy app names',
      () => {
        const activeCatalog = ensureDefaultReviewedAppsRegistered()
        const candidates = toCandidates(activeCatalog)

        const drawingDecision = resolveReviewedAppRouteDecision(
          candidates,
          'Open Drawing Kit and start a sticky-note doodle dare.'
        )
        const weatherDecision = resolveReviewedAppRouteDecision(
          candidates,
          'Open Weather Dashboard for the Chicago forecast.'
        )
        const legacyDecision = resolveReviewedAppRouteDecision(
          candidates,
          'Open Story Builder and continue my outline draft.'
        )

        expect(drawingDecision).toMatchObject({
          kind: 'invoke',
          reasonCode: 'explicit-app-match',
          selectedAppId: 'drawing-kit',
        })
        expect(weatherDecision).toMatchObject({
          kind: 'invoke',
          reasonCode: 'explicit-app-match',
          selectedAppId: 'weather-dashboard',
        })
        expect(legacyDecision).toMatchObject({
          kind: 'refuse',
          reasonCode: 'no-confident-match',
        })
      }
    ))
})
