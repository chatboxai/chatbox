import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AzureOpenAI from './azure'
import MistralAI from './mistral-ai'
import OpenRouter from './openrouter'
import Perplexity from './perplexity'

class TestAzureOpenAI extends AzureOpenAI {
  public exposeChatModel() {
    return this.getChatModel()
  }
}

class TestMistralAI extends MistralAI {
  public exposeChatModel() {
    return this.getChatModel()
  }
}

class TestOpenRouter extends OpenRouter {
  public exposeChatModel() {
    return this.getChatModel()
  }
}

class TestPerplexity extends Perplexity {
  public exposeChatModel() {
    return this.getChatModel()
  }
}

const encoder = new TextEncoder()
const request: LanguageModelV3CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
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

function createHeldOpenFetch(onCancel: () => void) {
  return vi.fn<typeof globalThis.fetch>(() => {
    const chunks = [
      'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"answer"},"finish_reason":null}]}\n\n',
      'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"content":null},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          },
          cancel() {
            onCancel()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    )
  })
}

async function readParts(
  model: LanguageModelV3,
  requestOverrides: Partial<LanguageModelV3CallOptions> = {}
): Promise<LanguageModelV3StreamPart[]> {
  const { stream } = await model.doStream({ ...request, ...requestOverrides })
  const parts: LanguageModelV3StreamPart[] = []
  const reader = stream.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('provider stream did not terminate at [DONE]')), 1_000)
  })
  const consume = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return parts
      parts.push(value)
    }
  })()
  try {
    return await Promise.race([consume, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function expectLogicalTermination(
  model: LanguageModelV3,
  onCancel: ReturnType<typeof vi.fn>,
  requestOverrides: Partial<LanguageModelV3CallOptions> = {}
) {
  const parts = await readParts(model, requestOverrides)
  expect(parts).toContainEqual(
    expect.objectContaining({
      type: 'finish',
      finishReason: expect.objectContaining({ unified: 'stop' }),
    })
  )
  await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
}

describe('first-class OpenAI Chat SSE providers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('terminates an OpenRouter custom fetch at DONE without losing its request metadata', async () => {
    const onCancel = vi.fn()
    const customFetch = createHeldOpenFetch(onCancel)
    const abortController = new AbortController()
    const model = new TestOpenRouter(
      {
        apiKey: 'test-key',
        model: { modelId: 'openai/gpt-test', type: 'chat' },
        customFetch,
      },
      createDependencies()
    ).exposeChatModel()

    await expectLogicalTermination(model, onCancel, { abortSignal: abortController.signal })

    const [input, init] = customFetch.mock.calls[0]
    expect(String(input)).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key')
    expect(new Headers(init?.headers).get('http-referer')).toBe('https://chatboxai.app')
    expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true })
    expect(init?.signal).toBe(abortController.signal)
  })

  it('terminates Azure after preserving the custom-gateway URL rewrite', async () => {
    const onCancel = vi.fn()
    const fetchMock = createHeldOpenFetch(onCancel)
    vi.stubGlobal('fetch', fetchMock)
    const model = new TestAzureOpenAI(
      {
        azureEndpoint: 'https://azure-gateway.example.com',
        azureApikey: 'test-key',
        azureApiVersion: 'v1',
        azureDalleDeploymentName: '',
        model: { modelId: 'chat-deployment', type: 'chat' },
        dalleStyle: 'vivid',
        imageGenerateNum: 1,
        injectDefaultMetadata: false,
      },
      createDependencies()
    ).exposeChatModel()

    await expectLogicalTermination(model, onCancel)

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://azure-gateway.example.com/openai/v1/chat/completions?api-version=v1'
    )
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('test-key')
  })

  it('terminates the locked Mistral chat adapter at its exact DONE marker', async () => {
    const onCancel = vi.fn()
    const fetchMock = createHeldOpenFetch(onCancel)
    vi.stubGlobal('fetch', fetchMock)
    const model = new TestMistralAI(
      {
        apiKey: 'test-key',
        model: { modelId: 'mistral-test', type: 'chat' },
      },
      createDependencies()
    ).exposeChatModel()

    await expectLogicalTermination(model, onCancel)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.mistral.ai/v1/chat/completions')
  })

  it('terminates the locked Perplexity chat adapter at its exact DONE marker', async () => {
    const onCancel = vi.fn()
    const fetchMock = createHeldOpenFetch(onCancel)
    vi.stubGlobal('fetch', fetchMock)
    const model = new TestPerplexity(
      {
        perplexityApiKey: 'test-key',
        model: { modelId: 'sonar', type: 'chat' },
      },
      createDependencies()
    ).exposeChatModel()

    await expectLogicalTermination(model, onCancel)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.perplexity.ai/chat/completions')
  })
})
