import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'
import { settings as getDefaultSettings, newConfigs } from '../../defaults'
import type { ModelInterface } from '../../models/types'
import { getModel } from '../../providers'
import type { SessionSettings, Settings } from '../../types'
import type { ModelDependencies } from '../../types/adapters'
import type { SentryScope } from '../../utils/sentry_adapter'
import { withResolvedModelApiStyle } from '../api-style'
import {
  applyGitHubCopilotModelMetadata,
  getGitHubCopilotApiStyle,
  githubCopilotUsesResponsesApi,
} from './github-copilot-routing'
import OpenAI from './models/openai'
import OpenAIResponses from './models/openai-responses'

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

function createModel(modelId: string, dependencies: ModelDependencies = createDependencies()) {
  const sessionSettings: SessionSettings = {
    provider: 'github-copilot',
    modelId,
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stream: true,
  }
  const defaultSettings = getDefaultSettings()
  const globalSettings: Settings = {
    ...defaultSettings,
    providers: {
      ...defaultSettings.providers,
      'github-copilot': {
        apiKey: 'ghu-test',
        apiHost: 'https://api.githubcopilot.com',
        models: [{ modelId }],
      },
    },
  }
  return getModel(sessionSettings, globalSettings, newConfigs(), dependencies)
}

describe('GitHub Copilot API style routing', () => {
  it.each([
    ['gpt-5.6-luna', 'openai-responses'],
    ['gpt-5.6-sol', 'openai-responses'],
    ['gpt-5.6-terra', 'openai-responses'],
    ['gpt-5.5', 'openai-responses'],
    ['gpt-5.5-pro', 'openai-responses'],
    ['gpt-6', 'openai-responses'],
    ['gpt-5.3-codex', 'openai-responses'],
    ['gpt-5-codex', 'openai-responses'],
    ['gpt-5.2-codex', 'openai-responses'],
    ['gpt-5', 'openai'],
    ['gpt-4o', 'openai'],
    ['claude-sonnet-5', 'openai'],
    ['claude-haiku-4.5', 'openai'],
    ['gemini-3.7-flash', 'openai'],
    ['kimi-k2.7-code', 'openai'],
  ] as const)('maps %s to %s', (modelId, apiStyle) => {
    expect(getGitHubCopilotApiStyle(modelId)).toBe(apiStyle)
    expect(githubCopilotUsesResponsesApi(modelId)).toBe(apiStyle === 'openai-responses')
  })

  it('stamps apiStyle from the model id even when a record already has the provider-type fallback', () => {
    expect(applyGitHubCopilotModelMetadata({ modelId: 'gpt-5.6-luna' }).apiStyle).toBe('openai-responses')
    expect(applyGitHubCopilotModelMetadata({ modelId: 'gpt-5.6-luna', apiStyle: 'openai' }).apiStyle).toBe(
      'openai-responses'
    )
    expect(applyGitHubCopilotModelMetadata({ modelId: 'claude-sonnet-5', apiStyle: 'openai-responses' }).apiStyle).toBe(
      'openai'
    )
  })
})

