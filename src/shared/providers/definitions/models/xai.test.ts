import { MockLanguageModelV4 } from 'ai/test'
import { expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../../../types/adapters'
import XAI from './xai'

it('uses the OpenAI-compatible reasoning normalization when xAI streaming is disabled', async () => {
  const sdkModel = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        { type: 'text', text: 'Answer' },
        { type: 'reasoning', text: 'Reasoning' },
      ],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 2, text: 1, reasoning: 1 },
      },
      warnings: [],
    }),
  })
  class TestXAI extends XAI {
    protected getChatModel() {
      return sdkModel
    }
  }
  const dependencies: ModelDependencies = {
    request: { apiRequest: vi.fn(), fetchWithOptions: vi.fn() },
    storage: { saveImage: vi.fn(), getImage: vi.fn() },
    sentry: { captureException: vi.fn(), withScope: vi.fn() },
    getRemoteConfig: () => ({}),
  }
  const model = new TestXAI(
    { apiKey: 'test-key', model: { modelId: 'grok-4', apiStyle: 'openai' }, stream: false },
    dependencies
  )
  const result = await model.chat([{ role: 'user', content: 'Think' }], {})
  expect(result.contentParts).toMatchObject([
    { type: 'reasoning', text: 'Reasoning' },
    { type: 'text', text: 'Answer' },
  ])
})
