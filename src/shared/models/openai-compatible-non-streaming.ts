import type { LanguageModelV4, LanguageModelV4Content } from '@ai-sdk/provider'
import { type LanguageModelMiddleware, simulateStreamingMiddleware, wrapLanguageModel } from 'ai'

/**
 * OpenAI-compatible chat completions return final answer text and reasoning as
 * sibling response fields. The AI SDK's non-streaming adapter currently maps
 * those fields to `[text, reasoning]`, while its streaming path emits reasoning
 * before text.
 *
 * Normalize only the exact two-part response so non-streaming output has the
 * same semantic order as streaming output. Multi-step/tool responses retain
 * the provider's original ordering.
 */
export function normalizeOpenAICompatibleNonStreamingContent(
  content: LanguageModelV4Content[]
): LanguageModelV4Content[] {
  if (content.length !== 2 || content[0].type !== 'text' || content[1].type !== 'reasoning') {
    return content
  }

  return [content[1], content[0]]
}

function normalizeOpenAICompatibleNonStreamingReasoningMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      const content = normalizeOpenAICompatibleNonStreamingContent(result.content)
      return content === result.content ? result : { ...result, content }
    },
  }
}

/**
 * Normalize doGenerate() before simulateStreamingMiddleware() replays its
 * ordered content as stream chunks.
 */
export function wrapOpenAICompatibleNonStreamingModel(model: LanguageModelV4): LanguageModelV4 {
  const normalizedModel = wrapLanguageModel({
    model,
    middleware: normalizeOpenAICompatibleNonStreamingReasoningMiddleware(),
  })

  return wrapLanguageModel({
    model: normalizedModel,
    middleware: simulateStreamingMiddleware(),
  })
}
