import type { ModelDependencies } from '@shared/types/adapters'
import { describe, expect, it, vi } from 'vitest'
import { createOpenAIOAuthFetch } from './openai-oauth-fetch'

function createDependencies() {
  const apiRequest = vi
    .fn()
    .mockResolvedValue(
      new Response('data: {"type":"response.completed","response":{"id":"resp_1"}}\n\ndata: [DONE]\n', { status: 200 })
    )
  const dependencies: ModelDependencies = {
    request: {
      fetchWithOptions: vi.fn(),
      apiRequest,
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn(),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
  }

  return { apiRequest, dependencies }
}

describe('createOpenAIOAuthFetch', () => {
  it('handles URL string inputs used by the AI SDK', async () => {
    const { apiRequest, dependencies } = createDependencies()
    const fetcher = createOpenAIOAuthFetch(dependencies, {
      getCredential: vi.fn().mockResolvedValue({
        accessToken: 'oauth-token',
      }),
      getAccessToken: vi.fn(),
      clear: vi.fn(),
    })

    const response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: 'hello' }),
    })

    expect(await response.json()).toEqual({ id: 'resp_1' })
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://chatgpt.com/backend-api/codex/responses',
        method: 'POST',
      })
    )
  })

  it('preserves request metadata and rewrites codex-compatible requests', async () => {
    const { apiRequest, dependencies } = createDependencies()
    const fetcher = createOpenAIOAuthFetch(
      dependencies,
      {
        getCredential: vi.fn().mockResolvedValue({
          accessToken: 'oauth-token',
        }),
        getAccessToken: vi.fn(),
        clear: vi.fn(),
      },
      { accountId: 'acct_123' }
    )

    const request = new Request('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'old-key',
      },
      body: JSON.stringify({ input: 'hello' }),
    })

    const response = await fetcher(request)
    const json = await response.json()

    expect(json).toEqual({ id: 'resp_1' })
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://chatgpt.com/backend-api/codex/responses',
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer oauth-token',
          'chatgpt-account-id': 'acct_123',
          'content-type': 'application/json',
        }),
      })
    )

    const { body } = apiRequest.mock.calls[0][0] as { body: string }
    expect(JSON.parse(body)).toMatchObject({
      input: 'hello',
      instructions: 'You are a helpful assistant.',
      store: false,
      stream: true,
    })
  })
})
