import { afterEach, describe, expect, it, vi } from 'vitest'
import { loginToBaidu, refreshBaiduCredentials } from './baidu-oauth'
import type { BaiduAppConfiguration } from './types'

const { callbackClose } = vi.hoisted(() => ({ callbackClose: vi.fn() }))

vi.mock('../oauth/pkce', () => ({ generateState: () => 'state-value' }))
vi.mock('../oauth/callback-server', () => ({
  createCallbackServer: () => ({
    promise: Promise.resolve({ code: 'authorization-code', state: 'state-value' }),
    close: callbackClose,
  }),
}))

const configuration: BaiduAppConfiguration = {
  clientId: 'app-key',
  clientSecret: 'secret-key',
  scope: 'basic,netdisk',
}

afterEach(() => {
  vi.unstubAllGlobals()
  callbackClose.mockClear()
})

function tokenResponse(accessToken: string, refreshToken: string) {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 2592000,
      scope: 'basic netdisk',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

describe('Baidu OAuth client', () => {
  it('opens the user application authorization URL and exchanges the callback code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('access-token', 'refresh-token'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errno: 0, uk: 42, netdisk_name: 'Baidu user' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    const openUrl = vi.fn().mockResolvedValue(undefined)

    const credentials = await loginToBaidu(configuration, openUrl, new AbortController().signal)

    const authorizationUrl = new URL(openUrl.mock.calls[0][0])
    expect(authorizationUrl.searchParams.get('client_id')).toBe('app-key')
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1456/auth/callback')
    expect(credentials.refreshToken).toBe('refresh-token')
    expect(credentials.profile?.displayName).toBe('Baidu user')
    expect(callbackClose).toHaveBeenCalledOnce()
  })

  it('uses the locally stored app secret and keeps the rotated refresh token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('new-access-token', 'new-refresh-token'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errno: -1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const credentials = await refreshBaiduCredentials(configuration, 'old-refresh-token')

    const tokenUrl = new URL(fetchMock.mock.calls[0][0])
    expect(tokenUrl.searchParams.get('client_secret')).toBe('secret-key')
    expect(tokenUrl.searchParams.get('refresh_token')).toBe('old-refresh-token')
    expect(credentials.refreshToken).toBe('new-refresh-token')
  })
})
