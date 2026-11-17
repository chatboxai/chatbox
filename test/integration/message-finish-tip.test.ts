import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { getMessageFinishTip } from '@chatbox/core/session/message-finish-tip'
import { generateText, type LanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

function responseFetch(body: object): typeof fetch {
  return async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

function chatResponse(reason: string) {
  return {
    id: 'chat-1',
    object: 'chat.completion',
    created: 1,
    model: 'test',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Partial reply' }, finish_reason: reason }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  }
}

async function expectLengthTip(model: LanguageModel) {
  const result = await generateText({ model, prompt: 'Hello', maxOutputTokens: 16, maxRetries: 0 })
  expect(result.finishReason).toBe('length')
  expect(getMessageFinishTip({ role: 'assistant', finishReason: result.finishReason }, (key) => key)).toContain(
    'length limit for this response'
  )
}

describe('provider stop reasons reach the message length tip', () => {
  it.each(['max_tokens', 'model_context_window_exceeded'])('Anthropic %s', async (stopReason) => {
    const provider = createAnthropic({
      apiKey: 'test',
      fetch: responseFetch({
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'Partial reply' }],
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    })
    await expectLengthTip(provider('claude-sonnet-4-5'))
  })

  it('Gemini MAX_TOKENS', async () => {
    const provider = createGoogle({
      apiKey: 'test',
      fetch: responseFetch({
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Partial reply' }] }, finishReason: 'MAX_TOKENS', index: 0 },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
      }),
    })
    await expectLengthTip(provider('gemini-2.5-flash'))
  })

  it('OpenAI Responses max_output_tokens', async () => {
    const provider = createOpenAI({
      apiKey: 'test',
      fetch: responseFetch({
        id: 'resp-1',
        created_at: 1,
        model: 'gpt-4.1',
        status: 'incomplete',
        output: [
          {
            type: 'message',
            id: 'msg-1',
            role: 'assistant',
            status: 'incomplete',
            content: [{ type: 'output_text', text: 'Partial reply', annotations: [] }],
          },
        ],
        incomplete_details: { reason: 'max_output_tokens' },
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      }),
    })
    await expectLengthTip(provider.responses('gpt-4.1'))
  })

  it('OpenAI Chat Completions length', async () => {
    const provider = createOpenAI({ apiKey: 'test', fetch: responseFetch(chatResponse('length')) })
    await expectLengthTip(provider.chat('gpt-4.1'))
  })

  it('OpenAI-compatible length', async () => {
    const provider = createOpenAICompatible({
      name: 'test',
      baseURL: 'https://example.invalid/v1',
      fetch: responseFetch(chatResponse('length')),
    })
    await expectLengthTip(provider('test'))
  })

  it('does not mislabel an unknown compatible reason as a length limit', async () => {
    const provider = createOpenAICompatible({
      name: 'test',
      baseURL: 'https://example.invalid/v1',
      fetch: responseFetch(chatResponse('max_tokens')),
    })
    const result = await generateText({ model: provider('test'), prompt: 'Hello', maxRetries: 0 })
    expect(result.finishReason).toBe('other')
    expect(getMessageFinishTip({ role: 'assistant', finishReason: result.finishReason }, (key) => key)).toBeUndefined()
  })
})
