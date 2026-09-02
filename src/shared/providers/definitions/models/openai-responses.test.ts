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
    const openaiResponses = createModel()

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

describe('OpenAIResponses host normalization', () => {
  it('keeps a Copilot-style host unchanged when skipHostNormalization is set', () => {
    const openaiResponses = createModel({
      apiHost: 'https://api.githubcopilot.com',
      apiPath: '/responses',
      skipHostNormalization: true,
      extraHeaders: { 'Openai-Intent': 'conversation-edits' },
    })

    expect(openaiResponses.options.apiHost).toBe('https://api.githubcopilot.com')
    expect(openaiResponses.options.apiPath).toBe('/responses')
    expect(openaiResponses.options.extraHeaders).toEqual({
      'Openai-Intent': 'conversation-edits',
    })
  })

  it('still appends /v1 for standard OpenAI Responses hosts', () => {
    const openaiResponses = createModel({
      apiHost: 'https://api.openai.com',
      apiPath: '/responses',
    })

    expect(openaiResponses.options.apiHost).toBe('https://api.openai.com/v1')
    expect(openaiResponses.options.apiPath).toBe('/responses')
  })
})
