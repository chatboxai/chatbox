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
  it('forces store=false and uses the stable session ID as the prompt cache key', () => {
    const openaiResponses = createModel()

    const settings = openaiResponses.exposeCallSettings({
      sessionId: 'session-123',
      providerOptions: {
        openai: {
          reasoningEffort: 'high',
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'high',
        promptCacheKey: 'session-123',
        store: false,
      },
    })
  })

  it('does not inject an empty prompt cache key when a stateless request has no session ID', () => {
    const openaiResponses = createModel()

    const settings = openaiResponses.exposeCallSettings()

    expect(settings.providerOptions).toEqual({
      openai: {
        store: false,
      },
    })
  })

  it('preserves explicit reasoning encrypted content include for Responses reasoning calls', () => {
    const openaiResponses = createModel()

    const settings = openaiResponses.exposeCallSettings({
      providerOptions: {
        openai: {
          reasoningEffort: 'high',
          reasoningSummary: 'auto',
          include: ['reasoning.encrypted_content'],
          forceReasoning: true,
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'high',
        reasoningSummary: 'auto',
        include: ['reasoning.encrypted_content'],
        forceReasoning: true,
        store: false,
      },
    })
  })

  it('forces store=false even without user-provided OpenAI provider options', () => {
    const openaiResponses = createModel()

    const settings = openaiResponses.exposeCallSettings()

    expect(settings.providerOptions).toEqual({
      openai: {
        store: false,
      },
    })
  })
})
