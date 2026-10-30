import type { ProviderOptions } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { getReasoningProviderOptions, type ReasoningControlLevel } from '@shared/utils/reasoning-control'
import { describe, expect, it, vi } from 'vitest'
import type { CallChatCompletionOptions } from '../../../models/types'
import CustomOpenAI from './custom-openai'

class TestCustomOpenAI extends CustomOpenAI {
  public settings(options: CallChatCompletionOptions) {
    return this.getCallSettings(options)
  }

  public chatModel() {
    return this.getChatModel({})
  }
}

function harness(modelId: string) {
  const bodies: Record<string, unknown>[] = []
  const dependencies: ModelDependencies = {
    request: {
      apiRequest: vi.fn(({ body }) => {
        const parsed = JSON.parse(String(body))
        bodies.push(parsed)
        if (parsed.stream) {
          return Promise.resolve(
            new Response(
              'data: {"id":"test","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
              { headers: { 'content-type': 'text/event-stream' } }
            )
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'test',
              choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        )
      }),
      fetchWithOptions: vi.fn(),
    },
    storage: { saveImage: vi.fn(), getImage: vi.fn() },
    sentry: { captureException: vi.fn(), withScope: vi.fn() },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
  }
  const model = new TestCustomOpenAI(
    {
      apiKey: 'test-key',
      apiHost: 'https://example.invalid/v1',
      apiPath: '/chat/completions',
      model: { modelId, type: 'chat', apiStyle: 'openai', providerId: 'custom-provider-test' },
      temperature: 0.3,
      topP: 0.9,
    },
    dependencies
  )
  async function send(providerOptions: ProviderOptions | undefined, stream = false) {
    const settings = model.settings({ providerOptions })
    const request = {
      prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }],
      ...settings,
    }
    if (stream) {
      const result = await model.chatModel().doStream(request)
      await result.stream.pipeTo(new WritableStream())
    } else {
      await model.chatModel().doGenerate(request)
    }
    const body = bodies.at(-1)
    if (!body) throw new Error('No request was captured')
    return body
  }
  return { model, send }
}

describe('custom OpenAI thinking request serialization', () => {
  const levels: ReasoningControlLevel[] = ['default', 'off', 'low', 'medium', 'high']
  const efforts = { low: 'low', medium: 'high', high: 'max' }
  for (const modelId of ['deepseek-v4-pro', 'deepseek-flash']) {
    for (const stream of [false, true]) {
      it.each(levels)(`${modelId} stream=${stream} preserves the %s control on the wire`, async (level) => {
        const { model, send } = harness(modelId)
        const options = getReasoningProviderOptions('custom-provider-test', model.options.model, level)
        const body = await send(options, stream)
        expect(body).toMatchObject({ model: modelId, temperature: 0.3, top_p: 0.9 })
        if (level === 'default') {
          expect(body).not.toHaveProperty('thinking')
          expect(body).not.toHaveProperty('reasoning_effort')
        } else {
          expect(body.thinking).toEqual({ type: level === 'off' ? 'disabled' : 'enabled' })
          if (level === 'off') expect(body).not.toHaveProperty('reasoning_effort')
          else expect(body.reasoning_effort).toBe(efforts[level])
        }
      })
    }
  }

  it('retains OpenAI filtering and does not forward stale DeepSeek settings to GPT', async () => {
    const { send } = harness('gpt-5.1')
    const body = await send({
      openai: { reasoningEffort: 'low', forceReasoning: true, include: ['reasoning.encrypted_content'] },
      deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'max' },
    })
    expect(body.reasoning_effort).toBe('low')
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('forceReasoning')
    expect(body).not.toHaveProperty('include')
  })

  it('keeps the legacy DeepSeek toggle without sending unsupported effort', async () => {
    const { send } = harness('deepseek-v3.2')
    const body = await send({ deepseek: { thinking: { type: 'disabled' }, reasoningEffort: 'max' } })
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body).not.toHaveProperty('reasoning_effort')
  })
})
