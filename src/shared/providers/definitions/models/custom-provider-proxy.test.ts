import type { ApiRequestOptions, ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelProviderType } from '../../../types'
import type { CreateModelConfig } from '../../types'
import { createCustomProviderModel } from '../../utils'
import CustomClaude from './custom-claude'
import CustomGemini from './custom-gemini'

const mockScope: SentryScope = {
  setTag: vi.fn(),
  setExtra: vi.fn(),
}

function createDependencies(apiRequest: ModelDependencies['request']['apiRequest']): ModelDependencies {
  return {
    request: {
      apiRequest,
      fetchWithOptions: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback(mockScope)),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'mobile',
  }
}

describe('custom provider network compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards useProxy when creating Custom Claude and Gemini models', () => {
    const dependencies = createDependencies(vi.fn())
    const config = {
      settings: {} as CreateModelConfig['settings'],
      globalSettings: {} as CreateModelConfig['globalSettings'],
      config: {} as CreateModelConfig['config'],
      dependencies,
      providerSetting: { useProxy: true },
      formattedApiHost: 'http://192.168.1.10:8000',
      formattedApiPath: '',
      model: { modelId: 'test-model', type: 'chat' as const },
      effectiveApiKey: 'test-key',
    } satisfies CreateModelConfig

    const claude = createCustomProviderModel(config, ModelProviderType.Claude, dependencies) as CustomClaude
    const gemini = createCustomProviderModel(config, ModelProviderType.Gemini, dependencies) as CustomGemini

    expect(claude.options.useProxy).toBe(true)
    expect(gemini.options.useProxy).toBe(true)
  })

  it('routes Custom Claude chat and model listing through useProxy', async () => {
    const apiRequest = vi.fn((options: ApiRequestOptions) => {
      if (options.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              model: 'claude-test',
              content: [{ type: 'text', text: 'ok' }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        )
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: 'claude-test', type: 'model' }],
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      )
    })
    const dependencies = createDependencies(apiRequest)
    const model = new CustomClaude(
      {
        apiKey: 'test-key',
        apiHost: 'http://192.168.1.10:8000/v1',
        model: { modelId: 'claude-test', type: 'chat' },
        useProxy: true,
      },
      dependencies
    )

    await model.chat([{ role: 'user', content: 'hello' }], {})
    await model.listModels()

    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'http://192.168.1.10:8000/v1/messages',
        useProxy: true,
        retry: 0,
      })
    )
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'http://192.168.1.10:8000/v1/models?limit=990',
        useProxy: true,
      })
    )
  })

  it('routes Custom Gemini chat and model listing through useProxy', async () => {
    const apiRequest = vi.fn((options: ApiRequestOptions) => {
      if (options.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: 'ok' }] },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: {
                promptTokenCount: 1,
                candidatesTokenCount: 1,
                totalTokenCount: 2,
              },
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        )
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            models: [
              {
                name: 'models/gemini-test',
                version: '1',
                displayName: 'Gemini Test',
                description: '',
                inputTokenLimit: 1024,
                outputTokenLimit: 128,
                supportedGenerationMethods: ['generateContent'],
                temperature: 1,
                topP: 1,
                topK: 1,
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      )
    })
    const dependencies = createDependencies(apiRequest)
    const model = new CustomGemini(
      {
        apiKey: 'test-key',
        apiHost: 'http://192.168.1.10:8000',
        model: { modelId: 'gemini-test', type: 'chat' },
        useProxy: true,
      },
      dependencies
    )

    await model.chat([{ role: 'user', content: 'hello' }], {})
    await model.listModels()

    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: expect.stringContaining('http://192.168.1.10:8000/v1beta/models/gemini-test:'),
        useProxy: true,
        retry: 0,
      })
    )
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'http://192.168.1.10:8000/v1beta/models?key=test-key',
        useProxy: true,
      })
    )
  })
})
