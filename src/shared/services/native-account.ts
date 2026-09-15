import type { ProviderModelInfo } from '../types'
import type { AbortSignalLike } from '../types/adapters'
import type { ChatboxAIPlanType } from '../types/settings'

type NativeFetchInit = NonNullable<Parameters<typeof fetch>[1]>
type NativeFetch = (input: string, init?: NativeFetchInit) => Promise<Response>

export interface NativeAccountRequestOptions {
  apiOrigin?: string
  fetchFn?: NativeFetch
  signal?: AbortSignalLike
  headers?: Record<string, string>
}

export interface NativeAccountTokens {
  accessToken: string
  refreshToken: string
}

export interface NativeAccountProfile {
  id?: string
  email: string
  createdAt?: string
}

export interface NativeAccountLicense {
  id: number
  key: string
  status: string
  platform: string
  productName: string
  plan?: ChatboxAIPlanType
  paymentType: string
  imageUsage: number
  imageLimit: number
  unifiedTokenUsage: number
  unifiedTokenLimit: number
  nextTokenRefreshAt: string
  expiresAt: string
  quotaPacks?: unknown[]
  recurringCanceled: boolean
}

const DEFAULT_API_ORIGIN = 'https://api.chatboxai.app'

function origin(value: string | undefined): string {
  return (value?.trim() || DEFAULT_API_ORIGIN).replace(/\/+$/, '')
}

async function requestJson(
  path: string,
  init: RequestInit,
  options: NativeAccountRequestOptions
): Promise<{ response: Response; payload: unknown }> {
  const response = await (options.fetchFn ?? fetch)(`${origin(options.apiOrigin)}${path}`, {
    ...init,
    headers: { ...options.headers, ...init.headers },
    signal: options.signal as NativeFetchInit['signal'],
  } as NativeFetchInit)
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload : null
    const error = record && 'error' in record && record.error && typeof record.error === 'object' ? record.error : null
    const message =
      error && 'message' in error && typeof error.message === 'string'
        ? error.message
        : `Account request failed with status ${response.status}`
    throw new Error(message)
  }
  return { response, payload }
}

function dataRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || !('data' in payload))
    throw new Error('Account response was not understood')
  const data = payload.data
  if (!data || typeof data !== 'object') throw new Error('Account response was not understood')
  return data as Record<string, unknown>
}

export async function sendNativeEmailLoginCode(
  email: string,
  language: string | undefined,
  options: NativeAccountRequestOptions = {}
): Promise<void> {
  await requestJson(
    '/api/auth/send_email_login_code',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, lang: language }),
    },
    options
  )
}

export async function loginNativeEmailCode(
  email: string,
  code: string,
  options: NativeAccountRequestOptions = {}
): Promise<NativeAccountTokens> {
  const { payload } = await requestJson(
    '/api/auth/login_or_signup_with_email_code',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    },
    options
  )
  const data = dataRecord(payload)
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
    throw new Error('Login response did not contain tokens')
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token }
}

export async function refreshNativeAccountTokens(
  refreshToken: string,
  options: NativeAccountRequestOptions = {}
): Promise<NativeAccountTokens> {
  const { response } = await requestJson(
    '/api/auth/token_refresh',
    { method: 'POST', headers: { 'x-chatbox-refresh-token': refreshToken } },
    options
  )
  const accessToken = response.headers.get('x-chatbox-access-token')
  const nextRefreshToken = response.headers.get('x-chatbox-refresh-token')
  if (!accessToken || !nextRefreshToken) throw new Error('Token refresh response did not contain tokens')
  return { accessToken, refreshToken: nextRefreshToken }
}

export async function generateNativeWebAuthToken(
  accessToken: string,
  options: NativeAccountRequestOptions = {}
): Promise<string> {
  const { payload } = await requestJson(
    '/api/auth/web_auth_token/generate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-chatbox-access-token': accessToken },
    },
    options
  )
  const data = dataRecord(payload)
  if (typeof data.web_auth_token !== 'string') {
    throw new Error('Web authentication response did not contain a token')
  }
  return data.web_auth_token
}

