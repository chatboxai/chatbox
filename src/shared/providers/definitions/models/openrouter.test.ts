import type { ProviderModelInfo } from 'src/shared/types'
import type { ModelDependencies } from 'src/shared/types/adapters'
import type { SentryScope } from 'src/shared/utils/sentry_adapter'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OpenRouter from './openrouter'

const mockScope: SentryScope = {
  setTag: vi.fn(),
  setExtra: vi.fn(),
}

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
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback(mockScope)),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
    oauth: {
      refreshCredential: vi.fn(),
      persistCredential: vi.fn(),
      clearCredential: vi.fn(),
    },
  }
}

function createModel(modelId: string, type?: ProviderModelInfo['type']) {
  const model: ProviderModelInfo = {
    modelId,
    type,
  }
  return new OpenRouter(
    {
      apiKey: 'test-api-key',
      model,
    },
    createDependencies()
  )
}

// A 1x1 transparent PNG
const TEST_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('OpenRouter image generation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should generate images via the dedicated /images endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          created: 1700000000,
          data: [{ b64_json: TEST_IMAGE_BASE64 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const model = createModel('google/gemini-2.5-flash-image', 'image')
    const results = await model.paint({ prompt: 'a red apple', num: 1 })

    expect(results).toHaveLength(1)
    expect(results[0]).toContain(`base64,${TEST_IMAGE_BASE64}`)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://openrouter.ai/api/v1/images')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('google/gemini-2.5-flash-image')
    expect(body.prompt).toBe('a red apple')
  })

  it('should invoke the progressive callback with data urls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ b64_json: TEST_IMAGE_BASE64 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

    const model = createModel('google/gemini-2.5-flash-image', 'image')
    const callback = vi.fn()
    await model.paint({ prompt: 'a red apple', num: 1 }, undefined, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toMatch(/^data:image\/png;base64,/)
  })
})
