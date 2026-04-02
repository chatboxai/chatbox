import { beforeEach, describe, expect, it } from 'vitest'
import { clearReviewedAppRegistry, getReviewedAppCatalog } from './registry'
import {
  ensureDefaultReviewedAppsRegistered,
  getDefaultReviewedAppCatalogEntries,
  getLegacyReviewedAppCatalogEntries,
} from './reviewed-app-catalog'

describe('default reviewed app catalog', () => {
  beforeEach(() => {
    clearReviewedAppRegistry()
  })

  it('defaults the active reviewed catalog to Chess, Drawing Kit, and Weather Dashboard', () => {
    expect(getDefaultReviewedAppCatalogEntries().map((entry) => entry.manifest.appId)).toEqual([
      'chess',
      'drawing-kit',
      'weather-dashboard',
    ])
  })

  it('keeps Debate Arena and Story Builder available only as legacy references', () => {
    expect(getLegacyReviewedAppCatalogEntries().map((entry) => entry.manifest.appId)).toEqual([
      'debate-arena',
      'story-builder',
    ])
  })

  it('registers only the active reviewed catalog into the default runtime registry', () => {
    ensureDefaultReviewedAppsRegistered()

    expect(getReviewedAppCatalog().map((entry) => entry.manifest.appId)).toEqual([
      'chess',
      'drawing-kit',
      'weather-dashboard',
    ])
  })
})
