import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { stepCountIs, streamText } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import { createWebSearchTool } from '../web-search-tool'
import { repairToolCallJson } from './tool-call-json-repair'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

describe('tool schema recovery through the AI SDK', () => {
  it.each([
    ['{"q":"weather"}', 'query'],
    ['{"query":123}', 'string'],
    ['```json\n{"q":"weather",}\n```', 'query'],
  ])('returns invalid input %s to the model before executing the corrected call', async (invalidInput, expected) => {
    const execute = vi.fn(async () => ({ searchResults: [] }))
    let calls = 0
    const model = new MockLanguageModelV3({
      doStream: async ({ prompt }) => {
        calls += 1
        if (calls === 2) {
          const feedback = prompt.filter((message) => message.role === 'tool')
          expect(JSON.stringify(feedback)).toContain(expected)
          expect(JSON.stringify(feedback)).toContain('Tool was not executed')
          expect(execute).not.toHaveBeenCalled()
        }
        const chunks: LanguageModelV3StreamPart[] = [{ type: 'stream-start', warnings: [] }]
        if (calls <= 2) {
          chunks.push({
            type: 'tool-call',
            toolName: 'web_search',
            toolCallId: `call-${calls}`,
            input: calls === 1 ? invalidInput : '{"query":"weather"}',
          })
        }
        chunks.push({
          type: 'finish',
          finishReason: { unified: calls <= 2 ? 'tool-calls' : 'stop', raw: undefined },
          usage,
        })
        return { stream: convertArrayToReadableStream(chunks) }
      },
    })
    const result = streamText({
      model,
      prompt: 'Search for weather',
      tools: { web_search: createWebSearchTool(execute) },
      experimental_repairToolCall: repairToolCallJson,
      stopWhen: stepCountIs(3),
    })
    const chunks = []
    for await (const chunk of result.fullStream) chunks.push(chunk)
    expect(calls).toBe(3)
    expect(chunks.filter((chunk) => chunk.type === 'tool-error')).toHaveLength(1)
    expect(execute).toHaveBeenCalledExactlyOnceWith('weather', undefined)
  })

  it('repairs valid fenced arguments and executes them once', async () => {
    const execute = vi.fn(async () => ({ searchResults: [] }))
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolName: 'web_search',
            toolCallId: 'call-1',
            input: '```json\n{"query":"weather",}\n```',
          },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
        ]),
      }),
    })
    const result = streamText({
      model,
      prompt: 'Search',
      tools: { web_search: createWebSearchTool(execute) },
      experimental_repairToolCall: repairToolCallJson,
    })
    await result.consumeStream()
    expect(execute).toHaveBeenCalledExactlyOnceWith('weather', undefined)
  })
})
