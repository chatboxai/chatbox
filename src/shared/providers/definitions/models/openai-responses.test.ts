import type { CallChatCompletionOptions } from '@shared/models/types'
import { ModelProviderEnum } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { ProviderModelInfo } from '@shared/types/settings'
import { resolveReasoningReplayPolicy } from '@shared/utils/reasoning-control'
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

describe('OpenAIResponses protocol reporting', () => {
  // `definitions/openai.ts` builds this class for the OpenAI OAuth route from a plain OpenAI
  // *chat* catalog entry, whose `apiStyle` falls back to `openai`. Reasoning-control resolves its
  // effective provider from `apiStyle`, so an inherited `openai` silently routes the OAuth
  // follow-up through the chat-completions replay path and never replays the encrypted
  // reasoning item the previous response returned.
  const chatCatalogEntry: ProviderModelInfo = {
    modelId: 'gpt-5.4',
    type: 'chat',
    apiStyle: 'openai',
    capabilities: ['tool_use', 'reasoning'],
  }

  it('reports the Responses protocol instead of the catalog entry style', () => {
    const model = createModel({ model: chatCatalogEntry })

    expect(model.apiStyle).toBe('openai-responses')
  })

  it('resolves the Responses reasoning replay policy for an instance built from a chat entry', () => {
    const model = createModel({ model: chatCatalogEntry })

    expect(
      resolveReasoningReplayPolicy(ModelProviderEnum.OpenAI, {
        modelId: model.modelId,
        type: 'chat',
        apiStyle: model.apiStyle,
      })
    ).toEqual({ preserveReasoning: 'all-turns', signedReasoningOnly: true, replayNamespaces: ['openai'] })
  })
})

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
