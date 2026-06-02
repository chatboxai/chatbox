import type { ModelDependencies } from '@shared/types/adapters'
import type { ProviderModelInfo } from '@shared/types/settings'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { describe, expect, it, vi } from 'vitest'
import OrcaRouter from './orcarouter'

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
    getRemoteConfig: vi.fn().mockReturnValue({ setting_chatboxai_first: false }),
  }
}

function createOrcaRouter(modelId = 'orcarouter/auto') {
  const model: ProviderModelInfo = { modelId, type: 'chat' }
  return new OrcaRouter(
    {
      apiKey: 'sk-orca-test',
      model,
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 1024,
      stream: true,
    },
    createDependencies()
  )
}

describe('OrcaRouter model', () => {
  it('pins apiHost to https://api.orcarouter.ai/v1', () => {
    const o = createOrcaRouter()
    expect(o.options.apiHost).toBe('https://api.orcarouter.ai/v1')
  })

  it('exposes the provider name OrcaRouter', () => {
    const o = createOrcaRouter()
    expect(o.name).toBe('OrcaRouter')
  })

  it('passes constructor options through to the model class', () => {
    const o = createOrcaRouter('openai/gpt-5.5')
    expect(o.options.apiKey).toBe('sk-orca-test')
    expect(o.options.model.modelId).toBe('openai/gpt-5.5')
    expect(o.options.temperature).toBe(0.7)
    expect(o.options.topP).toBe(0.9)
    expect(o.options.maxOutputTokens).toBe(1024)
    expect(o.options.stream).toBe(true)
  })
})
