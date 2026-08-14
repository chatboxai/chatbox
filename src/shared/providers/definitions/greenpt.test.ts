import { describe, expect, it } from 'vitest'
import { ModelProviderEnum, ModelProviderType } from '../../types'
import { greenPTProvider } from './greenpt'

describe('GreenPT provider', () => {
  it('registers the OpenAI-compatible endpoint and flagship models', () => {
    expect(greenPTProvider).toMatchObject({
      id: ModelProviderEnum.GreenPT,
      type: ModelProviderType.OpenAI,
      defaultSettings: {
        apiHost: 'https://api.greenpt.ai/v1',
      },
    })
    expect(greenPTProvider.defaultSettings?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: 'glm-5.2' }),
        expect.objectContaining({ modelId: 'kimi-k2.7-code' }),
        expect.objectContaining({ modelId: 'green-embedding', type: 'embedding' }),
      ])
    )
  })
})
