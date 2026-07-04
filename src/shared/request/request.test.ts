import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiError, CodedError } from '../models/errors'
import { createAfetch } from './request'

const platformInfo = {
  type: 'desktop',
  platform: 'darwin',
  os: 'macos',
  version: '1.0.0',
}

describe('createAfetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores request id from WorkspAIce error body on known local/provider errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'rate_limit_exceeded',
              request_id: 'req-from-body',
            },
          }),
          { status: 429 }
        )
      )
    )

    const afetch = createAfetch(platformInfo)

    await expect(
      afetch(
        'https://api.workspaiceai.app/gateway/openai/v1/chat/completions',
        {},
        { parseWorkspAIceRemoteError: true }
      )
    ).rejects.toMatchObject({
      code: 20005,
      requestId: 'req-from-body',
    } satisfies Partial<CodedError>)
  })

  it('stores request id from response headers on generic API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'not_a_real_code', request_id: 'req-from-body' } }), {
          status: 500,
          headers: { 'x-request-id': 'req-from-header' },
        })
      )
    )

    const afetch = createAfetch(platformInfo)

    await expect(
      afetch(
        'https://api.workspaiceai.app/gateway/openai/v1/chat/completions',
        {},
        { parseWorkspAIceRemoteError: true }
      )
    ).rejects.toMatchObject({
      code: 10001,
      statusCode: 500,
      requestId: 'req-from-header',
    } satisfies Partial<ApiError>)
  })
})
