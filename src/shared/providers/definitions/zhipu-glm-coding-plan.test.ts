import { describe, expect, it, vi } from 'vitest'
import { settings as getDefaultSettings, newConfigs } from '../../defaults'
import { ModelProviderEnum } from '../../types'
import type { ModelDependencies } from '../../types/adapters'
import type { CreateModelConfig } from '../types'
import type ZhipuGLMCodingPlan from './models/zhipu-glm-coding-plan'
import { zhipuGLMCodingPlanProvider } from './zhipu-glm-coding-plan'

function createModel(
  platformType: ModelDependencies['platformType'],
  useProxy?: boolean,
  stream = false,
  formattedApiHost = ''
) {
  const completion = {
    id: 'glm-test',
    object: 'chat.completion',
    created: 1,
    model: 'glm-4.7',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
  const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockImplementation(() => {
    if (!stream) {
      return Promise.resolve(
        new Response(JSON.stringify(completion), { headers: { 'content-type': 'application/json' } })
      )
    }
    const chunks = [
      { ...completion, choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
      { ...completion, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]
    return Promise.resolve(
      new Response([...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join(''), {
        headers: { 'content-type': 'text/event-stream' },
      })
    )
  })
  const dependencies = {
    platformType,
    request: { apiRequest, fetchWithOptions: vi.fn() },
    storage: { saveImage: vi.fn(), getImage: vi.fn() },
    sentry: { captureException: vi.fn(), withScope: vi.fn() },
    getRemoteConfig: vi.fn(),
  } satisfies ModelDependencies
  const model = zhipuGLMCodingPlanProvider.createModel({
    settings: { provider: ModelProviderEnum.ZhipuGLMCodingPlan, modelId: 'glm-4.7', stream },
    globalSettings: getDefaultSettings(),
    config: newConfigs(),
    dependencies,
    providerSetting: { apiKey: 'test-key', useProxy },
    effectiveApiKey: 'test-key',
    formattedApiHost,
    formattedApiPath: '',
    model: { modelId: 'glm-4.7', type: 'chat' },
  } satisfies CreateModelConfig) as ZhipuGLMCodingPlan
  return { model, apiRequest }
}

describe('GLM Coding Plan network compatibility', () => {
  it.each([undefined, false, true])('uses native mobile requests with useProxy=%s', async (useProxy) => {
    const { model, apiRequest } = createModel('mobile', useProxy)
    const result = await model.chat([{ role: 'user', content: 'hello' }], {})

    expect(result.contentParts).toEqual([{ type: 'text', text: 'ok' }])
    expect(apiRequest).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        url: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
        useProxy: true,
      })
    )
  })

  it('uses native mobile requests for streaming chat', async () => {
    const { model, apiRequest } = createModel('mobile', undefined, true)
    const result = await model.chat([{ role: 'user', content: 'hello' }], {})

    expect(result.contentParts).toEqual([{ type: 'text', text: 'ok' }])
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
        useProxy: true,
      })
    )
    expect(JSON.parse(String(apiRequest.mock.calls[0][0].body))).toMatchObject({ stream: true })
  })

  it.each(['desktop', 'web'] as const)('preserves the compatibility setting on %s', (platformType) => {
    for (const useProxy of [undefined, false, true]) {
      expect(createModel(platformType, useProxy).model.options.useProxy).toBe(useProxy)
    }
  })

  it('sends native mobile requests to a custom API host', async () => {
    const { model, apiRequest } = createModel('mobile', false, false, 'https://glm.example.com/v4')
    await model.chat([{ role: 'user', content: 'hello' }], {})

    expect(apiRequest).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ url: 'https://glm.example.com/v4/chat/completions', useProxy: true })
    )
  })
})
