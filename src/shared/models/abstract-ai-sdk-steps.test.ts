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
    stream = true
  ) {
    super({ model: { modelId: 'test', type: 'chat' }, stream }, {
      request: { apiRequest: vi.fn(), fetchWithOptions: vi.fn() },
      storage: { saveImage: vi.fn(), getImage: vi.fn() },
      sentry: { captureException: vi.fn(), withScope: vi.fn() },
      getRemoteConfig: vi.fn(),
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
  it('does not retry a billable stream after output has started', async () => {
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
    await expect(new TestModel(model).chat(messages, {})).rejects.toBeInstanceOf(ApiError)
    expect(model.doStreamCalls).toHaveLength(1)
  })

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
