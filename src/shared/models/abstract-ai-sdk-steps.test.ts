import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { APICallError, jsonSchema, type ModelMessage, type ToolSet } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import { createInitialState, processStreamChunk } from '@chatbox/core/generation'
import type { ModelDependencies } from '../types/adapters'
import { MessageSchema } from '../types/session'
import AbstractAISDKModel from './abstract-ai-sdk'
import { ApiError } from './errors'

const usage = {
  inputTokens: { total: 10, noCache: 4, cacheRead: 6, cacheWrite: 0 },
  outputTokens: { total: 2, text: 1, reasoning: 1 },
}

class TestModel extends AbstractAISDKModel {
  constructor(
    private readonly model: MockLanguageModelV4,
    stream = true,
    platformType?: ModelDependencies['platformType']
  ) {
    super({ model: { modelId: 'test', type: 'chat' }, stream }, {
      request: { apiRequest: vi.fn(), fetchWithOptions: vi.fn() },
      storage: { saveImage: vi.fn(), getImage: vi.fn() },
      sentry: { captureException: vi.fn(), withScope: vi.fn() },
      getRemoteConfig: vi.fn(),
      platformType,
    } satisfies ModelDependencies)
  }

  protected getProvider() {
    return { languageModel: () => this.model }
  }

  protected getChatModel() {
    return this.model
  }
}

const messages: ModelMessage[] = [
  { role: 'system', content: 'Answer in English.' },
  { role: 'user', content: 'Read the file and summarize it.' },
]

describe('model step execution', () => {
  it.each([
    { platformType: 'mobile', reason: undefined },
    { platformType: 'desktop', reason: 1790672259534 },
    { platformType: 'web', reason: 1790672259535 },
  ] as const)(
    'settles an aborted $platformType SDK stream without unhandled result promises',
    async ({ platformType, reason }) => {
      const release = Object.getOwnPropertyDescriptor(process, 'release')!
      const unhandled: unknown[] = []
      const onUnhandled = (error: unknown) => unhandled.push(error)
      process.on('unhandledRejection', onUnhandled)
      Object.defineProperty(process, 'release', { configurable: true, value: { name: 'browser' } })
      const abort = new AbortController()
      // RN's AbortController shim does not expose a cancellation reason.
      if (platformType === 'mobile') Object.defineProperty(abort.signal, 'reason', { value: undefined })
      let provider: ReadableStreamDefaultController<LanguageModelV4StreamPart> | undefined
      const model = new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              provider = controller
              controller.enqueue({ type: 'stream-start', warnings: [] })
              controller.enqueue({ type: 'text-start', id: 'answer' })
              controller.enqueue({ type: 'text-delta', id: 'answer', delta: 'Partial answer' })
            },
          }),
        }),
      })
      const stream = new TestModel(model, true, platformType).chatStream(messages, { signal: abort.signal })
      try {
        let chunk = await stream.next()
        while (!chunk.done && chunk.value.type !== 'text-delta') chunk = await stream.next()
        expect(chunk.value).toMatchObject({ type: 'text-delta', text: 'Partial answer' })
        abort.abort(reason)
        provider?.enqueue({ type: 'text-delta', id: 'answer', delta: 'discarded after stop' })
        while (!(await stream.next()).done) {}
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(unhandled).toEqual([])
        expect(model.doStreamCalls).toHaveLength(1)
      } finally {
        await stream.return(undefined)
        Object.defineProperty(process, 'release', release)
        process.off('unhandledRejection', onUnhandled)
      }
    }
  )

  it.each([undefined, 'mobile', 'desktop', 'web'] as const)(
    'does not retry a billable %s stream after output has started',
    async (platformType) => {
      const model = new MockLanguageModelV4({
        doStream: async () => ({
          stream: convertArrayToReadableStream<LanguageModelV4StreamPart>([
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'answer' },
            { type: 'text-delta', id: 'answer', delta: 'Partial answer' },
            {
              type: 'error',
              error: new APICallError({
                message: 'Stream interrupted',
                url: 'https://provider.test/chat',
                requestBodyValues: {},
                statusCode: 503,
                isRetryable: true,
              }),
            },
          ]),
        }),
      })
      await expect(new TestModel(model, true, platformType).chat(messages, {})).rejects.toBeInstanceOf(ApiError)
      expect(model.doStreamCalls).toHaveLength(1)
    }
  )

  it.each([true, false])('preserves system history when stream=%s', async (stream) => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'Answer' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      }),
      doStream: async () => ({
        stream: convertArrayToReadableStream<LanguageModelV4StreamPart>([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'Answer' },
          { type: 'text-end', id: 'answer' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ]),
      }),
    })
    const response = await new TestModel(model, stream).chat(messages, {})
    expect(response.contentParts).toContainEqual({ type: 'text', text: 'Answer' })
    const calls = stream ? model.doStreamCalls : model.doGenerateCalls
    expect(calls[0].prompt[0]).toMatchObject(messages[0])
    expect(response.usage?.totalTokens).toBe(12)
    expect(MessageSchema.shape.usage.parse(response.usage)).toMatchObject({ cachedInputTokens: 6, reasoningTokens: 1 })
  })

  it('prepares each step from the full transcript and counts tool-loop usage once', async () => {
    let call = 0
    const model = new MockLanguageModelV4({
      doStream: async () => {
        const toolStep = call++ === 0
        return {
          stream: convertArrayToReadableStream<LanguageModelV4StreamPart>([
            { type: 'stream-start', warnings: [] },
            ...(toolStep
              ? [{ type: 'tool-call' as const, toolCallId: 'read-1', toolName: 'read_file', input: '{}' }]
              : [
                  { type: 'text-start' as const, id: 'answer' },
                  { type: 'text-delta' as const, id: 'answer', delta: 'Summary' },
                  { type: 'text-end' as const, id: 'answer' },
                ]),
            { type: 'finish', finishReason: { unified: toolStep ? 'tool-calls' : 'stop', raw: undefined }, usage },
          ]),
        }
      },
    })
    const tools: ToolSet = {
      read_file: {
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async () => 'File contents',
      },
    }
    const preparedMessages: ModelMessage[][] = []
    const requests: ModelMessage[][] = []
    let state = createInitialState()
    for await (const chunk of new TestModel(model).chatStream(messages, {
      tools,
      maxSteps: 2,
      prepareStep: ({ stepNumber, messages: transcript }) => {
        preparedMessages.push(transcript)
        return stepNumber === 0
          ? { messages: [...transcript, { role: 'user', content: 'Temporary step instruction' }] }
          : undefined
      },
      onRequestResolved: async ({ modelMessages }) => {
        requests.push(modelMessages)
      },
    })) {
      state = (await processStreamChunk(chunk, state, { onFileReceived: vi.fn() })).state
    }
    expect(call).toBe(2)
    expect(preparedMessages[1].slice(0, 2)).toEqual(messages)
    expect(preparedMessages[1]).toHaveLength(4)
    expect(preparedMessages[1][3]).toMatchObject({ role: 'tool' })
    expect(requests[0]).toContainEqual({ role: 'user', content: 'Temporary step instruction' })
    expect(requests[1]).not.toContainEqual({ role: 'user', content: 'Temporary step instruction' })
    expect(model.doStreamCalls[1].prompt).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'Temporary step instruction' })])
    )
    expect(state.usage?.totalTokens).toBe(24)
    expect(MessageSchema.shape.usage.parse(state.usage)).toMatchObject({ cachedInputTokens: 12, reasoningTokens: 2 })
  })
})
