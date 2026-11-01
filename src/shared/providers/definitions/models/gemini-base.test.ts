import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../../../types/adapters'
import CustomGemini from './custom-gemini'
import Gemini from './gemini'

function dependencies(apiRequest: ModelDependencies['request']['apiRequest']): ModelDependencies {
  return {
    request: { apiRequest, fetchWithOptions: vi.fn() },
    storage: { saveImage: vi.fn(), getImage: vi.fn() },
    sentry: { captureException: vi.fn(), withScope: vi.fn() },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
  }
}

const factories = {
  official: (deps: ModelDependencies) =>
    new Gemini(
      {
        geminiAPIKey: 'test-key',
        geminiAPIHost: 'https://example.com',
        model: { modelId: 'gemini-2.5-flash' },
      },
      deps
    ),
  custom: (deps: ModelDependencies) =>
    new CustomGemini(
      {
        apiKey: 'test-key',
        apiHost: 'https://example.com',
        useProxy: true,
        model: { modelId: 'gemini-2.5-flash' },
      },
      deps
    ),
}

afterEach(() => vi.restoreAllMocks())

describe('Gemini model listing', () => {
  it.each(['official', 'custom'] as const)('preserves the %s request and model metadata', async (kind) => {
    const model = (name: string, methods: string[]) => ({
      name: `models/${name}`,
      displayName: name,
      inputTokenLimit: 123_456,
      outputTokenLimit: 8_192,
      supportedGenerationMethods: methods,
    })
    const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            model('gemini-z', ['generateContent']),
            model('other', ['generateContent']),
            model('gemini-embedding', ['embedContent']),
            model('gemini-a', ['generateContent']),
          ],
        })
      )
    )
    expect(await factories[kind](dependencies(apiRequest)).listModels()).toEqual(
      ['gemini-a', 'gemini-z'].map((id) => ({
        modelId: id,
        nickname: id,
        type: 'chat',
        contextWindow: 123_456,
        maxOutput: 8_192,
      }))
    )
    expect(apiRequest).toHaveBeenCalledWith({
      url: 'https://example.com/v1beta/models?key=test-key',
      method: 'GET',
      headers: {},
      ...(kind === 'custom' ? { useProxy: true } : {}),
    })
  })

  it.each(['network', 'invalid payload'] as const)(
    'preserves different provider error policies for %s',
    async (kind) => {
      const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>()
      if (kind === 'network') apiRequest.mockRejectedValue(new Error('offline'))
      else apiRequest.mockImplementation(async () => new Response(JSON.stringify({ error: 'denied' })))
      const deps = dependencies(apiRequest)
      await expect(factories.official(deps).listModels()).rejects.toThrow()
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(factories.custom(deps).listModels()).resolves.toEqual([])
      expect(log).toHaveBeenCalledOnce()
    }
  )
})
