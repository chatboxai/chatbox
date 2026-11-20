import { describe, expect, it } from 'vitest'
import { getModelsDevProviderId } from '../model-registry/provider-mapping'
import { MODELS_DEV_SNAPSHOT } from '../model-registry/snapshot.generated'
import { getAllProviders } from './index'

describe('provider control-plane contracts', () => {
  it('preserves the built-in registration and display order', () => {
    expect(getAllProviders().map((provider) => provider.id)).toEqual([
      'chatbox-ai',
      'openai',
      'openai-responses',
      'gemini',
      'claude',
      'deepseek',
      'qwen',
      'qwen-portal',
      'minimax',
      'minimax-cn',
      'moonshot',
      'moonshot-cn',
      'siliconflow',
      'openrouter',
      'ollama',
      'lm-studio',
      'azure',
      'groq',
      'xAI',
      'mistral-ai',
      'perplexity',
      'volcengine',
      'chatglm-6b',
      'github-copilot',
      'opencode-go',
      'opencode-zen',
      'bedrock',
      'vercel-ai-gateway',
      'tencent-hunyuan',
      'xiaomi-mimo',
      'longcat',
      'zhipu-glm-coding-plan',
      'ionet',
    ])
  })

  it('registers providers with unique ids', () => {
    const ids = getAllProviders().map((provider) => provider.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('exposes IO Intelligence provider defaults', () => {
    const provider = getAllProviders().find((current) => current.id === 'ionet')
    expect(provider?.name).toBe('IO Intelligence')
    expect(provider?.defaultSettings?.apiHost).toBe('https://api.intelligence.io.solutions/api/v1')
    const models = provider?.defaultSettings?.models ?? []
    expect(models).toHaveLength(10)
    expect(models[0]?.modelId).toBe('deepseek-ai/DeepSeek-V4.1-Flash')
    expect(models[0]?.capabilities).toEqual(['reasoning', 'tool_use'])
  })

  it('keeps models.dev mapping aligned with provider definitions', () => {
    for (const provider of getAllProviders()) {
      if (!provider.modelsDevProviderId) continue
      expect(getModelsDevProviderId(provider.id)).toBe(provider.modelsDevProviderId)
    }
  })

  it('keeps curated model ids backed by provider defaults or registry data', () => {
    for (const provider of getAllProviders()) {
      if (!provider.curatedModelIds?.length) continue

      const supportedModelIds = new Set(
        [
          ...(provider.defaultSettings?.models?.map((model) => model.modelId) || []),
          ...Object.keys(MODELS_DEV_SNAPSHOT[provider.id] || {}),
        ].map((modelId) => modelId.toLowerCase())
      )

      for (const curatedModelId of provider.curatedModelIds) {
        expect(supportedModelIds.has(curatedModelId.toLowerCase())).toBe(true)
      }
    }
  })
})
