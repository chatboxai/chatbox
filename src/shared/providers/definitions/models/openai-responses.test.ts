import type { CallChatCompletionOptions } from '@shared/models/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { ProviderModelInfo } from '@shared/types/settings'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { describe, expect, it, vi } from 'vitest'
import OpenAIResponses from './openai-responses'

class TestOpenAIResponses extends OpenAIResponses {
  public exposeCallSettings(options: CallChatCompletionOptions = {}) {
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

function createModel(overrides: Partial<ConstructorParameters<typeof OpenAIResponses>[0]> = {}) {
  const model: ProviderModelInfo = {
    modelId: 'gpt-5.4',
    type: 'chat',
    capabilities: ['tool_use', 'reasoning'],
  }

  return new TestOpenAIResponses(
    {
      apiKey: 'test-key',
      apiHost: 'https://api.openai.com',
      apiPath: '/responses',
      model,
      ...overrides,
    },
    createDependencies()
  )
}

describe('OpenAIResponses call settings', () => {
  it('forces store=false for stateless responses while preserving user OpenAI provider options', () => {
    const openaiResponses = createModel({ forceStatelessResponses: true })

    const settings = openaiResponses.exposeCallSettings({
      providerOptions: {
        openai: {
          reasoningEffort: 'high',
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'high',
        store: false,
      },
    })
  })

  it('does not inject OpenAI provider options when stateless mode is disabled', () => {
    const openaiResponses = createModel()

    const settings = openaiResponses.exposeCallSettings()

    expect(settings.providerOptions).toBeUndefined()
  })
})
