import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { Provider } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../types/adapters'
import type { SentryScope } from '../utils/sentry_adapter'
import AbstractAISDKModel from './abstract-ai-sdk'
import type { CallChatCompletionOptions } from './types'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 0, reasoning: 1 },
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
    getRemoteConfig: vi.fn(() => ({})),
  } as unknown as ModelDependencies
}

class StreamTestModel extends AbstractAISDKModel {
  public constructor(
    private readonly languageModel: MockLanguageModelV3,
    apiStyle: 'anthropic' | 'openai-responses'
  ) {
    super(
      {
        model: {
          modelId: 'test-model',
          type: 'chat',
          apiStyle,
          capabilities: ['reasoning', 'tool_use'],
        },
      },
      createDependencies()
    )
  }

  protected getProvider(
    _options: CallChatCompletionOptions
  ): Pick<Provider, 'languageModel'> & Partial<Pick<Provider, 'embeddingModel' | 'imageModel'>> {
    return { languageModel: () => this.languageModel }
  }

  protected getChatModel(_options: CallChatCompletionOptions) {
    return this.languageModel
  }
}

function createStreamModel(chunks: LanguageModelV3StreamPart[], provider: string) {
  return new MockLanguageModelV3({
    provider,
    modelId: 'test-model',
    doStream: () =>
      Promise.resolve({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          ...chunks,
          { type: 'finish', finishReason: { unified: 'stop' as const, raw: undefined }, usage },
        ] satisfies LanguageModelV3StreamPart[]),
      }),
  })
}

describe('AbstractAISDKModel reasoning metadata aggregation', () => {
  it('persists Anthropic signatures and marks empty signed blocks protocol-only', async () => {
    const languageModel = createStreamModel(
      [
        { type: 'reasoning-start', id: 'reasoning-0' },
        {
          type: 'reasoning-delta',
          id: 'reasoning-0',
          delta: '',
          providerMetadata: { anthropic: { signature: 'signature-a' } },
        },
        { type: 'reasoning-end', id: 'reasoning-0' },
        { type: 'reasoning-start', id: 'reasoning-1' },
        { type: 'reasoning-delta', id: 'reasoning-1', delta: 'Visible thought' },
        {
          type: 'reasoning-delta',
          id: 'reasoning-1',
          delta: '',
          providerMetadata: { anthropic: { signature: 'signature-b' } },
        },
        { type: 'reasoning-end', id: 'reasoning-1' },
        { type: 'text-start', id: 'text-0' },
        { type: 'text-delta', id: 'text-0', delta: 'Answer' },
        { type: 'text-end', id: 'text-0' },
      ],
      'anthropic.messages'
    )

    const response = await new StreamTestModel(languageModel, 'anthropic').chat(
      [{ role: 'user', content: 'think' }],
      {}
    )

    expect(response.contentParts).toMatchObject([
      {
        type: 'reasoning',
        text: '',
        providerMetadata: { anthropic: { signature: 'signature-a' } },
        protocolOnly: true,
      },
      {
        type: 'reasoning',
        text: 'Visible thought',
        providerMetadata: { anthropic: { signature: 'signature-b' } },
      },
      { type: 'text', text: 'Answer' },
    ])
    expect(response.contentParts[1]).not.toHaveProperty('protocolOnly')
  })

  it('persists redacted thinking metadata emitted at block start', async () => {
    const languageModel = createStreamModel(
      [
        {
          type: 'reasoning-start',
          id: 'reasoning-0',
          providerMetadata: { anthropic: { redactedData: 'encrypted-thinking' } },
        },
        { type: 'reasoning-end', id: 'reasoning-0' },
        { type: 'text-start', id: 'text-0' },
        { type: 'text-delta', id: 'text-0', delta: 'Answer' },
        { type: 'text-end', id: 'text-0' },
      ],
      'anthropic.messages'
    )

    const response = await new StreamTestModel(languageModel, 'anthropic').chat(
      [{ role: 'user', content: 'think' }],
      {}
    )

    expect(response.contentParts).toMatchObject([
      {
        type: 'reasoning',
        text: '',
        providerMetadata: { anthropic: { redactedData: 'encrypted-thinking' } },
        protocolOnly: true,
      },
      { type: 'text', text: 'Answer' },
    ])
  })

  it('keeps whitespace-only deltas of a signed block verbatim, including leading whitespace', async () => {
    const languageModel = createStreamModel(
      [
        { type: 'reasoning-start', id: 'reasoning-0' },
        { type: 'reasoning-delta', id: 'reasoning-0', delta: '\n ' },
        { type: 'reasoning-delta', id: 'reasoning-0', delta: 'first' },
        { type: 'reasoning-delta', id: 'reasoning-0', delta: '\n\n' },
        { type: 'reasoning-delta', id: 'reasoning-0', delta: 'second' },
        {
          type: 'reasoning-delta',
          id: 'reasoning-0',
          delta: '',
          providerMetadata: { anthropic: { signature: 'signature-a' } },
        },
        { type: 'reasoning-end', id: 'reasoning-0' },
        { type: 'text-start', id: 'text-0' },
        { type: 'text-delta', id: 'text-0', delta: 'Answer' },
        { type: 'text-end', id: 'text-0' },
      ],
      'anthropic.messages'
    )

    const response = await new StreamTestModel(languageModel, 'anthropic').chat(
      [{ role: 'user', content: 'think' }],
      {}
    )

    expect(response.contentParts).toMatchObject([
      {
        type: 'reasoning',
        text: '\n first\n\nsecond',
        providerMetadata: { anthropic: { signature: 'signature-a' } },
      },
      { type: 'text', text: 'Answer' },
    ])
  })

  it('does not create parts for or persist non-whitelisted reasoning metadata', async () => {
    const languageModel = createStreamModel(
      [
        {
          type: 'reasoning-start',
          id: 'reasoning-0',
          providerMetadata: { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' } },
        },
        {
          type: 'reasoning-delta',
          id: 'reasoning-0',
          delta: 'Visible thought',
          providerMetadata: { openai: { itemId: 'rs_1' } },
        },
        { type: 'reasoning-end', id: 'reasoning-0', providerMetadata: { openai: { itemId: 'rs_1' } } },
        { type: 'text-start', id: 'text-0' },
        { type: 'text-delta', id: 'text-0', delta: 'Answer' },
        { type: 'text-end', id: 'text-0' },
      ],
      'openai.responses'
    )

    const response = await new StreamTestModel(languageModel, 'openai-responses').chat(
      [{ role: 'user', content: 'think' }],
      {}
    )

    expect(response.contentParts).toMatchObject([
      { type: 'reasoning', text: 'Visible thought' },
      { type: 'text', text: 'Answer' },
    ])
    expect(response.contentParts[0]).not.toHaveProperty('providerMetadata')
    expect(response.contentParts[0]).not.toHaveProperty('protocolOnly')
  })
})