describe('GitHub Copilot model factory', () => {
  it('creates Responses models for GPT-5.5+ and Codex', () => {
    expect(createModel('gpt-5.6-luna')).toBeInstanceOf(OpenAIResponses)
    expect(createModel('gpt-5.6-sol')).toBeInstanceOf(OpenAIResponses)
    expect(createModel('gpt-5.5')).toBeInstanceOf(OpenAIResponses)
    expect(createModel('gpt-5.3-codex')).toBeInstanceOf(OpenAIResponses)
  })

  it('keeps Chat Completions for older GPT models and non-OpenAI vendors', () => {
    expect(createModel('gpt-5')).toBeInstanceOf(OpenAI)
    expect(createModel('gpt-4o')).toBeInstanceOf(OpenAI)
    expect(createModel('claude-sonnet-5')).toBeInstanceOf(OpenAI)
    expect(createModel('gemini-3.7-flash')).toBeInstanceOf(OpenAI)
    expect(createModel('kimi-k2.7-code')).toBeInstanceOf(OpenAI)
  })

  it('routes by model id even when the stored record still has the OpenAI provider-type fallback', () => {
    const sessionSettings: SessionSettings = {
      provider: 'github-copilot',
      modelId: 'gpt-5.6-luna',
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
      stream: true,
    }
    const defaultSettings = getDefaultSettings()
    const globalSettings: Settings = {
      ...defaultSettings,
      providers: {
        ...defaultSettings.providers,
        'github-copilot': {
          apiKey: 'ghu-test',
          apiHost: 'https://api.githubcopilot.com',
          models: [{ modelId: 'gpt-5.6-luna', apiStyle: 'openai' }],
        },
      },
    }

    const model = getModel(sessionSettings, globalSettings, newConfigs(), createDependencies())
    expect(model).toBeInstanceOf(OpenAIResponses)
    expect(model.apiStyle).toBe('openai-responses')
  })

  it('keeps Copilot Responses requests on the host without a /v1 prefix', () => {
    const model = createModel('gpt-5.6-luna')
    expect(model).toBeInstanceOf(OpenAIResponses)
    expect((model as OpenAIResponses).options.apiHost).toBe('https://api.githubcopilot.com')
    expect((model as OpenAIResponses).options.apiPath).toBe('/responses')
    expect((model as OpenAIResponses).options.extraHeaders).toEqual({
      'Openai-Intent': 'conversation-edits',
    })
  })

  it('keeps Copilot Chat Completions requests on the host without a /v1 prefix', () => {
    const model = createModel('claude-sonnet-5')
    expect(model).toBeInstanceOf(OpenAI)
    expect((model as OpenAI).options.apiHost).toBe('https://api.githubcopilot.com')
    expect((model as OpenAI).options.extraHeaders).toEqual({
      'Openai-Intent': 'conversation-edits',
    })
  })

  it('posts GPT-5.6 Luna to /responses instead of /chat/completions', async () => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    apiRequest.mockResolvedValueOnce(responsesApiReply())

    const model = createModel('gpt-5.6-luna', dependencies)
    await exposeChatModel(model).doGenerate(generateRequest)

    const request = apiRequest.mock.calls[0]?.[0]
    expect(request?.url).toBe('https://api.githubcopilot.com/responses')
    expect(request?.method).toBe('POST')
    expect(request?.headers).toEqual(
      expect.objectContaining({
        'openai-intent': 'conversation-edits',
      })
    )
    expect(String(request?.body)).toContain('"input"')
    expect(String(request?.body)).not.toContain('"messages"')
  })

  it('posts Claude models to /chat/completions', async () => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    apiRequest.mockResolvedValueOnce(chatCompletionsReply())

    const model = createModel('claude-sonnet-5', dependencies)
    await exposeChatModel(model).doGenerate(generateRequest)

    const request = apiRequest.mock.calls[0]?.[0]
    expect(request?.url).toBe('https://api.githubcopilot.com/chat/completions')
    expect(request?.method).toBe('POST')
    expect(request?.headers).toEqual(
      expect.objectContaining({
        'openai-intent': 'conversation-edits',
      })
    )
    expect(String(request?.body)).toContain('"messages"')
  })

  it('stamps apiStyle onto remote catalog models', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.request.apiRequest).mockResolvedValueOnce(
      jsonReply({
        data: [{ id: 'gpt-5.6-luna' }, { id: 'claude-sonnet-5' }],
      })
    )

    const models = await (createModel('gpt-5.6-luna', dependencies) as OpenAIResponses).listModels()

    expect(models.find((item) => item.modelId === 'gpt-5.6-luna')?.apiStyle).toBe('openai-responses')
    expect(models.find((item) => item.modelId === 'claude-sonnet-5')?.apiStyle).toBe('openai')
  })

  it('stamps apiStyle onto OAuth fallback catalog records', async () => {
    const sessionSettings: SessionSettings = {
      provider: 'github-copilot',
      modelId: 'gpt-5.6-luna',
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
      stream: true,
    }
    const defaultSettings = getDefaultSettings()
    const globalSettings: Settings = {
      ...defaultSettings,
      providers: {
        ...defaultSettings.providers,
        'github-copilot': {
          activeAuthMode: 'oauth',
          oauth: { accessToken: 'copilot-token' },
          models: [{ modelId: 'gpt-5.6-luna' }, { modelId: 'claude-sonnet-5', apiStyle: 'openai-responses' }],
        },
      },
    }

    const models = await (
      getModel(sessionSettings, globalSettings, newConfigs(), createDependencies()) as OpenAIResponses
    ).listModels()

    expect(models.find((item) => item.modelId === 'gpt-5.6-luna')?.apiStyle).toBe('openai-responses')
    expect(models.find((item) => item.modelId === 'claude-sonnet-5')?.apiStyle).toBe('openai')
  })
})

describe('GitHub Copilot reasoning catalog metadata', () => {
  it('overwrites provider-type fallback so stored Copilot records match the wire protocol', () => {
    expect(
      withResolvedModelApiStyle(
        { modelId: 'gpt-5.6-luna', apiStyle: 'openai' },
        { providerId: 'github-copilot', providerType: 'openai' }
      ).apiStyle
    ).toBe('openai-responses')
    expect(
      withResolvedModelApiStyle(
        { modelId: 'claude-sonnet-5' },
        { providerId: 'github-copilot', providerType: 'openai' }
      ).apiStyle
    ).toBe('openai')
  })
})

const generateRequest: LanguageModelV3CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
}

function exposeChatModel(model: ModelInterface): LanguageModelV3 {
  return (model as unknown as { getChatModel(options?: object): LanguageModelV3 }).getChatModel({})
}

function jsonReply(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
}

function responsesApiReply() {
  return jsonReply({
    id: 'resp_test',
    object: 'response',
    created_at: 0,
    status: 'completed',
    model: 'gpt-5.6-luna',
    output: [
      {
        id: 'msg_test',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello', annotations: [] }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  })
}

function chatCompletionsReply() {
  return jsonReply({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'claude-sonnet-5',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
}
