/**
 * Opt-in, billable OpenRouter image round trip.
 *
 * Required environment:
 * RUN_OPENROUTER_IMAGE_LIVE=1
 * OPENROUTER_API_KEY=...
 * OPENROUTER_IMAGE_LIVE_MODEL=...  # explicit prompt-only model id
 *
 * Run:
 * pnpm test:openrouter-image-live
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import TestPlatform from '../../../src/renderer/platform/test_platform'
import OpenRouter from '../../../src/shared/providers/definitions/models/openrouter'
import { fetchOpenRouterImageModels } from '../../../src/shared/providers/definitions/models/openrouter-image-api'
import { createMockModelDependencies } from '../mocks/model-dependencies'
import { MockSentryAdapter } from '../mocks/sentry'

const shouldRun = process.env.RUN_OPENROUTER_IMAGE_LIVE === '1'
const apiKey = process.env.OPENROUTER_API_KEY?.trim() || ''
const modelId = process.env.OPENROUTER_IMAGE_LIVE_MODEL?.trim() || ''

describe.runIf(shouldRun)('OpenRouter image live round trip', () => {
  beforeAll(() => {
    expect(Boolean(apiKey), 'OPENROUTER_API_KEY is required for the billable OpenRouter image test').toBe(true)
    expect(
      Boolean(modelId),
      'OPENROUTER_IMAGE_LIVE_MODEL is required so a human explicitly selects the billable image model'
    ).toBe(true)
  })

  it('discovers the selected model and generates a real image through the production provider', async () => {
    const dependencies = await createMockModelDependencies(new TestPlatform(), new MockSentryAdapter())
    const catalog = await fetchOpenRouterImageModels(apiKey, dependencies)
    const catalogModel = catalog.find((model) => model.modelId === modelId)
    expect(catalogModel, `OpenRouter image catalog must contain ${modelId}`).toBeDefined()
    expect(catalogModel?.capabilities.inputReferences?.min ?? 0).toBe(0)

    const nativeFetch = globalThis.fetch.bind(globalThis)
    let postRequestCount = 0
    const trackedFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if ((init?.method || 'GET') === 'POST') {
        postRequestCount += 1
        expect(url.origin).toBe('https://openrouter.ai')
        expect(url.pathname).toBe('/api/v1/images')
        expect(new Headers(init?.headers).get('authorization')?.startsWith('Bearer ')).toBe(true)
      }
      return nativeFetch(input, init)
    })
    const model = new OpenRouter(
      {
        apiKey,
        model: { modelId, type: 'image' },
        customFetch: trackedFetch,
      },
      dependencies
    )
    const generatedImages: string[] = []
    const aspectRatio = catalogModel?.capabilities.aspectRatio?.values?.[0]

    const result = await model.paint(
      {
        prompt: 'A simple solid blue square centered on a plain white background.',
        num: 1,
        aspectRatio,
      },
      undefined,
      (image) => {
        generatedImages.push(image)
      }
    )

    expect(postRequestCount).toBe(1)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/^data:image\/[a-z0-9.+-]+;base64,/i)
    expect(generatedImages).toEqual(result)
  })
})
