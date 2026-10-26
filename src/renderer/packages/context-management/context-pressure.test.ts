import { describe, expect, it } from 'vitest'
import { getConfiguredContextWindow, getEffectiveMaxOutputTokens } from './context-pressure'

describe('getConfiguredContextWindow', () => {
  it('reads the matching provider model window', () => {
    expect(
      getConfiguredContextWindow(
        {
          providers: {
            openai: {
              models: [{ modelId: 'gpt-4o', contextWindow: 128_000 }],
            },
          },
        },
        'openai',
        'gpt-4o'
      )
    ).toBe(128_000)
  })

  it('returns undefined when the model is missing', () => {
    expect(getConfiguredContextWindow({}, 'openai', 'gpt-4o')).toBeUndefined()
    expect(getConfiguredContextWindow({}, undefined, undefined)).toBeUndefined()
  })
})

describe('getEffectiveMaxOutputTokens', () => {
  const settings = {
    providers: {
      'custom-compaction-budget': {
        models: [{ modelId: 'custom-budget-model', maxOutput: 4096 }],
      },
    },
  }

  it('prefers the session reply limit over the configured model output', () => {
    expect(getEffectiveMaxOutputTokens(settings, 'custom-compaction-budget', 'custom-budget-model', 2048)).toBe(2048)
  })

  it('uses the configured output when no session limit is set', () => {
    expect(getEffectiveMaxOutputTokens(settings, 'custom-compaction-budget', 'custom-budget-model', undefined)).toBe(
      4096
    )
  })

  it('leaves unknown model output to the budget fallback', () => {
    expect(
      getEffectiveMaxOutputTokens({}, 'custom-compaction-budget', 'custom-budget-model', undefined)
    ).toBeUndefined()
    expect(getEffectiveMaxOutputTokens({}, undefined, undefined, undefined)).toBeUndefined()
  })
})
