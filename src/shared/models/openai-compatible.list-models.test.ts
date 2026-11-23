import { describe, expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../types/adapters'
import type { SentryScope } from '../utils/sentry_adapter'
import { fetchRemoteModels } from './openai-compatible'

const mockScope: SentryScope = {
  setTag: vi.fn(),
  setExtra: vi.fn(),
}

function createDependencies(response: Response): ModelDependencies {
  return {
    request: {
      apiRequest: vi.fn().mockResolvedValue(response),
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
    platformType: 'desktop',
  }
}

function listResponse(data: unknown[]): Response {
  return new Response(JSON.stringify({ object: 'list', data }), {
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchRemoteModels', () => {
  it('maps declared capabilities, both context-window spellings and the output ceiling', async () => {
    const dependencies = createDependencies(
      listResponse([
        {
          id: 'deepseek-flash',
          object: 'model',
          name: 'DeepSeek V4.1 Flash',
          context_window: 1_048_576,
          context_length: 1_048_576,
          max_output_tokens: 393_216,
          capabilities: ['prompt-caching', 'reasoning', 'streaming', 'structured-output', 'text', 'tools'],
          supported_parameters: ['reasoning', 'tools'],
          architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          catalog_only_field: 'ignored',
        },
      ])
    )

    const models = await fetchRemoteModels(
      { apiHost: 'https://gateway.dothoosh.com/v1', apiKey: 'dh_test_key' },
      dependencies
    )

    expect(models).toEqual([
      {
        modelId: 'deepseek-flash',
        type: 'chat',
        nickname: 'DeepSeek V4.1 Flash',
        contextWindow: 1_048_576,
        maxOutput: 393_216,
        capabilities: ['reasoning', 'tool_use'],
      },
    ])
  })

  it('keeps the OpenRouter response mapping and marks vision only when declared', async () => {
    const dependencies = createDependencies(
      listResponse([
        {
          id: 'openrouter/vision-model',
          object: 'model',
          context_length: 200_000,
          architecture: { input_modalities: ['text', 'image'] },
          pricing: { web_search: '0.001', internal_reasoning: '0.002' },
          supported_parameters: ['reasoning', 'include_reasoning'],
        },
      ])
    )

    const models = await fetchRemoteModels(
      { apiHost: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-test' },
      dependencies
    )

    expect(models).toEqual([
      {
        modelId: 'openrouter/vision-model',
        type: 'chat',
        contextWindow: 200_000,
        capabilities: ['vision', 'web_search', 'reasoning'],
      },
    ])
  })

  it('accepts a partial catalog without inventing capabilities', async () => {
    const dependencies = createDependencies(listResponse([{ id: 'bare-model', object: 'model' }]))

    const models = await fetchRemoteModels(
      { apiHost: 'https://gateway.dothoosh.com/v1', apiKey: 'dh_test_key' },
      dependencies
    )

    expect(models).toEqual([{ modelId: 'bare-model', type: 'chat' }])
  })

  it('rejects a response without a data array', async () => {
    const dependencies = createDependencies(
      new Response(JSON.stringify({ error: { message: 'unauthorized' } }), {
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(
      fetchRemoteModels({ apiHost: 'https://gateway.dothoosh.com/v1', apiKey: '' }, dependencies)
    ).rejects.toThrow('API Error')
  })
})
