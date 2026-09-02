import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AzureOpenAI from './azure'

class TestAzureOpenAI extends AzureOpenAI {
  public exposeChatModel() {
    return this.getChatModel()
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

function createModel(endpoint: string, apiVersion: string) {
  return new TestAzureOpenAI(
    {
      azureEndpoint: endpoint,
      azureApikey: 'test-key',
      azureApiVersion: apiVersion,
      azureDalleDeploymentName: '',
      model: { modelId: 'chat-deployment', type: 'chat' },
      dalleStyle: 'vivid',
      imageGenerateNum: 1,
      injectDefaultMetadata: false,
    },
    createDependencies()
  )
}

const request: LanguageModelV3CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
}

function mockSuccessfulFetch() {
  const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'chat-deployment',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { 'content-type': 'application/json' } }
    )
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestedUrl(fetchMock: ReturnType<typeof mockSuccessfulFetch>) {
  const input = fetchMock.mock.calls[0]?.[0]
  return input instanceof Request ? input.url : String(input)
}

describe('Azure OpenAI endpoint routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the v1 API for standard Azure OpenAI endpoints', async () => {
    const fetchMock = mockSuccessfulFetch()

    await createModel('https://resource.openai.azure.com', 'v1').exposeChatModel().doGenerate(request)

    expect(requestedUrl(fetchMock)).toBe('https://resource.openai.azure.com/openai/v1/chat/completions?api-version=v1')
  })

  it('preserves v1 Azure routing for custom gateways', async () => {
    const fetchMock = mockSuccessfulFetch()

    await createModel('https://azure-gateway.example.com', 'v1').exposeChatModel().doGenerate(request)

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://azure-gateway.example.com/openai/v1/chat/completions?api-version=v1'
    )
    expect(requestedUrl(fetchMock)).toBe('https://azure-gateway.example.com/openai/v1/chat/completions?api-version=v1')
  })

  it('uses deployment routing when a dated Azure API version is configured', async () => {
    const fetchMock = mockSuccessfulFetch()

    await createModel('https://resource.cognitiveservices.azure.com', '2024-05-01-preview')
      .exposeChatModel()
      .doGenerate(request)

    expect(requestedUrl(fetchMock)).toBe(
      'https://resource.cognitiveservices.azure.com/openai/deployments/chat-deployment/chat/completions?api-version=2024-05-01-preview'
    )
  })
})
