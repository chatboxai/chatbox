import { describe, expect, it } from 'vitest'
import { getModelsDevProviderId } from '../../model-registry/provider-mapping'
import { getProviderDefinition, getSystemProviders } from '../index'
import { toWallyModelInfo } from './models/wally'
import { wallyProvider } from './wally'

describe('Wally definition', () => {
  it('registers Wally with its OpenAI-compatible API host', () => {
    expect(getProviderDefinition('wally')).toBeDefined()
    expect(wallyProvider.id).toBe('wally')
    expect(wallyProvider.defaultSettings?.apiHost).toBe('https://inference.runanywhere.ai/v1')
    expect(getSystemProviders().map((p) => p.id)).toContain('wally')
  })

  it('ships its own catalog and marks vision only on image-input models', () => {
    const models = wallyProvider.defaultSettings?.models ?? []
    expect(models.map((m) => m.modelId)).toEqual([
      'deepseek-v4.1-flash',
      'glm-5.3-flash',
      'kimi-k3',
      'glm-5.3-fast',
      'deepseek-v4-pro-fast',
      'minimax-m3',
    ])
    expect(models.filter((m) => m.capabilities?.includes('vision')).map((m) => m.modelId)).toEqual([
      'deepseek-v4.1-flash',
      'kimi-k3',
    ])
    expect(getModelsDevProviderId(wallyProvider.id)).toBeUndefined()
  })

  it('keeps capabilities and limits from the /models response', () => {
    expect(
      toWallyModelInfo({
        id: 'deepseek-v4.1-flash-fast',
        name: 'DeepSeek V4.1 Flash (Fast)',
        context_length: 1_048_576,
        max_output_tokens: 65_536,
        input_modalities: ['text', 'image'],
        supported_features: ['tools', 'json_mode', 'structured_outputs', 'reasoning'],
      })
    ).toEqual({
      modelId: 'deepseek-v4.1-flash-fast',
      type: 'chat',
      nickname: 'DeepSeek V4.1 Flash (Fast)',
      capabilities: ['vision', 'reasoning', 'tool_use'],
      contextWindow: 1_048_576,
      maxOutput: 65_536,
    })
    expect(
      toWallyModelInfo({
        id: 'minimax-m3',
        context_length: 524_287,
        max_output_tokens: 131_072,
        input_modalities: ['text'],
        supported_features: ['tools'],
      })
    ).toEqual({
      modelId: 'minimax-m3',
      type: 'chat',
      capabilities: ['tool_use'],
      contextWindow: 524_287,
      maxOutput: 131_072,
    })
  })
})
