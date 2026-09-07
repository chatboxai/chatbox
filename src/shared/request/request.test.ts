import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiError, ChatboxAIAPIError } from '../models/errors'
import { createAfetch, createAuthenticatedAfetch } from './request'

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

  it('adds platform metadata without dropping caller-provided Chatbox headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const afetch = createAfetch(platformInfo)
    const url = 'https://api.chatboxai.app/gateway/openai/v1/chat/completions'

    await afetch(url, {
      headers: {
        'chatbox-session-id': 'session-123',
        'chatbox-agent-mode': 'true',
      },
    })

    expect(fetchMock).toHaveBeenCalledWith(url, {
      headers: {
        'chatbox-session-id': 'session-123',
        'chatbox-agent-mode': 'true',
        'CHATBOX-PLATFORM': 'darwin',
        'CHATBOX-PLATFORM-TYPE': 'desktop',
        'CHATBOX-OS': 'macos',
        'CHATBOX-VERSION': '1.0.0',
      },
    })
  })

  it('stores request id from Chatbox error body on known Chatbox errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'token_quota_exhausted',
              request_id: 'req-from-body',
            },
          }),
          { status: 429 }
        )
      )
    )

    const afetch = createAfetch(platformInfo)

    await expect(
      afetch('https://api.chatboxai.app/gateway/openai/v1/chat/completions', {}, { parseChatboxRemoteError: true })
    ).rejects.toMatchObject({
      code: 10004,
      requestId: 'req-from-body',
    } satisfies Partial<ChatboxAIAPIError>)
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
      afetch('https://api.chatboxai.app/gateway/openai/v1/chat/completions', {}, { parseChatboxRemoteError: true })
    ).rejects.toMatchObject({
      code: 10001,
      statusCode: 500,
      requestId: 'req-from-header',
    } satisfies Partial<ApiError>)
  })

  it('does not retry when the account is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'account_unavailable',
            title: 'Unable to Sign In',
            detail:
              "We can't sign you in to this account. If you believe this is a mistake, please contact hi@chatboxai.com.",
          },
        }),
        { status: 403 }
      )
    )
    const afetch = createAfetch(platformInfo, fetchMock)

    await expect(
      afetch(
        'https://chatboxai.app/api/auth/login_or_signup_with_email_code',
        {},
        {
          parseChatboxRemoteError: true,
          retry: 3,
        }
      )
    ).rejects.toMatchObject({
      code: 10001,
      statusCode: 403,
    } satisfies Partial<ApiError>)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry or clear tokens for an authenticated account-unavailable response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'account_unavailable' } }), {
        status: 403,
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const clearTokens = vi.fn()
    const afetch = createAuthenticatedAfetch({
      platformInfo,
      getTokens: vi.fn().mockResolvedValue({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
      refreshTokens: vi.fn().mockResolvedValue({ accessToken: 'new-access-token', refreshToken: 'new-refresh-token' }),
      clearTokens,
    })

    await expect(
      afetch(
        'https://chatboxai.app/api/auth/web_auth_token/generate',
        {},
        {
          parseChatboxRemoteError: true,
          retry: 3,
        }
      )
    ).rejects.toMatchObject({
      code: 10001,
      statusCode: 403,
    } satisfies Partial<ApiError>)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(clearTokens).not.toHaveBeenCalled()
  })
})
