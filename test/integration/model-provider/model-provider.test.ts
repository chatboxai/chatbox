/**
 * Integration tests for AI model providers.
 *
 * 运行方式
 * 1. 创建 .env 文件，添加各个模型提供商的 API Key，例如：
 *    TEST_OPENAI_API_KEY=your_openai_api_key
 *    TEST_GEMINI_API_KEY=your_gemini_api_key
 *    TEST_OPENAI_RESPONSES_API_KEY=your_openai_api_key
 * 2. npm run test:model-provider
 */
import type { ModelMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import TestPlatform from '../../../src/renderer/platform/test_platform'
import { settings as getDefaultSettings, newConfigs, SystemProviders } from '../../../src/shared/defaults'
import { aiProviderNameHash, getModel } from '../../../src/shared/models'
import type AbstractAISDKModel from '../../../src/shared/models/abstract-ai-sdk'
import {
  type ModelProvider,
  ModelProviderEnum,
  type ProviderBaseInfo,
  type ProviderModelInfo,
  type SessionSettings,
  type Settings,
} from '../../../src/shared/types'
import { createMockModelDependencies } from '../mocks/model-dependencies'
import { MockSentryAdapter } from '../mocks/sentry'

function keyEnv(providerName: string): string {
  return `TEST_${providerName.toUpperCase().replace(/-/g, '_')}_API_KEY`
}

const PROVIDER_TEST_MODELS: Record<ModelProvider, ProviderModelInfo[]> = {
  [ModelProviderEnum.OpenAI]: [
    { modelId: 'gpt-5.2', capabilities: ['tool_use', 'reasoning'] },
    { modelId: 'gpt-5-mini', capabilities: ['tool_use', 'reasoning'] },
    { modelId: 'o4-mini', capabilities: ['tool_use', 'reasoning'] },
  ],
  [ModelProviderEnum.OpenAIResponses]: [
    { modelId: 'gpt-5.2', capabilities: ['tool_use', 'reasoning'] },
    { modelId: 'o4-mini', capabilities: ['tool_use', 'reasoning'] },
  ],
  [ModelProviderEnum.Azure]: [],
  [ModelProviderEnum.ChatGLM6B]: [],
  [ModelProviderEnum.ChatboxAI]: [],
  [ModelProviderEnum.Claude]: [
    { modelId: 'claude-haiku-4-5', capabilities: ['tool_use', 'reasoning'] },
    { modelId: 'claude-3-5-haiku-20241022', capabilities: ['tool_use'] },
  ],
  [ModelProviderEnum.Gemini]: [
    { modelId: 'gemini-3-pro-preview', capabilities: ['tool_use', 'reasoning'] },
    { modelId: 'gemini-2.5-flash', capabilities: ['tool_use', 'reasoning'] },
    { modelId: 'gemini-2.0-flash', capabilities: ['tool_use'] },
  ],
  [ModelProviderEnum.Ollama]: [],
  [ModelProviderEnum.Groq]: [{ modelId: 'llama-3.1-8b-instant', capabilities: ['tool_use'] }],
  [ModelProviderEnum.DeepSeek]: [
    { modelId: 'deepseek-chat', capabilities: ['tool_use', 'reasoning'] },
    { modelId: 'deepseek-reasoner', capabilities: ['tool_use', 'reasoning'] },
  ],
  [ModelProviderEnum.SiliconFlow]: [],
  [ModelProviderEnum.VolcEngine]: [],
  [ModelProviderEnum.MistralAI]: [],
  [ModelProviderEnum.LMStudio]: [],
  [ModelProviderEnum.XAI]: [
    { modelId: 'grok-4-1-fast-reasoning', capabilities: ['tool_use', 'reasoning'] },
    { modelId: 'grok-4-1-fast-non-reasoning', capabilities: ['tool_use'] },
  ],
  [ModelProviderEnum.OpenRouter]: [
    { modelId: 'google/gemini-3-flash-preview', capabilities: ['tool_use', 'reasoning'] },
    { modelId: 'anthropic/claude-haiku-4.5', capabilities: ['tool_use'] },
    { modelId: 'deepseek/deepseek-v3.2', capabilities: ['tool_use', 'reasoning'] },
  ],
  [ModelProviderEnum.LLMApi]: [],
  [ModelProviderEnum.Perplexity]: [],
  [ModelProviderEnum.Custom]: [],
}

function runProviderTest(providerName: ModelProviderEnum) {
  const apiKey = process.env[keyEnv(providerName)] || ''
  const models = PROVIDER_TEST_MODELS[providerName] || []
  const platform = new TestPlatform()
  const sentry = new MockSentryAdapter()

  describe.runIf(apiKey && models.length)(`Provider ${providerName} `, async () => {
    const mockDependencies = await createMockModelDependencies(platform, sentry)
    const systemProvider: ProviderBaseInfo = SystemProviders.find((p) => p.id === providerName)!
    const globalSettings: Settings = {
      ...getDefaultSettings(),
      providers: {
        [providerName]: {
          ...systemProvider.defaultSettings,
          apiKey,
          models,
        },
      },
    }

    it.for(models)(`model $modelId should generate text`, async (modelInfo) => {
      const sessionSettings: SessionSettings = {
        provider: providerName,
        modelId: modelInfo.modelId,
        temperature: 0.7,
        maxTokens: 2048,
        stream: true,
      }
      const model = getModel(sessionSettings, globalSettings, newConfigs(), mockDependencies) as AbstractAISDKModel
      const testMessages: ModelMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Thinking carefully. 12+12=?' }, // Add thinking prompt to trigger reasoning
      ]
      const textResult = await model.chat(testMessages, {})
      const textPart = textResult.contentParts.find((part) => part.type === 'text')
      expect(textPart?.text).toContain('24')
      expect(textResult.finishReason).toEqual('stop')
    })
  })
}

describe.concurrent('Model Provider Integration Tests', () => {
  for (const providerName of Object.keys(aiProviderNameHash) as ModelProviderEnum[]) {
    switch (providerName) {
      case ModelProviderEnum.ChatboxAI: {
        const apiKey = process.env.CHATBOX_LICENSE_KEY
        describe.runIf(apiKey).todo('Provider ChatboxAI', () => {
          it('should have correct provider name', () => {
            expect(aiProviderNameHash[providerName]).toBe(aiProviderNameHash[providerName])
          })
        })
        break
      }
      case ModelProviderEnum.Custom:
        describe.todo('Provider Custom', () => {
          it('should have correct provider name', () => {
            expect(aiProviderNameHash[providerName]).toBe(aiProviderNameHash[providerName])
          })
        })
        break
      case ModelProviderEnum.Ollama:
        describe.todo('Provider Ollama', () => {
          it('should have correct provider name', () => {
            expect(aiProviderNameHash[providerName]).toBe(aiProviderNameHash[providerName])
          })
        })
        break
      default:
        runProviderTest(providerName)
        break
    }
  }
})