export async function fetchNativeAccountProfile(
  accessToken: string,
  options: NativeAccountRequestOptions = {}
): Promise<NativeAccountProfile> {
  const { payload } = await requestJson(
    '/api/user/profile',
    { headers: { 'Content-Type': 'application/json', 'x-chatbox-access-token': accessToken } },
    options
  )
  const data = dataRecord(payload)
  if (typeof data.email !== 'string') {
    throw new Error('Profile response was not understood')
  }
  const id =
    typeof data.id === 'string'
      ? data.id
      : typeof data.id === 'number' && Number.isFinite(data.id)
        ? String(data.id)
        : undefined
  const createdAt =
    typeof data.created_at === 'string'
      ? data.created_at
      : typeof data.createdAt === 'string'
        ? data.createdAt
        : undefined
  return { id, email: data.email, createdAt }
}

export async function fetchNativeAccountLicenses(
  accessToken: string,
  options: NativeAccountRequestOptions = {}
): Promise<NativeAccountLicense[]> {
  const { payload } = await requestJson(
    '/api/license/list_by_user',
    { headers: { 'Content-Type': 'application/json', 'x-chatbox-access-token': accessToken } },
    options
  )
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data)) {
    throw new Error('License list response was not understood')
  }
  return payload.data.flatMap((candidate): NativeAccountLicense[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const value = candidate as Record<string, unknown>
    if (typeof value.id !== 'number' || typeof value.key !== 'string') return []
    return [
      {
        id: value.id,
        key: value.key,
        status: typeof value.status === 'string' ? value.status : '',
        platform: typeof value.platform === 'string' ? value.platform : '',
        productName: typeof value.product_name === 'string' ? value.product_name : '',
        plan: typeof value.plan === 'string' ? (value.plan as ChatboxAIPlanType) : undefined,
        paymentType: typeof value.payment_type === 'string' ? value.payment_type : '',
        imageUsage: typeof value.image_usage === 'number' ? value.image_usage : 0,
        imageLimit: typeof value.image_limit === 'number' ? value.image_limit : 0,
        unifiedTokenUsage: typeof value.unified_token_usage === 'number' ? value.unified_token_usage : 0,
        unifiedTokenLimit: typeof value.unified_token_limit === 'number' ? value.unified_token_limit : 0,
        nextTokenRefreshAt: typeof value.next_token_refresh_at === 'string' ? value.next_token_refresh_at : '',
        expiresAt: typeof value.expires_at === 'string' ? value.expires_at : '',
        quotaPacks: Array.isArray(value.quota_packs) ? value.quota_packs : [],
        recurringCanceled: value.recurring_canceled === true,
      },
    ]
  })
}

function normalizeModel(candidate: unknown): ProviderModelInfo | null {
  if (!candidate || typeof candidate !== 'object') return null
  const value = candidate as Record<string, unknown>
  if (typeof value.modelId !== 'string') return null
  const type =
    value.type === 'embedding' || value.type === 'rerank' || value.type === 'image' || value.type === 'chat'
      ? value.type
      : undefined
  const apiStyle =
    value.apiStyle === 'google' ||
    value.apiStyle === 'openai' ||
    value.apiStyle === 'openai-responses' ||
    value.apiStyle === 'anthropic'
      ? value.apiStyle
      : undefined
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.filter(
        (item): item is 'vision' | 'reasoning' | 'tool_use' | 'web_search' =>
          item === 'vision' || item === 'reasoning' || item === 'tool_use' || item === 'web_search'
      )
    : undefined
  const labels = Array.isArray(value.labels)
    ? value.labels.filter((item): item is string => typeof item === 'string')
    : undefined
  return {
    modelId: value.modelId,
    nickname: typeof value.modelName === 'string' ? value.modelName : undefined,
    type,
    apiStyle,
    labels,
    capabilities,
    contextWindow: typeof value.contextWindow === 'number' ? value.contextWindow : undefined,
    maxOutput: typeof value.maxOutput === 'number' ? value.maxOutput : undefined,
  }
}

export async function fetchNativeChatboxAIModels(
  licenseKey: string | undefined,
  language: string | undefined,
  options: NativeAccountRequestOptions = {}
): Promise<ProviderModelInfo[]> {
  const { payload } = await requestJson(
    '/api/chatbox_ai/model_list',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, language }),
    },
    options
  )
  const data = dataRecord(payload)
  const models = data.models && typeof data.models === 'object' ? Object.values(data.models) : []
  const imageModels = Array.isArray(data.imageModels) ? data.imageModels : []
  return [...models, ...imageModels].flatMap((candidate) => {
    if (candidate && typeof candidate === 'object' && 'access' in candidate) {
      const access = candidate.access
      if (access && typeof access === 'object' && 'available' in access && access.available === false) return []
    }
    const model = normalizeModel(candidate)
    return model ? [model] : []
  })
}
