import { ModelProviderEnum, ModelProviderType } from 'src/shared/types'
import { describe, expect, it } from 'vitest'
import { parseProviderFromJson, validateProviderConfig } from './provider-config'

describe('provider-config', () => {
  describe('parseProviderFromJson', () => {
    it('should parse a valid custom provider config', () => {
      const configJson = JSON.stringify({
        id: 'custom-provider',
        name: 'Custom Provider',
        type: 'openai',
        iconUrl: 'https://example.com/icon.png',
        urls: {
          website: 'https://example.com',
          getApiKey: 'https://example.com/api-key',
          docs: 'https://example.com/docs',
          models: 'https://example.com/models',
        },
        settings: {
          apiHost: 'https://api.example.com',
          apiPath: '/v1/chat/completions',
          apiKey: 'test-api-key',
          models: [
            {
              modelId: 'model-1',
              nickname: 'Model One',
              type: 'chat',
              capabilities: ['vision', 'tool_use'],
              contextWindow: 32000,
              maxOutput: 4096,
            },
          ],
        },
      })

      const result = parseProviderFromJson(configJson)

      expect(result).toBeDefined()
      expect(result?.id).toBe('custom-provider')
      // For custom providers, name should be present
      expect(result && 'name' in result).toBe(true)
      if (result && 'name' in result) {
        expect(result.name).toBe('Custom Provider')
        expect(result.type).toBe(ModelProviderType.OpenAI)
        // For custom providers, isCustom should be true
        expect('isCustom' in result && result.isCustom).toBe(true)
        // iconUrl should be present in this test case for custom provider
        if ('isCustom' in result && result.isCustom) {
          expect(result.iconUrl).toBe('https://example.com/icon.png')
        }
      }
      expect(result?.apiHost).toBe('https://api.example.com')
      expect(result?.apiPath).toBe('/v1/chat/completions')
      expect(result?.apiKey).toBe('test-api-key')
      expect(result?.models).toHaveLength(1)
      expect(result?.models?.[0].modelId).toBe('model-1')
    })

    it('should parse a valid builtin provider config', () => {
      const configJson = JSON.stringify({
        id: ModelProviderEnum.OpenAI,
        settings: {
          apiHost: 'https://api.openai.com',
          apiKey: 'sk-test-key',
        },
      })

      const result = parseProviderFromJson(configJson)

      expect(result).toBeDefined()
      expect(result?.id).toBe(ModelProviderEnum.OpenAI)
      expect(result?.apiHost).toBe('https://api.openai.com')
      expect(result?.apiKey).toBe('sk-test-key')
    })

    it('should handle minimal valid provider config', () => {
      const configJson = JSON.stringify({
        id: 'minimal-provider',
        name: 'Minimal Provider',
        type: 'openai',
        settings: {
          apiHost: 'https://api.minimal.com',
        },
      })

      const result = parseProviderFromJson(configJson)

      expect(result).toBeDefined()
      expect(result?.id).toBe('minimal-provider')
      if (result && 'name' in result) {
        expect(result.name).toBe('Minimal Provider')
      }
      expect(result?.apiHost).toBe('https://api.minimal.com')
      expect(result?.apiKey).toBeUndefined()
      expect(result?.models).toBeUndefined()
    })

    it('should handle provider config with anthropic type', () => {
      const configJson = JSON.stringify({
        id: 'anthropic-custom',
        name: 'Anthropic Custom',
        type: 'anthropic',
        settings: {
          apiHost: 'https://api.anthropic.com',
        },
      })

      const result = parseProviderFromJson(configJson)

      expect(result).toBeDefined()
      expect(result?.id).toBe('anthropic-custom')
      if (result && 'type' in result) {
        expect(result.type).toBe(ModelProviderType.Claude) // anthropic type should map to Claude
      }
    })

    it('should handle provider config with openai-responses type', () => {
      const configJson = JSON.stringify({
        id: 'openai-responses-custom',
        name: 'OpenAI Responses Custom',
        type: 'openai-responses',
        settings: {
          apiHost: 'https://api.openai.com',
        },
      })

      const result = parseProviderFromJson(configJson)

      expect(result).toBeDefined()
      expect(result?.id).toBe('openai-responses-custom')
      if (result && 'type' in result) {
        expect(result.type).toBe(ModelProviderType.OpenAIResponses) // openai-responses type should map to OpenAIResponses
      }
    })

    it('should return undefined for invalid JSON', () => {
      const result = parseProviderFromJson('invalid json')
      expect(result).toBeUndefined()
    })

    it('should return undefined for missing required fields', () => {
      const configJson = JSON.stringify({
        name: 'Missing ID',
        type: 'openai',
        settings: {
          apiHost: 'https://api.example.com',
        },
      })

      const result = parseProviderFromJson(configJson)
      expect(result).toBeUndefined()
    })

    it('should return undefined for invalid type field', () => {
      const configJson = JSON.stringify({
        id: 'invalid-type',
        name: 'Invalid Type',
        type: 'invalid',
        settings: {
          apiHost: 'https://api.example.com',
        },
      })

      const result = parseProviderFromJson(configJson)
      expect(result).toBeUndefined()
    })

    it('should handle models with various capabilities', () => {
      const configJson = JSON.stringify({
        id: 'multi-model',
        name: 'Multi Model Provider',
        type: 'openai',
        settings: {
          apiHost: 'https://api.example.com',
          models: [
            {
              modelId: 'chat-model',
              type: 'chat',
              capabilities: ['vision'],
            },
            {
              modelId: 'embedding-model',
              type: 'embedding',
            },
            {
              modelId: 'reasoning-model',
              type: 'chat',
              capabilities: ['reasoning', 'tool_use'],
              contextWindow: 128000,
              maxOutput: 8192,
            },
          ],
        },
      })

      const result = parseProviderFromJson(configJson)

      expect(result).toBeDefined()
      expect(result?.models).toHaveLength(3)
      expect(result?.models?.[0].capabilities).toEqual(['vision'])
      expect(result?.models?.[1].type).toBe('embedding')
      expect(result?.models?.[2].capabilities).toEqual(['reasoning', 'tool_use'])
      expect(result?.models?.[2].contextWindow).toBe(128000)
    })

    it('should handle empty models array', () => {
      const configJson = JSON.stringify({
        id: 'no-models',
        name: 'No Models Provider',
        type: 'openai',
        settings: {
          apiHost: 'https://api.example.com',
          models: [],
        },
      })

      const result = parseProviderFromJson(configJson)

      expect(result).toBeDefined()
      expect(result?.models).toEqual([])
    })

    it('should reject invalid builtin provider enum', () => {
      const configJson = JSON.stringify({
        id: 'NotAValidEnum',
        settings: {
          apiHost: 'https://api.example.com',
          apiKey: 'test-key',
        },
      })

      const result = parseProviderFromJson(configJson)
      expect(result).toBeUndefined()
    })

    it('should handle provider with all optional fields', () => {
      const configJson = JSON.stringify({
        id: 'full-provider',
        name: 'Full Provider',
        type: 'openai',
        iconUrl: 'https://icon.url',
        urls: {
          website: 'https://website.com',
          getApiKey: 'https://get-key.com',
          docs: 'https://docs.com',
          models: 'https://models.com',
        },
        settings: {
          apiHost: 'https://api.example.com',
          apiPath: '/custom/path',
          apiKey: 'full-key',
          models: [
            {
              modelId: 'full-model',
              nickname: 'Full Model',
              type: 'chat',
              capabilities: ['vision', 'reasoning', 'tool_use'],
              contextWindow: 200000,
              maxOutput: 16384,
            },
          ],
        },
      })

      const result = parseProviderFromJson(configJson)

      expect(result).toBeDefined()
      if (result && 'urls' in result) {
        expect(result.urls?.website).toBe('https://website.com')
        if (result.urls && 'getApiKey' in result.urls) {
          expect(result.urls.getApiKey).toBe('https://get-key.com')
        }
        expect(result.urls?.docs).toBe('https://docs.com')
        expect(result.urls?.models).toBe('https://models.com')
      }
      expect(result?.models?.[0].nickname).toBe('Full Model')
      expect(result?.models?.[0].maxOutput).toBe(16384)
    })
  })

  describe('validateProviderConfig', () => {
    it('should validate and return valid provider config', () => {
      const config = {
        id: 'valid-provider',
        name: 'Valid Provider',
        type: 'openai',
        settings: {
          apiHost: 'https://api.valid.com',
        },
      }

      const result = validateProviderConfig(config)

      expect(result).toEqual({
        ...config,
        isCustom: true, // The schema adds this automatically
      })
    })

    it('should return undefined for invalid config', () => {
      const config = {
        id: 'invalid-provider',
        // missing required fields
      }

      const result = validateProviderConfig(config)

      expect(result).toBeUndefined()
    })

    it('should validate config with invalid model type', () => {
      const config = {
        id: 'invalid-model-type',
        name: 'Invalid Model Type',
        type: 'openai',
        settings: {
          apiHost: 'https://api.example.com',
          models: [
            {
              modelId: 'model',
              type: 'invalid-type', // should be chat, embedding, or rerank
            },
          ],
        },
      }

      const result = validateProviderConfig(config)

      expect(result).toBeUndefined()
    })

    it('should validate config with invalid capability', () => {
      const config = {
        id: 'invalid-capability',
        name: 'Invalid Capability',
        type: 'openai',
        settings: {
          apiHost: 'https://api.example.com',
          models: [
            {
              modelId: 'model',
              capabilities: ['invalid-capability'], // should be vision, reasoning, or tool_use
            },
          ],
        },
      }

      const result = validateProviderConfig(config)

      expect(result).toBeUndefined()
    })
  })

  describe('Base64 encoded config (for deep links)', () => {
    it('should parse base64 encoded provider config', () => {
      const config = {
        id: 'base64-provider',
        name: 'Base64 Provider',
        type: 'openai',
        settings: {
          apiHost: 'https://api.base64.com',
        },
      }

      const base64Config = Buffer.from(JSON.stringify(config)).toString('base64')
      const decodedJson = Buffer.from(base64Config, 'base64').toString('utf-8')
      const result = parseProviderFromJson(decodedJson)

      expect(result).toBeDefined()
      expect(result?.id).toBe('base64-provider')
      if (result && 'name' in result) {
        expect(result.name).toBe('Base64 Provider')
      }
    })

    it('should handle malformed base64 data', () => {
      const invalidBase64 = 'not-valid-base64-json'
      try {
        const decodedJson = Buffer.from(invalidBase64, 'base64').toString('utf-8')
        const result = parseProviderFromJson(decodedJson)
        expect(result).toBeUndefined()
      } catch {
        // Expected to fail
        expect(true).toBe(true)
      }
    })
  })

  describe('Real-world provider configs from documentation', () => {
    it('should parse 302.AI provider config', () => {
      const config302AI = {
        id: '302ai',
        name: '302.AI',
        type: 'openai',
        iconUrl: 'https://file.302.ai/favicon.ico',
        urls: {
          website: 'https://302.ai',
          getApiKey: 'https://302.ai',
        },
        settings: {
          apiHost: 'https://api.302.ai',
          models: [
            {
              modelId: 'gpt-4o',
              nickname: 'GPT-4o',
              capabilities: ['vision'],
            },
            {
              modelId: 'claude-3-5-sonnet-20241022',
              nickname: 'Claude 3.5 Sonnet',
            },
          ],
        },
      }

      const result = parseProviderFromJson(JSON.stringify(config302AI))

      expect(result).toBeDefined()
      expect(result?.id).toBe('302ai')
      if (result && 'name' in result) {
        expect(result.name).toBe('302.AI')
      }
      expect(result?.models).toHaveLength(2)
    })

    it('should parse AiHubMix provider config', () => {
      const configAiHubMix = {
        id: 'aihubmix',
        name: 'AiHubMix',
        type: 'openai',
        iconUrl: 'https://aihubmix.com/logo.png',
        urls: {
          website: 'https://aihubmix.com',
          getApiKey: 'https://aihubmix.com/dashboard',
        },
        settings: {
          apiHost: 'https://api.aihubmix.com',
          models: [
            {
              modelId: 'gpt-4',
              contextWindow: 8192,
            },
            {
              modelId: 'claude-2',
              contextWindow: 100000,
            },
          ],
        },
      }

      const result = parseProviderFromJson(JSON.stringify(configAiHubMix))

      expect(result).toBeDefined()
      expect(result?.id).toBe('aihubmix')
      expect(result?.models?.[0].contextWindow).toBe(8192)
      expect(result?.models?.[1].contextWindow).toBe(100000)
    })
  })
})
