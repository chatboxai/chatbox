import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV4Usage } from '@ai-sdk/provider'
import { generateText, streamText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { withCacheReadUsage } from './cache-read-usage'
import { createOpenAIChatCompletionSseFetch } from './utils/openai-chat-sse-termination'

function modelForUsage(
  usage: Record<string, unknown>,
  streaming: boolean,
  kind: 'deepseek' | 'openai' | 'compatible' = 'deepseek'
) {
  const response = {
    id: 'cache-usage-test',
    object: streaming ? 'chat.completion.chunk' : 'chat.completion',
    created: 1,
    model: 'deepseek-v4.1-flash',
    choices: [
      {
        index: 0,
        ...(streaming ? { delta: { content: 'OK' } } : { message: { role: 'assistant', content: 'OK' } }),
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1636, completion_tokens: 1, total_tokens: 1637, ...usage },
  }
  const settings = {
    apiKey: 'test-key',
    fetch: createOpenAIChatCompletionSseFetch(
      async () =>
        new Response(streaming ? `data: ${JSON.stringify(response)}\n\ndata: [DONE]\n\n` : JSON.stringify(response), {
          headers: { 'content-type': streaming ? 'text/event-stream' : 'application/json' },
        })
    ),
  }
  const model =
    kind === 'deepseek'
      ? createDeepSeek(settings)('deepseek-v4.1-flash')
      : kind === 'openai'
        ? createOpenAI(settings).chat('kimi-k2')
        : createOpenAICompatible({ ...settings, name: 'custom', baseURL: 'https://example.test/v1' })('model')
  return withCacheReadUsage(model)
}

describe('DeepSeek gateway cache accounting', () => {
  it.each([true, false])('preserves gateway cache hits through SDK aggregation (stream=%s)', async (streaming) => {
    const model = modelForUsage({ prompt_tokens_details: { cached_tokens: 1536 } }, streaming)
    const options = { model, prompt: 'Synthetic diagnostic', maxRetries: 0 }
    const usage = streaming
      ? await (async () => {
          const result = streamText(options)
          await result.consumeStream()
          return result.totalUsage
        })()
      : (await generateText(options)).totalUsage
    expect(usage.inputTokenDetails).toMatchObject({ cacheReadTokens: 1536, noCacheTokens: 100 })
    expect(usage.totalTokens).toBe(1637)
  })

  it.each([
    { raw: { prompt_cache_hit_tokens: 64, prompt_tokens_details: { cached_tokens: 1536 } }, cached: 64 },
    { raw: { prompt_cache_hit_tokens: 0, prompt_tokens_details: { cached_tokens: 1536 } }, cached: 0 },
    { raw: { prompt_tokens_details: { cached_tokens: 0 } }, cached: 0 },
    { raw: {}, cached: 0 },
    { raw: { prompt_tokens_details: { cached_tokens: -1 } }, cached: 0 },
    { raw: { prompt_tokens_details: { cached_tokens: 2000 } }, cached: 0 },
    { raw: { prompt_tokens_details: { cached_tokens: 0.5 } }, cached: 0 },
  ])('honors native accounting and rejects invalid gateway counts: $raw', async ({ raw, cached }) => {
    const result = await generateText({
      model: modelForUsage(raw, false),
      prompt: 'Synthetic diagnostic',
      maxRetries: 0,
    })
    expect(result.totalUsage.inputTokenDetails.cacheReadTokens).toBe(cached)
    expect(result.totalUsage.inputTokenDetails.noCacheTokens).toBe(1636 - cached)
  })
})

describe('OpenAI chat and compatible provider cache accounting', () => {
  for (const kind of ['openai', 'compatible'] as const) {
    for (const streaming of [false, true]) {
      it.each([
        { raw: { prompt_cache_hit_tokens: 1536 }, cached: 1536 },
        { raw: { cached_tokens: 1536 }, cached: 1536 },
        { raw: { num_cached_tokens: 1536 }, cached: 1536 },
        { raw: { prompt_token_details: { cached_tokens: 1536 } }, cached: 1536 },
        { raw: { prompt_tokens_details: { cached_tokens: 100 }, cached_tokens: 1536 }, cached: 100 },
        { raw: { prompt_tokens_details: { cached_tokens: 0 }, prompt_cache_hit_tokens: 1536 }, cached: 0 },
        { raw: { cached_tokens: -1 }, cached: 0 },
        { raw: { cached_tokens: 2000 }, cached: 0 },
        { raw: { cached_tokens: '1536' }, cached: 0 },
        { raw: {}, cached: 0 },
      ])(`${kind} stream=${streaming}: $raw`, async ({ raw, cached }) => {
        const options = { model: modelForUsage(raw, streaming, kind), prompt: 'Synthetic diagnostic', maxRetries: 0 }
        const result = streaming ? streamText(options) : await generateText(options)
        if (streaming && 'consumeStream' in result) await result.consumeStream()
        const usage = await result.totalUsage
        expect(usage.inputTokenDetails.cacheReadTokens).toBe(cached)
        expect(usage.inputTokenDetails.noCacheTokens).toBe(1636 - cached)
        expect(usage.totalTokens).toBe(1637)
      })
    }
  }
})

describe('cache write bound', () => {
  // Only the OpenAI chat SDK subtracts `cache_write_tokens` from uncached input.
  for (const kind of ['openai', 'compatible', 'deepseek'] as const) {
    for (const streaming of [false, true]) {
      it.each([
        { name: 'read + write == prompt', cached_tokens: 1536, write: 100, cached: 1536 },
        { name: 'read + write > prompt', cached_tokens: 1600, write: 100, cached: 0 },
        { name: 'negative write', cached_tokens: 1536, write: -1, cached: 0 },
        { name: 'fractional write', cached_tokens: 1536, write: 0.5, cached: 0 },
      ])(`${kind} stream=${streaming}: $name`, async ({ cached_tokens, write, cached }) => {
        const raw = { cached_tokens, prompt_tokens_details: { cache_write_tokens: write } }
        const options = { model: modelForUsage(raw, streaming, kind), prompt: 'Synthetic diagnostic', maxRetries: 0 }
        const result = streaming ? streamText(options) : await generateText(options)
        if (streaming && 'consumeStream' in result) await result.consumeStream()
        const usage = await result.totalUsage
        const sdkWrite = kind === 'openai' ? write : 0
        expect(usage.inputTokenDetails.cacheReadTokens).toBe(cached)
        expect(usage.inputTokenDetails.noCacheTokens).toBe(1636 - cached - sdkWrite)
        if (Number.isSafeInteger(write) && write >= 0) {
          expect(usage.inputTokenDetails.noCacheTokens).toBeGreaterThanOrEqual(0)
        }
      })
    }
  }
})

describe('native protocol accounting', () => {
  it.each([
    { provider: 'google.generative-ai', raw: { promptTokenCount: 100, cachedContentTokenCount: 60 } },
    {
      provider: 'anthropic.messages',
      raw: { input_tokens: 40, cache_read_input_tokens: 60, cache_creation_input_tokens: 10 },
    },
    { provider: 'openai.responses', raw: { input_tokens: 100, input_tokens_details: { cached_tokens: 60 } } },
    { provider: 'openrouter.chat', raw: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 60 } } },
    { provider: 'mistral.chat', raw: { prompt_tokens: 100, num_cached_tokens: 60 } },
  ])('retains $provider native usage', async ({ provider, raw }) => {
    const usage: LanguageModelV4Usage = {
      inputTokens: { total: 110, noCache: 40, cacheRead: 60, cacheWrite: 10 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
      raw,
    }
    const model = withCacheReadUsage(
      new MockLanguageModelV4({
        provider,
        doGenerate: async () => ({ content: [], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
      })
    )
    const result = await model.doGenerate({ prompt: [] })
    expect(result.usage).toBe(usage)
  })
  it('subtracts cache writes from uncached tokens when restoring a read count', async () => {
    const model = withCacheReadUsage(
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 100, noCache: 90, cacheRead: 0, cacheWrite: 10 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
            raw: { prompt_tokens: 100, cached_tokens: 60 },
          },
          warnings: [],
        }),
      })
    )
    expect((await model.doGenerate({ prompt: [] })).usage.inputTokens).toEqual({
      total: 100,
      noCache: 30,
      cacheRead: 60,
      cacheWrite: 10,
    })
  })
})
