import { describe, expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../../../types/adapters'
import type { SentryScope } from '../../../utils/sentry_adapter'
import { fetchOpenRouterImageModels } from './openrouter-image-api'

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
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback({ setTag: vi.fn(), setExtra: vi.fn() })),
      captureException: vi.fn(),
    },
    getRemoteConfig: vi.fn(),
  }
}

describe('OpenRouter image model discovery', () => {
  it('loads and maps the dedicated image model catalog', async () => {
    const apiRequest = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'bytedance-seed/seedream-4.5',
              name: 'Seedream 4.5',
              description: 'Generate images from text and reference images.',
              supported_parameters: {
                aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] },
                input_references: { type: 'range', min: 1, max: 4 },
              },
            },
            { id: 'sourceful/riverflow-v2-fast' },
          ],
        })
      )
    )

    await expect(fetchOpenRouterImageModels('test-key', createDependencies(apiRequest))).resolves.toEqual([
      {
        modelId: 'bytedance-seed/seedream-4.5',
        nickname: 'Seedream 4.5',
        description: 'Generate images from text and reference images.',
        capabilities: {
          aspectRatio: { values: ['1:1', '16:9'] },
          inputReferences: { min: 1, max: 4 },
        },
      },
      {
        modelId: 'sourceful/riverflow-v2-fast',
        nickname: 'sourceful/riverflow-v2-fast',
        capabilities: { aspectRatio: null, inputReferences: null },
      },
    ])
    expect(apiRequest).toHaveBeenCalledWith({
      url: 'https://openrouter.ai/api/v1/images/models',
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-key',
        'HTTP-Referer': 'https://chatboxai.app',
        'X-Title': 'Chatbox AI',
      },
      useProxy: false,
    })
    expect(apiRequest.mock.calls[0]?.[0].url).not.toContain('test-key')
  })

  it('rejects malformed image model responses', async () => {
    const apiRequest = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ name: 'Missing id' }] })))

    await expect(fetchOpenRouterImageModels('test-key', createDependencies(apiRequest))).rejects.toThrow(
      'Invalid OpenRouter image model response'
    )
  })
})
