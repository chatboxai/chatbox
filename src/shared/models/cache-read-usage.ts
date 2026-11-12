import type { LanguageModelV4, LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { readCacheWriteTokens } from './utils/openai-cache-usage'

function nestedCachedTokens(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value) && 'cached_tokens' in value
    ? value.cached_tokens
    : undefined
}

function normalizeUsage(usage: LanguageModelV4Usage, provider: string): LanguageModelV4Usage {
  const raw = usage.raw
  if (!raw || typeof raw.prompt_tokens !== 'number') return usage
  const standard = nestedCachedTokens(raw.prompt_tokens_details)
  // Keep the SDK's native field authoritative, including an explicit cache miss.
  const primary = provider.startsWith('deepseek.')
    ? raw.prompt_cache_hit_tokens
    : provider.startsWith('mistral.')
      ? (raw.num_cached_tokens ?? standard ?? nestedCachedTokens(raw.prompt_token_details))
      : standard
  if (primary != null) return usage
  const cached =
    standard ??
    raw.prompt_cache_hit_tokens ??
    raw.cached_tokens ??
    raw.num_cached_tokens ??
    nestedCachedTokens(raw.prompt_token_details)
  const total = usage.inputTokens.total
  const written = usage.inputTokens.cacheWrite ?? 0
  // Bound reads by the provider-reported write count even when the SDK does not surface it.
  const reportedWritten = readCacheWriteTokens(raw.prompt_tokens_details)
  if (
    typeof cached !== 'number' ||
    !Number.isSafeInteger(cached) ||
    cached < 0 ||
    total === undefined ||
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(written) ||
    written < 0 ||
    reportedWritten === undefined ||
    cached + (usage.inputTokens.cacheWrite ?? reportedWritten) > total ||
    (usage.inputTokens.cacheRead ?? 0) > 0
  )
    return usage
  return { ...usage, inputTokens: { ...usage.inputTokens, cacheRead: cached, noCache: total - cached - written } }
}

type StreamTransformer = new (transformer: {
  transform(part: LanguageModelV4StreamPart, controller: { enqueue(part: LanguageModelV4StreamPart): void }): void
}) => unknown

/** Normalize gateway cache accounting before the SDK aggregates per-step usage. */
export function withCacheReadUsage(model: LanguageModelV4): LanguageModelV4 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v4',
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate()
        return { ...result, usage: normalizeUsage(result.usage, model.provider) }
      },
      wrapStream: async ({ doStream }) => {
        const result = await doStream()
        // React Native installs the Web Streams implementation at runtime.
        const Transform = (globalThis as typeof globalThis & { TransformStream: StreamTransformer }).TransformStream
        const stream = result.stream as typeof result.stream & { pipeThrough(transform: unknown): typeof result.stream }
        return {
          ...result,
          stream: stream.pipeThrough(
            new Transform({
              transform(part, controller) {
                controller.enqueue(
                  part.type === 'finish' ? { ...part, usage: normalizeUsage(part.usage, model.provider) } : part
                )
              },
            })
          ),
        }
      },
    },
  })
}
