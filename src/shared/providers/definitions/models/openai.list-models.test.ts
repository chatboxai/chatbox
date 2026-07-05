import type { ProviderModelInfo } from 'src/shared/types'
import type { ModelDependencies } from 'src/shared/types/adapters'
import { describe, expect, it, vi } from 'vitest'
import OpenAI from './openai'

function createDependencies(): ModelDependencies {
  return {
    request: {
      fetchWithOptions: vi.fn(),
      apiRequest: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    platformType: 'desktop',
    oauth: {
      refreshCredential: vi.fn(),
      persistCredential: vi.fn(),
      clearCredential: vi.fn(),
    },
  }
}

function createModel(
  overrides: Partial<ConstructorParameters<typeof OpenAI>[0]> = {},
  dependencies = createDependencies()
) {
  const model: ProviderModelInfo = {
    modelId: 'coder-model',
    type: 'chat',
  }

  return new OpenAI(
    {
      apiKey: 'oauth-placeholder',
      apiHost: 'https://portal.qwen.ai/v1',
      model,
      dalleStyle: 'vivid',
      injectDefaultMetadata: true,
      useProxy: false,
      stream: false,
      ...overrides,
    },
    dependencies
  )
}

describe('OpenAI listModels', () => {
  it('fetches remote models via custom fetch when provided', async () => {
    const customFetch = vi.fn(async (_input, init) => {
      expect(init?.method).toBe('GET')
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer oauth-placeholder',
        'Openai-Intent': 'conversation-edits',
      })

      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'coder-model', object: 'model', created: 0 },
            { id: 'vision-model', object: 'model', created: 0 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    })

    const openai = createModel({
      customFetch,
      extraHeaders: {
        'Openai-Intent': 'conversation-edits',
      },
      listModelsFallback: [{ modelId: 'fallback-model', type: 'chat' }],
    })

    const models = await openai.listModels()

    expect(customFetch).toHaveBeenCalledOnce()
    expect(models.map((model) => model.modelId)).toEqual(['coder-model', 'vision-model'])
  })

  it('falls back to configured models when remote fetch fails', async () => {
    const fallbackModels: ProviderModelInfo[] = [{ modelId: 'coder-model', type: 'chat' }]
    const openai = createModel({
      customFetch: vi.fn(async () => {
        throw new Error('network error')
      }),
      listModelsFallback: fallbackModels,
    })

    const models = await openai.listModels()

    expect(models).toEqual(fallbackModels)
  })
})
