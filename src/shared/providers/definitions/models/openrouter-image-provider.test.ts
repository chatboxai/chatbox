import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateImage } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../../../types/adapters'
import type { SentryScope } from '../../../utils/sentry_adapter'
import OpenRouter from './openrouter'

function createDependencies(): ModelDependencies {
  return {
    request: { apiRequest: vi.fn(), fetchWithOptions: vi.fn() },
    storage: { saveImage: vi.fn(), getImage: vi.fn() },
    sentry: {
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback({ setTag: vi.fn(), setExtra: vi.fn() })),
      captureException: vi.fn(),
    },
    getRemoteConfig: vi.fn(),
  }
}

describe('OpenRouter dedicated image provider', () => {
  it('maps image generation options and reference files to the dedicated endpoint', async () => {
    const providerFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ b64_json: 'PHN2Zy8+', media_type: 'image/svg+xml' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    const provider = createOpenRouter({
      apiKey: 'test-key',
      fetch: providerFetch,
    })

    const result = await generateImage({
      model: provider.imageModel('bytedance-seed/seedream-4.5'),
      prompt: {
        text: 'edit this image',
        images: ['https://example.test/reference.png', 'data:image/png;base64,AQID'],
      },
      n: 1,
      aspectRatio: '16:9',
      maxRetries: 0,
    })

    expect(providerFetch).toHaveBeenCalledOnce()
    const [input, init] = providerFetch.mock.calls[0]
    expect(String(input)).toBe('https://openrouter.ai/api/v1/images')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'bytedance-seed/seedream-4.5',
      prompt: 'edit this image',
      n: 1,
      aspect_ratio: '16:9',
      input_references: [
        { type: 'image_url', image_url: { url: 'https://example.test/reference.png' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
      ],
    })
    expect(result.providerMetadata.openrouter).toEqual({
      images: [{ mediaType: 'image/svg+xml' }],
    })
  })

  it('preserves an OpenRouter SVG response media type in the returned data URL', async () => {
    const providerFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: 'PHN2Zy8+', media_type: 'image/svg+xml' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    const model = new OpenRouter(
      {
        apiKey: 'test-key',
        model: { modelId: 'sourceful/riverflow-v2-fast', type: 'image' },
        customFetch: providerFetch,
      },
      createDependencies()
    )

    await expect(model.paint({ prompt: 'vector icon', num: 1 })).resolves.toEqual([
      'data:image/svg+xml;base64,PHN2Zy8+',
    ])
  })
})
