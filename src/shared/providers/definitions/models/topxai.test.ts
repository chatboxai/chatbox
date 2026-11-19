import { expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../../../types/adapters'
import TopxAI from './topxai'

it('lists only text chat models exposed to the TopxAI key', async () => {
  const apiRequest = vi.fn<ModelDependencies['request']['apiRequest']>().mockResolvedValue(
    Response.json({
      data: [
        { id: 'new-chat-model', supported_endpoint_types: ['openai', 'openai-response'] },
        { id: 'claude-sonnet-5-5', supported_endpoint_types: ['anthropic', 'openai'] },
        { id: 'gpt-image-2.6-flare', supported_endpoint_types: ['image-generation', 'openai', 'image-edit'] },
        { id: 'grok-imagine-video-1.5', supported_endpoint_types: ['video-generation'] },
        { id: 'jev-1.14.0', supported_endpoint_types: ['systemone'] },
      ],
    })
  )
  const model = new TopxAI(
    { apiKey: 'test-key', apiHost: 'https://api.topxai.xyz/v1', model: { modelId: 'new-chat-model' }, useProxy: true },
    {
      request: { apiRequest, fetchWithOptions: vi.fn() },
      storage: { saveImage: vi.fn(), getImage: vi.fn() },
      sentry: { captureException: vi.fn(), withScope: vi.fn() },
      getRemoteConfig: vi.fn(),
    }
  )
  expect(await model.listModels()).toEqual([
    { modelId: 'new-chat-model', type: 'chat' },
    { modelId: 'claude-sonnet-5-5', type: 'chat' },
  ])
  expect(apiRequest).toHaveBeenCalledWith({
    url: 'https://api.topxai.xyz/v1/models',
    method: 'GET',
    headers: { Authorization: 'Bearer test-key' },
    useProxy: true,
  })
})
