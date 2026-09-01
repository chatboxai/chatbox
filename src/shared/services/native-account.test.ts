import { describe, expect, it, vi } from 'vitest'
import {
  fetchNativeAccountLicenses,
  fetchNativeAccountProfile,
  fetchNativeChatboxAIModels,
  generateNativeWebAuthToken,
  loginNativeEmailCode,
  refreshNativeAccountTokens,
  sendNativeEmailLoginCode,
} from './native-account'

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
}

describe('native account service', () => {
  it('supports the email login and refresh flow with an injected fetch', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { result: 'ok' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'access', refresh_token: 'refresh' } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { data: { result: 'ok' } },
          { headers: { 'x-chatbox-access-token': 'next-access', 'x-chatbox-refresh-token': 'next-refresh' } }
        )
      )

    await sendNativeEmailLoginCode('user@example.com', 'en', { fetchFn })
    await expect(loginNativeEmailCode('user@example.com', '123456', { fetchFn })).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
    })
    await expect(refreshNativeAccountTokens('refresh', { fetchFn })).resolves.toEqual({
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
    })
  })

  it('normalizes profile and license responses', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'user-1', email: 'user@example.com' } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              key: 'license',
              product_name: 'Pro',
              image_limit: 10,
              unified_token_limit: 20,
            },
          ],
        })
      )

    await expect(fetchNativeAccountProfile('access', { fetchFn })).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.com',
      createdAt: undefined,
    })
    await expect(fetchNativeAccountLicenses('access', { fetchFn })).resolves.toEqual([
      expect.objectContaining({ key: 'license', productName: 'Pro', imageLimit: 10, unifiedTokenLimit: 20 }),
    ])
  })

  it('generates a web authentication token for account links', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ data: { web_auth_token: 'web-token' } }))

    await expect(generateNativeWebAuthToken('access', { fetchFn })).resolves.toBe('web-token')
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.chatboxai.app/api/auth/web_auth_token/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-chatbox-access-token': 'access' }),
      })
    )
  })

  it('accepts the camel-case profile creation timestamp', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 1, email: 'user@example.com', createdAt: '2026-08-10' } }))

    await expect(fetchNativeAccountProfile('access', { fetchFn })).resolves.toEqual({
      id: '1',
      email: 'user@example.com',
      createdAt: '2026-08-10',
    })
  })

  it('projects available Chatbox AI models into shared ProviderModelInfo', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: {
          models: {
            visible: {
              modelId: 'chatbox-model',
              modelName: 'Chatbox Model',
              capabilities: ['vision', 'tool_use'],
              labels: ['pro', 'new'],
              maxOutput: 8192,
              access: { available: true },
            },
            hidden: { modelId: 'hidden', modelName: 'Hidden', access: { available: false } },
          },
          imageModels: [],
        },
      })
    )

    await expect(fetchNativeChatboxAIModels('license', 'en', { fetchFn })).resolves.toEqual([
      expect.objectContaining({
        labels: ['pro', 'new'],
        maxOutput: 8192,
        modelId: 'chatbox-model',
        nickname: 'Chatbox Model',
      }),
    ])
  })
})
