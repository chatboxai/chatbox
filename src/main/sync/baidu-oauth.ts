import { baiduRedirectUri } from '../../shared/sync'
import { createCallbackServer } from '../oauth/callback-server'
import { generateState } from '../oauth/pkce'
import type { BaiduAppConfiguration, StoredBaiduCredentials } from './types'

export const BAIDU_REDIRECT_URI = baiduRedirectUri

function validateConfiguration(configuration: BaiduAppConfiguration): void {
  if (!configuration.clientId.trim()) throw new Error('baidu_client_id_required')
  if (!configuration.clientSecret.trim()) throw new Error('baidu_client_secret_required')
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as unknown
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('baidu_invalid_response')
  }
  return body as Record<string, unknown>
}

function requireString(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field]
  if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
    throw new Error(`baidu_response_missing_${field}`)
  }
  return fieldValue
}

function numberValue(value: Record<string, unknown>, field: string): number | undefined {
  const fieldValue = value[field]
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? fieldValue : undefined
}

async function fetchProfile(accessToken: string, signal?: AbortSignal): Promise<StoredBaiduCredentials['profile']> {
  const url = new URL('https://pan.baidu.com/rest/2.0/xpan/nas')
  url.searchParams.set('method', 'uinfo')
  url.searchParams.set('access_token', accessToken)
  const timeout = AbortSignal.timeout(20_000)
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok) return undefined
  const body = await readJson(response)
  if (numberValue(body, 'errno') !== 0) return undefined
  return {
    userId: typeof body.uk === 'string' || typeof body.uk === 'number' ? String(body.uk) : undefined,
    displayName:
      typeof body.netdisk_name === 'string'
        ? body.netdisk_name
        : typeof body.baidu_name === 'string'
          ? body.baidu_name
          : undefined,
    avatarUrl: typeof body.avatar_url === 'string' ? body.avatar_url : undefined,
    vipType: numberValue(body, 'vip_type'),
  }
}

async function exchangeTokens(
  configuration: BaiduAppConfiguration,
  parameters: Record<string, string>,
  signal?: AbortSignal
): Promise<StoredBaiduCredentials> {
  const url = new URL('https://openapi.baidu.com/oauth/2.0/token')
  for (const [key, value] of Object.entries({
    ...parameters,
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
  })) {
    url.searchParams.set(key, value)
  }

  const timeout = AbortSignal.timeout(20_000)
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  const body = await readJson(response)
  if (!response.ok || typeof body.error === 'string') {
    throw new Error('baidu_token_exchange_failed')
  }

  const accessToken = requireString(body, 'access_token')
  const refreshToken = requireString(body, 'refresh_token')
  const expiresIn = numberValue(body, 'expires_in')
  if (!expiresIn || expiresIn <= 0) throw new Error('baidu_response_missing_expires_in')

  let profile: StoredBaiduCredentials['profile']
  try {
    profile = await fetchProfile(accessToken, signal)
  } catch {
    // User information is optional; valid OAuth credentials remain usable if this request fails.
  }

  const now = Date.now()
  return {
    accessToken,
    refreshToken,
    expiresAt: now + expiresIn * 1000,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
    profile,
    lastCallAt: now,
  }
}

export async function loginToBaidu(
  configuration: BaiduAppConfiguration,
  openUrl: (url: string) => Promise<void>,
  signal: AbortSignal
): Promise<StoredBaiduCredentials> {
  validateConfiguration(configuration)
  const redirectUri = new URL(BAIDU_REDIRECT_URI)
  const state = generateState()
  const authorizationUrl = new URL('https://openapi.baidu.com/oauth/2.0/authorize')
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('client_id', configuration.clientId)
  authorizationUrl.searchParams.set('redirect_uri', redirectUri.toString())
  authorizationUrl.searchParams.set('scope', configuration.scope)
  authorizationUrl.searchParams.set('state', state)

  const callback = createCallbackServer(Number(redirectUri.port), signal, redirectUri.hostname)
  try {
    const [result] = await Promise.all([callback.promise, openUrl(authorizationUrl.toString())])
    if (result.state !== state) throw new Error('baidu_oauth_state_mismatch')
    return await exchangeTokens(
      configuration,
      {
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: redirectUri.toString(),
      },
      signal
    )
  } finally {
    callback.close()
  }
}

export function refreshBaiduCredentials(
  configuration: BaiduAppConfiguration,
  refreshToken: string
): Promise<StoredBaiduCredentials> {
  validateConfiguration(configuration)
  return exchangeTokens(configuration, { grant_type: 'refresh_token', refresh_token: refreshToken })
}
