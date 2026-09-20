import { describe, expect, it } from 'vitest'
import { getConfiguredContextWindow } from './context-pressure'

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
