import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { jsonSchema, isStepCount, streamText, tool } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { stopWhenPersistentToolCallPause } from './persistent-tool-call-pause'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

describe('stopWhenPersistentToolCallPause', () => {
  it('stops before the SDK starts another model step after parallel approval pauses', async () => {
    let modelCalls = 0
    const model = new MockLanguageModelV4({
      doStream: () => {
        modelCalls += 1
        const chunks: LanguageModelV4StreamPart[] =
          modelCalls === 1
            ? [
                { type: 'stream-start', warnings: [] },
                {
                  type: 'tool-call',
                  toolCallId: 'tool-1',
                  toolName: 'pause',
                  input: '{}',
                },
                {
                  type: 'tool-call',
                  toolCallId: 'tool-2',
                  toolName: 'pause',
                  input: '{}',
                },
                { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
              ]
            : [
                { type: 'stream-start', warnings: [] },
                { type: 'text-start', id: 'text-1' },
                { type: 'text-delta', id: 'text-1', delta: 'unexpected follow-up' },
                { type: 'text-end', id: 'text-1' },
                { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
              ]
        return Promise.resolve({
          stream: convertArrayToReadableStream(chunks),
        })
      },
    })
    const result = streamText({
      model,
      prompt: 'Run both tools',
      tools: {
        pause: tool({
          inputSchema: jsonSchema<Record<string, never>>({
            type: 'object',
            properties: {},
            additionalProperties: false,
          }),
          execute: (): { success: boolean } => {
            const error = new Error('Approval required')
            error.name = 'AppActionApprovalPausedError'
            throw error
          },
        }),
      },
      stopWhen: [isStepCount(99), stopWhenPersistentToolCallPause()],
    })

    const chunks = []
    for await (const chunk of result.stream) chunks.push(chunk)

    expect(modelCalls).toBe(1)
    expect(chunks.filter((chunk) => chunk.type === 'tool-error')).toHaveLength(2)
    expect(chunks.some((chunk) => chunk.type === 'text-delta')).toBe(false)
  })
})
