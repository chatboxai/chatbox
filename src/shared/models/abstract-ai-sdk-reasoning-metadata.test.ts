import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { createInitialState, processStreamChunk } from '@chatbox/core/generation'
import type { Provider } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import type { MessageContentParts } from '../types'
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
    private readonly languageModel: MockLanguageModelV4,
    apiStyle: 'anthropic' | 'openai-responses' | 'google',
    stream?: boolean
  ) {
    super(
      {
        stream,
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

function createStreamModel(chunks: LanguageModelV4StreamPart[], provider: string) {
  return new MockLanguageModelV4({
    provider,
    modelId: 'test-model',
    doStream: () =>
      Promise.resolve({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          ...chunks,
          { type: 'finish', finishReason: { unified: 'stop' as const, raw: undefined }, usage },
        ] satisfies LanguageModelV4StreamPart[]),
      }),
  })
}

async function collectParts(model: StreamTestModel, mode: 'chat' | 'chatStream'): Promise<MessageContentParts> {
  if (mode === 'chat') return (await model.chat([{ role: 'user', content: 'think' }], {})).contentParts
  let state = createInitialState()
  for await (const chunk of model.chatStream([{ role: 'user', content: 'think' }], {})) {
    state = (await processStreamChunk(chunk, state, { onFileReceived: async () => '' })).state
  }
  return state.contentParts
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

    const model = new StreamTestModel(languageModel, 'openai-responses')
    model.reasoningReplaySource = 'source-a'
    const response = await model.chat([{ role: 'user', content: 'think' }], {})

    expect(response.contentParts).toMatchObject([
      {
        type: 'reasoning',
        text: 'Visible thought',
        providerMetadata: {
          openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted', chatboxReplaySource: 'source-a' },
        },
      },
      { type: 'text', text: 'Answer' },
    ])
  })

  for (const mode of ['chat', 'chatStream'] as const) {
    it(`drops Responses reasoning metadata without a replay source through ${mode}`, async () => {
      const languageModel = createStreamModel(
        [
          {
            type: 'reasoning-start',
            id: 'rs_0:0',
            providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: null } },
          },
          {
            type: 'reasoning-delta',
            id: 'rs_0:0',
            delta: 'Visible thought',
            providerMetadata: { openai: { itemId: 'rs_0' } },
          },
          {
            type: 'reasoning-end',
            id: 'rs_0:0',
            providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted' } },
          },
          {
            type: 'reasoning-start',
            id: 'rs_1:0',
            providerMetadata: { openai: { itemId: 'rs_1', reasoningEncryptedContent: null } },
          },
          {
            type: 'reasoning-end',
            id: 'rs_1:0',
            providerMetadata: { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' } },
          },
          { type: 'text-start', id: 'text-0' },
          { type: 'text-delta', id: 'text-0', delta: 'Answer' },
          { type: 'text-end', id: 'text-0' },
        ],
        'openai.responses'
      )
      const parts = await collectParts(new StreamTestModel(languageModel, 'openai-responses'), mode)
      expect(parts).toMatchObject([
        { type: 'reasoning', text: 'Visible thought' },
        { type: 'text', text: 'Answer' },
      ])
      expect(parts[0].type === 'reasoning' && parts[0].providerMetadata).toBeFalsy()
    })
  }

  for (const mode of ['chat', 'chatStream'] as const) {
    it(`persists local Responses provenance through ${mode}`, async () => {
      const languageModel = createStreamModel(
        [
          {
            type: 'reasoning-start',
            id: 'rs_0',
            providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: null } },
          },
          {
            type: 'reasoning-end',
            id: 'rs_0',
            providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted' } },
          },
        ],
        'openai.responses'
      )
      const model = new StreamTestModel(languageModel, 'openai-responses')
      model.reasoningReplaySource = 'source-a'
      let parts: MessageContentParts
      if (mode === 'chat') {
        parts = (await model.chat([{ role: 'user', content: 'think' }], {})).contentParts
      } else {
        let state = createInitialState()
        for await (const chunk of model.chatStream([{ role: 'user', content: 'think' }], {})) {
          state = (await processStreamChunk(chunk, state, { onFileReceived: async () => '' })).state
        }
        parts = state.contentParts
      }
      expect(parts).toMatchObject([
        {
          type: 'reasoning',
          text: '',
          protocolOnly: true,
          providerMetadata: {
            openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted', chatboxReplaySource: 'source-a' },
          },
        },
      ])
    })
  }

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

  for (const mode of ['chat', 'chatStream'] as const) {
    it(`preserves Gemini metadata-only trailing deltas through the SDK ${mode} path`, async () => {
      const languageModel = createStreamModel(
        [
          { type: 'text-start', id: 'text-0' },
          { type: 'text-delta', id: 'text-0', delta: 'Answer' },
          {
            type: 'text-delta',
            id: 'text-0',
            delta: '',
            providerMetadata: { google: { thoughtSignature: 'tail-sig' } },
          },
          { type: 'text-end', id: 'text-0' },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'Next answer' },
          {
            type: 'text-delta',
            id: 'text-1',
            delta: '',
            providerMetadata: { google: { thoughtSignature: 'next-sig' } },
          },
          { type: 'text-end', id: 'text-1' },
        ],
        'google.generative-ai'
      )
      const model = new StreamTestModel(languageModel, 'google')
      let parts: MessageContentParts
      if (mode === 'chat') {
        parts = (await model.chat([{ role: 'user', content: 'think' }], {})).contentParts
      } else {
        let state = createInitialState()
        for await (const chunk of model.chatStream([{ role: 'user', content: 'think' }], {})) {
          state = (await processStreamChunk(chunk, state, { onFileReceived: async () => '' })).state
        }
        parts = state.contentParts
      }
      expect(parts).toMatchObject([
        { type: 'text', text: 'Answer', providerMetadata: { google: { thoughtSignature: 'tail-sig' } } },
        { type: 'text', text: 'Next answer', providerMetadata: { google: { thoughtSignature: 'next-sig' } } },
      ])
    })
  }

  for (const mode of ['chat', 'chatStream'] as const) {
    it(`does not create reasoning parts for Responses items without encrypted content through ${mode}`, async () => {
      const languageModel = createStreamModel(
        [
          {
            type: 'reasoning-start',
            id: 'rs_0:0',
            providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: null } },
          },
          {
            type: 'reasoning-end',
            id: 'rs_0:0',
            providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: null } },
          },
          { type: 'text-start', id: 'text-0' },
          { type: 'text-delta', id: 'text-0', delta: 'Answer' },
          { type: 'text-end', id: 'text-0' },
        ],
        'openai.responses'
      )
      expect(await collectParts(new StreamTestModel(languageModel, 'openai-responses'), mode)).toMatchObject([
        { type: 'text', text: 'Answer' },
      ])
    })

    it(`keeps text order around an encrypted-only Responses item through ${mode}`, async () => {
      const languageModel = createStreamModel(
        [
          { type: 'text-start', id: 'text-0' },
          { type: 'text-delta', id: 'text-0', delta: 'Before' },
          { type: 'text-end', id: 'text-0' },
          {
            type: 'reasoning-start',
            id: 'rs_0:0',
            providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: null } },
          },
          {
            type: 'reasoning-end',
            id: 'rs_0:0',
            providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted' } },
          },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'After' },
          { type: 'text-end', id: 'text-1' },
        ],
        'openai.responses'
      )
      const model = new StreamTestModel(languageModel, 'openai-responses')
      model.reasoningReplaySource = 'source-a'
      expect(await collectParts(model, mode)).toMatchObject([
        { type: 'text', text: 'Before' },
        { type: 'reasoning', text: '', protocolOnly: true },
        { type: 'text', text: 'After' },
      ])
    })

    it(`keeps every summary of an encrypted Responses item through ${mode}`, async () => {
      const languageModel = createStreamModel(
        [
          {
            type: 'reasoning-start',
            id: 'rs_0:0',
            providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: null } },
          },
          { type: 'reasoning-delta', id: 'rs_0:0', delta: 'First', providerMetadata: { openai: { itemId: 'rs_0' } } },
          { type: 'reasoning-end', id: 'rs_0:0', providerMetadata: { openai: { itemId: 'rs_0' } } },
          { type: 'reasoning-start', id: 'rs_0:1', providerMetadata: { openai: { itemId: 'rs_0' } } },
          { type: 'reasoning-delta', id: 'rs_0:1', delta: 'Second', providerMetadata: { openai: { itemId: 'rs_0' } } },
          {
            type: 'reasoning-end',
            id: 'rs_0:1',
            providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted' } },
          },
        ],
        'openai.responses'
      )
      const model = new StreamTestModel(languageModel, 'openai-responses')
      model.reasoningReplaySource = 'source-a'
      expect(await collectParts(model, mode)).toMatchObject([
        { type: 'reasoning', text: 'First', providerMetadata: { openai: { itemId: 'rs_0' } } },
        {
          type: 'reasoning',
          text: 'Second',
          providerMetadata: { openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted' } },
        },
      ])
    })

    it(`preserves Gemini text signatures without streaming through ${mode}`, async () => {
      const languageModel = new MockLanguageModelV4({
        provider: 'google.generative-ai',
        modelId: 'test-model',
        doGenerate: async () => ({
          content: [
            { type: 'text', text: 'Answer', providerMetadata: { google: { thoughtSignature: 'inline-sig' } } },
            { type: 'text', text: 'Next answer' },
            { type: 'text', text: '', providerMetadata: { google: { thoughtSignature: 'tail-sig' } } },
          ],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage,
          warnings: [],
        }),
      })
      expect(await collectParts(new StreamTestModel(languageModel, 'google', false), mode)).toMatchObject([
        { type: 'text', text: 'Answer', providerMetadata: { google: { thoughtSignature: 'inline-sig' } } },
        { type: 'text', text: 'Next answer', providerMetadata: { google: { thoughtSignature: 'tail-sig' } } },
      ])
    })
  }

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
})
