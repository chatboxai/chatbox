import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
} from '@ai-sdk/provider'
import { describe, expect, test, vi } from 'vitest'
import {
  normalizeOpenAICompatibleNonStreamingContent,
  wrapOpenAICompatibleNonStreamingModel,
} from './openai-compatible-non-streaming'

const reasoning = { type: 'reasoning' as const, text: 'Private reasoning' }
const answer = { type: 'text' as const, text: 'Final answer' }

function createGenerateResult(content: LanguageModelV4Content[]): LanguageModelV4GenerateResult {
  return {
    content,
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 2, text: 1, reasoning: 1 },
    },
    warnings: [],
  }
}

function createModel(content: LanguageModelV4Content[]): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'openai-compatible',
    modelId: 'test-model',
    supportedUrls: {},
    doGenerate: vi.fn(async () => createGenerateResult(content)),
    doStream: vi.fn(() => {
      throw new Error('The simulated stream should use doGenerate')
    }),
  }
}

describe('normalizeOpenAICompatibleNonStreamingContent', () => {
  test('moves reasoning before final answer text for the exact two-part response', () => {
    expect(normalizeOpenAICompatibleNonStreamingContent([answer, reasoning])).toEqual([reasoning, answer])
  })

  test('preserves already-correct reasoning and text order', () => {
    const content = [reasoning, answer]

    expect(normalizeOpenAICompatibleNonStreamingContent(content)).toBe(content)
  })

  test('preserves multi-step and tool-call content order', () => {
    const toolCall = {
      type: 'tool-call' as const,
      toolCallId: 'tool-1',
      toolName: 'search',
      input: '{}',
    }
    const content = [answer, toolCall, reasoning]

    expect(normalizeOpenAICompatibleNonStreamingContent(content)).toBe(content)
  })
})

describe('wrapOpenAICompatibleNonStreamingModel', () => {
  test('normalizes doGenerate content before simulating stream chunks', async () => {
    const model = createModel([answer, reasoning])
    const wrappedModel = wrapOpenAICompatibleNonStreamingModel(model)
    const result = await wrappedModel.doStream({ prompt: [] } as LanguageModelV4CallOptions)
    const contentChunks: Array<{ type: string; delta?: string }> = []
    const reader = result.stream.getReader()

    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      if (chunk.type === 'reasoning-delta' || chunk.type === 'text-delta') {
        contentChunks.push({ type: chunk.type, delta: chunk.delta })
      }
    }

    expect(contentChunks).toEqual([
      { type: 'reasoning-delta', delta: 'Private reasoning' },
      { type: 'text-delta', delta: 'Final answer' },
    ])
    expect(model.doGenerate).toHaveBeenCalledOnce()
    expect(model.doStream).not.toHaveBeenCalled()
  })
})
