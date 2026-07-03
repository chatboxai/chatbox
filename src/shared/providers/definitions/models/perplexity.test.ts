import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { CallChatCompletionOptions } from '@shared/models/types'
import type { ProviderModelInfo } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { describe, expect, it, vi } from 'vitest'
import Perplexity from './perplexity'

const perplexityMocks = vi.hoisted(() => {
  const languageModel: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'perplexity',
    modelId: 'sonar-pro',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  }

  const createPerplexity = vi.fn(() => ({
    languageModel: vi.fn(() => languageModel),
  }))

  return { createPerplexity }
})

vi.mock('@ai-sdk/perplexity', () => ({
  createPerplexity: perplexityMocks.createPerplexity,
}))

vi.mock('ai', () => ({
  extractReasoningMiddleware: vi.fn(() => ({})),
  wrapLanguageModel: vi.fn(({ model }) => model),
  simulateStreamingMiddleware: vi.fn(),
}))

class TestPerplexity extends Perplexity {
  public exposeCallSettings(options: CallChatCompletionOptions) {
    return this.getCallSettings(options)
  }
}

function createDependencies(): ModelDependencies {
  return {
    request: {
      apiRequest: vi.fn(),
      fetchWithOptions: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) =>
        callback({
          setTag: vi.fn(),
          setExtra: vi.fn(),
        })
      ),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
  }
}

const baseModel: ProviderModelInfo = { modelId: 'sonar-pro' }
const emptyOptions: CallChatCompletionOptions = {}

function makeModel(opts: {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
}) {
  return new TestPerplexity(
    {
      perplexityApiKey: 'pplx-test',
      model: baseModel,
      ...opts,
    },
    createDependencies()
  )
}

describe('Perplexity.getCallSettings', () => {
  it('passes temperature through', () => {
    const model = makeModel({ temperature: 0.7 })
    expect(model.exposeCallSettings(emptyOptions).temperature).toBe(0.7)
  })

  it('passes topP through', () => {
    const model = makeModel({ topP: 0.9 })
    expect(model.exposeCallSettings(emptyOptions).topP).toBe(0.9)
  })

  it('omits maxOutputTokens when not set', () => {
    const model = makeModel({})
    expect(model.exposeCallSettings(emptyOptions).maxOutputTokens).toBeUndefined()
  })

  it('floors maxOutputTokens to 16 when value is below minimum', () => {
    // Perplexity API rejects max_tokens < 16 with HTTP 400
    for (const bad of [1, 5, 10, 15]) {
      const model = makeModel({ maxOutputTokens: bad })
      expect(model.exposeCallSettings(emptyOptions).maxOutputTokens).toBe(16)
    }
  })

  it('passes maxOutputTokens through unchanged when at minimum', () => {
    const model = makeModel({ maxOutputTokens: 16 })
    expect(model.exposeCallSettings(emptyOptions).maxOutputTokens).toBe(16)
  })

  it('passes maxOutputTokens through unchanged when above minimum', () => {
    for (const good of [100, 1024, 8192]) {
      const model = makeModel({ maxOutputTokens: good })
      expect(model.exposeCallSettings(emptyOptions).maxOutputTokens).toBe(good)
    }
  })
})
