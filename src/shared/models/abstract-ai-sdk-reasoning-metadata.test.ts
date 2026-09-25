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
    apiStyle: 'anthropic' | 'openai-responses' | 'google'
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

  it('persists OpenAI Responses encrypted reasoning metadata for replay', async () => {
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
      {
        type: 'reasoning',
        text: 'Visible thought',
        providerMetadata: { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' } },
      },
      { type: 'text', text: 'Answer' },
    ])
  })

  it('persists Gemini thought signatures on both reasoning and text parts', async () => {
    const languageModel = createStreamModel(
      [
        {
          type: 'reasoning-start',
          id: 'reasoning-0',
          providerMetadata: { google: { thoughtSignature: 'thought-sig' } },
        },
        {
          type: 'reasoning-delta',
          id: 'reasoning-0',
          delta: 'Visible thought',
          providerMetadata: { google: { thoughtSignature: 'thought-sig' } },
        },
        { type: 'reasoning-end', id: 'reasoning-0' },
        { type: 'text-start', id: 'text-0' },
        {
          type: 'text-delta',
          id: 'text-0',
          delta: 'Answer',
          providerMetadata: { google: { thoughtSignature: 'answer-sig' } },
        },
        { type: 'text-end', id: 'text-0' },
      ],
      'google.generative-ai'
    )

    const response = await new StreamTestModel(languageModel, 'google').chat([{ role: 'user', content: 'think' }], {})

    expect(response.contentParts).toMatchObject([
      {
        type: 'reasoning',
        text: 'Visible thought',
        providerMetadata: { google: { thoughtSignature: 'thought-sig' } },
      },
      {
        type: 'text',
        text: 'Answer',
        providerMetadata: { google: { thoughtSignature: 'answer-sig' } },
      },
    ])
  })

  it('does not create parts for or persist non-whitelisted reasoning metadata', async () => {
    const languageModel = createStreamModel(
      [
        {
          type: 'reasoning-start',
          id: 'reasoning-0',
          providerMetadata: { mistral: { usage: { promptTokens: 10 } } },
        },
        {
          type: 'reasoning-delta',
          id: 'reasoning-0',
          delta: 'Visible thought',
          providerMetadata: { mistral: { usage: { promptTokens: 10 } } },
        },
        {
          type: 'reasoning-end',
          id: 'reasoning-0',
          providerMetadata: { mistral: { usage: { promptTokens: 10 } } },
        },
        { type: 'text-start', id: 'text-0' },
        { type: 'text-delta', id: 'text-0', delta: 'Answer' },
        { type: 'text-end', id: 'text-0' },
      ],
      'mistral.chat'
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

  // Gemini streams a text part's `thoughtSignature` as an EMPTY trailing delta carrying only
  // provider metadata, and `streamText` drops every `text-delta` whose text is empty. These
  // tests go through the real SDK stream path on purpose: feeding the delta straight into the
  // core processor would pass even without the middleware that preserves it.
  describe('Gemini signature on an empty trailing text delta', () => {
    const signedTrailingTextChunks: LanguageModelV3StreamPart[] = [
      { type: 'text-start', id: 'text-0' },
      { type: 'text-delta', id: 'text-0', delta: 'Answer' },
      {
        type: 'text-delta',
        id: 'text-0',
        delta: '',
        providerMetadata: { google: { thoughtSignature: 'answer-sig' } },
      },
      { type: 'text-end', id: 'text-0' },
    ]

    it('keeps the signature on the text part in chat()', async () => {
      const languageModel = createStreamModel(signedTrailingTextChunks, 'google.generative-ai')

      const response = await new StreamTestModel(languageModel, 'google').chat([{ role: 'user', content: 'think' }], {})

      expect(response.contentParts).toMatchObject([
        {
          type: 'text',
          text: 'Answer',
          providerMetadata: { google: { thoughtSignature: 'answer-sig' } },
        },
      ])
    })

    it('keeps the signature on the streamed text part in chatStream()', async () => {
      const languageModel = createStreamModel(signedTrailingTextChunks, 'google.generative-ai')

      const parts: Array<Record<string, unknown>> = []
      for await (const part of new StreamTestModel(languageModel, 'google').chatStream(
        [{ role: 'user', content: 'think' }],
        {}
      )) {
        parts.push(part as unknown as Record<string, unknown>)
      }

      const signed = parts.find(
        (part) =>
          (part.type === 'text-end' || part.type === 'text-delta') &&
          (part.providerMetadata as { google?: { thoughtSignature?: string } } | undefined)?.google
            ?.thoughtSignature === 'answer-sig'
      )
      expect(signed, `no streamed part carried the signature: ${JSON.stringify(parts)}`).toBeDefined()
    })

    it('closes an unsigned text block so the next block keeps its own signature', async () => {
      // `text-end` is the block boundary, not the presence of metadata — the same rule the core
      // stream-chunk-processor applies.
      const languageModel = createStreamModel(
        [
          { type: 'text-start', id: 'text-0' },
          { type: 'text-delta', id: 'text-0', delta: 'First' },
          { type: 'text-end', id: 'text-0' },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'Second' },
          {
            type: 'text-delta',
            id: 'text-1',
            delta: '',
            providerMetadata: { google: { thoughtSignature: 'second-sig' } },
          },
          { type: 'text-end', id: 'text-1' },
        ],
        'google.generative-ai'
      )

      const response = await new StreamTestModel(languageModel, 'google').chat([{ role: 'user', content: 'think' }], {})

      expect(response.contentParts).toMatchObject([
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second', providerMetadata: { google: { thoughtSignature: 'second-sig' } } },
      ])
      expect(response.contentParts[0]).not.toHaveProperty('providerMetadata')
    })

    it('keeps each consecutive signed text block with its own signature', async () => {
      const languageModel = createStreamModel(
        [
          { type: 'text-start', id: 'text-0' },
          { type: 'text-delta', id: 'text-0', delta: 'First' },
          {
            type: 'text-delta',
            id: 'text-0',
            delta: '',
            providerMetadata: { google: { thoughtSignature: 'first-sig' } },
          },
          { type: 'text-end', id: 'text-0' },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'Second' },
          {
            type: 'text-delta',
            id: 'text-1',
            delta: '',
            providerMetadata: { google: { thoughtSignature: 'second-sig' } },
          },
          { type: 'text-end', id: 'text-1' },
        ],
        'google.generative-ai'
      )

      const response = await new StreamTestModel(languageModel, 'google').chat([{ role: 'user', content: 'think' }], {})

      // Block boundaries must survive: concatenating the two blocks and attaching one
      // signature to the result would associate a signature with the wrong text.
      expect(response.contentParts).toMatchObject([
        {
          type: 'text',
          text: 'First',
          providerMetadata: { google: { thoughtSignature: 'first-sig' } },
        },
        {
          type: 'text',
          text: 'Second',
          providerMetadata: { google: { thoughtSignature: 'second-sig' } },
        },
      ])
    })
  })
})
