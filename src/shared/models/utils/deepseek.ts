import type { MessageContentParts, ToolUseScope } from '../../types'

/**
 * DeepSeek chat/reasoner/R1 and pre-V4 base models have poor function calling for scoped tools.
 * This covers all known model ID variants across providers:
 *   - DeepSeek API: deepseek-chat, deepseek-reasoner
 *   - SiliconFlow:  deepseek-ai/DeepSeek-V3.2, deepseek-ai/DeepSeek-R1
 *   - VolcEngine:   deepseek-v3-250324, deepseek-r1-250528
 *   - OpenRouter:   deepseek/deepseek-r1:free, deepseek/deepseek-v3.2
 *   - Generic:      deepseek-v3, deepseek-v3.2, deepseek-r1
 *
 * Distilled and VL models are excluded because they use different model families.
 */

const SCOPED_TOOLS: ToolUseScope[] = ['agent', 'web-browsing', 'read-file']

// Matches DeepSeek chat/reasoner/R1, plus V-series models below V4.
const WEAK_MODEL_PATTERN = /deepseek[-_]?(chat|reasoner|r1|v(?:0|1|2|3)(?:[._]\d+)?)\b/i

// Models with improved tool use — excluded from the weak list
const STRONG_MODEL_PATTERN = /distill|vl\d/i

// Matches DeepSeek models that support reasoning/thinking (Flash, reasoner, R1, V-series).
const REASONING_MODEL_PATTERN = /(?:^|\/)deepseek-(?:flash(?:[._-]|$)|reasoner|r1|v[0-9.]+)/i

// DeepSeek V4 is the first model family whose official APIs expose thinking effort.
const REASONING_EFFORT_MODEL_PATTERN = /(?:^|\/)deepseek-(?:flash|v4)(?:[._-]|$)/i

const DEEPSEEK_REASONING_EFFORTS = new Set(['low', 'high', 'max', 'xhigh'])

/**
 * Returns true if the given model ID is a DeepSeek reasoning/thinking model.
 * Shared by capability detection (reasoning controls) and request construction
 * (DeepSeek provider, ChatboxAI gateway) so the two can never drift apart.
 */
export function isDeepSeekReasoningModel(modelId: string): boolean {
  return REASONING_MODEL_PATTERN.test(modelId)
}

/** Returns true for DeepSeek models that support the official effort parameter. */
export function isDeepSeekReasoningEffortModel(modelId: string): boolean {
  return REASONING_EFFORT_MODEL_PATTERN.test(modelId)
}

/** Drops stale or unsupported DeepSeek effort values at the request boundary. */
export function normalizeDeepSeekReasoningEffort(modelId: string, effort: string | undefined) {
  if (!isDeepSeekReasoningEffortModel(modelId) || !effort || !DEEPSEEK_REASONING_EFFORTS.has(effort)) {
    return undefined
  }
  return effort as 'low' | 'high' | 'max' | 'xhigh'
}

/**
 * Some DeepSeek serving stacks occasionally classify the complete answer as reasoning and
 * return an empty content channel with `finish_reason: stop`. Recover that exact terminal
 * shape as a normal answer. A length-limited response remains reasoning because it may only
 * contain an unfinished chain of thought.
 *
 * This is keyed by model ID instead of provider ID because DeepSeek models can be served by
 * the native provider, OpenRouter, or a custom OpenAI-compatible endpoint.
 */
export function normalizeDeepSeekCompletedResponse(
  contentParts: MessageContentParts,
  finishReason: string | undefined,
  modelId: string
): MessageContentParts {
  if (finishReason !== 'stop' || !isDeepSeekReasoningModel(modelId)) return contentParts

  const meaningfulParts = contentParts.filter((part) => {
    if (part.type === 'text' || part.type === 'reasoning') return part.text.trim().length > 0
    return true
  })
  if (meaningfulParts.length !== 1 || meaningfulParts[0].type !== 'reasoning') return contentParts

  const reasoningPart = meaningfulParts[0]
  return contentParts.map((part) =>
    part === reasoningPart
      ? {
          type: 'text' as const,
          text: reasoningPart.text,
        }
      : part
  )
}

/**
 * Returns true if the given DeepSeek model has weak scoped tool use
 * (agent, web-browsing, read-file) and should be disabled for that scope.
 */
export function isDeepSeekWeakToolUse(modelId: string, scope?: ToolUseScope): boolean {
  if (!scope || !SCOPED_TOOLS.includes(scope)) return false
  const id = modelId.toLowerCase()
  if (!id.includes('deepseek')) return false
  if (STRONG_MODEL_PATTERN.test(id)) return false
  return WEAK_MODEL_PATTERN.test(id)
}
