import { describe, expect, it } from 'vitest'
import {
  getDefaultGoogleThinkingLevel,
  getGoogleThinkingMode,
  getSupportedGoogleThinkingLevels,
  normalizeGoogleThinkingConfig,
} from './google-thinking'

describe('google-thinking utils', () => {
  it('detects the correct thinking mode for Gemini model families', () => {
    expect(getGoogleThinkingMode('gemini-2.5-flash')).toBe('budget')
    expect(getGoogleThinkingMode('gemini-3-pro-preview')).toBe('level')
    expect(getGoogleThinkingMode('gemini-2.0-flash')).toBe('none')
  })

  it('returns the documented thinking levels for supported Gemini 3 models', () => {
    expect(getSupportedGoogleThinkingLevels('gemini-3-pro-preview')).toEqual(['low', 'high'])
    expect(getSupportedGoogleThinkingLevels('gemini-3-flash-preview')).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(getSupportedGoogleThinkingLevels('gemini-3.1-pro-preview')).toEqual(['low', 'medium', 'high'])
    expect(getSupportedGoogleThinkingLevels('gemini-3.1-flash-lite-preview')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ])
    expect(getSupportedGoogleThinkingLevels('gemini-3.1-flash-image-preview')).toEqual([])
  })

  it('uses the highest supported level as the default Gemini 3 thinking level', () => {
    expect(getDefaultGoogleThinkingLevel('gemini-3-pro-preview')).toBe('high')
    expect(getDefaultGoogleThinkingLevel('gemini-3-flash-preview')).toBe('high')
    expect(getDefaultGoogleThinkingLevel('gemini-3.1-flash-image-preview')).toBeUndefined()
  })

  it('preserves valid Gemini 3 thinking levels and drops legacy budgets', () => {
    expect(
      normalizeGoogleThinkingConfig('gemini-3-pro-preview', {
        thinkingLevel: 'low',
        includeThoughts: true,
      })
    ).toEqual({
      thinkingLevel: 'low',
      includeThoughts: true,
    })

    expect(
      normalizeGoogleThinkingConfig('gemini-3-flash-preview', {
        thinkingBudget: 5120,
        includeThoughts: true,
      })
    ).toEqual({
      includeThoughts: true,
    })

    expect(
      normalizeGoogleThinkingConfig('gemini-3.1-flash-image-preview', {
        thinkingLevel: 'high',
        includeThoughts: true,
      })
    ).toEqual({
      includeThoughts: true,
    })
  })

  it('preserves Gemini 2.5 thinking budgets', () => {
    expect(
      normalizeGoogleThinkingConfig('gemini-2.5-flash', {
        thinkingBudget: 4096,
        includeThoughts: true,
      })
    ).toEqual({
      thinkingBudget: 4096,
      includeThoughts: true,
    })
  })
})
