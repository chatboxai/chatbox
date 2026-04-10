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
    // Pro models: low/medium/high (no minimal)
    expect(getSupportedGoogleThinkingLevels('gemini-3-pro-preview')).toEqual(['low', 'medium', 'high'])
    expect(getSupportedGoogleThinkingLevels('gemini-3.1-pro-preview')).toEqual(['low', 'medium', 'high'])
    // Flash models: minimal/low/medium/high
    expect(getSupportedGoogleThinkingLevels('gemini-3-flash-preview')).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(getSupportedGoogleThinkingLevels('gemini-3.1-flash-lite-preview')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ])
    // Image models: not in the supported list
    expect(getSupportedGoogleThinkingLevels('gemini-3.1-flash-image-preview')).toEqual([])
    expect(getSupportedGoogleThinkingLevels('gemini-3-pro-image-preview')).toEqual([])
  })

  it('uses the highest supported level as the default Gemini 3 thinking level', () => {
    expect(getDefaultGoogleThinkingLevel('gemini-3-pro-preview')).toBe('high')
    expect(getDefaultGoogleThinkingLevel('gemini-3-flash-preview')).toBe('high')
    expect(getDefaultGoogleThinkingLevel('gemini-3.1-flash-image-preview')).toBeUndefined()
  })

  it('normalizes budget config for Gemini 2.5 models', () => {
    const config = normalizeGoogleThinkingConfig('gemini-2.5-flash', {
      thinkingBudget: 5000,
      thinkingLevel: 'high',
      includeThoughts: true,
    })
    expect(config).toEqual({ thinkingBudget: 5000, includeThoughts: true })
    expect(config).not.toHaveProperty('thinkingLevel')
  })

  it('normalizes level config for Gemini 3 models', () => {
    const config = normalizeGoogleThinkingConfig('gemini-3-flash-preview', {
      thinkingBudget: 5000,
      thinkingLevel: 'medium',
      includeThoughts: true,
    })
    expect(config).toEqual({ thinkingLevel: 'medium', includeThoughts: true })
    expect(config).not.toHaveProperty('thinkingBudget')
  })

  it('strips stale thinkingLevel for unsupported Gemini 3 variants', () => {
    const config = normalizeGoogleThinkingConfig('gemini-3.1-flash-image-preview', {
      thinkingLevel: 'high',
      includeThoughts: true,
    })
    expect(config).toEqual({ includeThoughts: true })
    expect(config).not.toHaveProperty('thinkingLevel')
  })

  it('returns undefined for unsupported Gemini 3 variants with no includeThoughts', () => {
    const config = normalizeGoogleThinkingConfig('gemini-3.1-flash-image-preview', {
      thinkingLevel: 'high',
    })
    expect(config).toBeUndefined()
  })

  it('falls back to default level when saved level is invalid', () => {
    const config = normalizeGoogleThinkingConfig('gemini-3-pro-preview', {
      thinkingLevel: 'minimal',
      includeThoughts: true,
    })
    expect(config).toEqual({ thinkingLevel: 'high', includeThoughts: true })
  })

  it('fills in default level when no thinkingLevel is set', () => {
    const config = normalizeGoogleThinkingConfig('gemini-3-flash-preview', {
      includeThoughts: true,
    })
    expect(config).toEqual({ thinkingLevel: 'high', includeThoughts: true })
  })

  it('fills in default level when thinkingConfig is undefined for level-mode models', () => {
    const config = normalizeGoogleThinkingConfig('gemini-3-flash-preview', undefined)
    expect(config).toEqual({ thinkingLevel: 'high' })
  })

  it('returns undefined when thinkingConfig is undefined for non-level models', () => {
    expect(normalizeGoogleThinkingConfig('gemini-2.5-flash', undefined)).toBeUndefined()
    expect(normalizeGoogleThinkingConfig('gemini-2.0-flash', undefined)).toBeUndefined()
  })

  it('passes through config for non-thinking models', () => {
    const config = normalizeGoogleThinkingConfig('gemini-2.0-flash', {
      thinkingBudget: 1024,
      includeThoughts: true,
    })
    expect(config).toEqual({ thinkingBudget: 1024, includeThoughts: true })
  })
})
