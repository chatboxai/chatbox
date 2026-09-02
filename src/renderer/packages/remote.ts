import { ofetch } from 'ofetch'
import { z } from 'zod'
import { getLogger } from '@/lib/utils'
import { type ClaimedAgentModeReward, ClaimFreeAgentModeRewardResponseSchema } from '@/packages/agent-mode-reward'
import { VibedropEmailRequiredError } from '@/packages/vibedrop-errors'
import platform from '@/platform'
import { authInfoStore } from '@/stores/authInfoStore'
import { CHATBOX_BUILD_CHANNEL, USE_BETA_CHATBOX, USE_LOCAL_CHATBOX } from '@/variables'
import { ApiError } from '../../shared/models/errors'
import * as chatboxaiAPI from '../../shared/request/chatboxai_pool'
import { createAfetch, createAuthenticatedAfetch, uploadFile } from '../../shared/request/request'
import {
  activateNativeLicense,
  deactivateNativeLicense,
  type NativeLicenseRequestOptions,
  validateNativeLicense,
} from '../../shared/services/native-license'
import { reportNativeContent } from '../../shared/services/native-report'
import {
  type ChatboxAILicenseDetail,
  type ChatboxAIPlanType,
  type Config,
  type CopilotDetail,
  type ModelProvider,
  ProviderModelInfoSchema,
  type RemoteConfig,
  type SessionRagConfig,
  type Settings,
} from '../../shared/types'
import { getOS } from './navigator'

const log = getLogger('remote-api')

let _afetch: ReturnType<typeof createAfetch> | null = null
let afetchPromise: Promise<ReturnType<typeof createAfetch>> | null = null

async function initAfetch(): Promise<ReturnType<typeof createAfetch>> {
  if (afetchPromise) return afetchPromise

  afetchPromise = (async () => {
    _afetch = createAfetch({
      type: platform.type,
      platform: await platform.getPlatform(),
      os: getOS(),
      version: await platform.getVersion(),
    })
    return _afetch
  })()

  return afetchPromise
}

async function getAfetch() {
  if (!_afetch) {
    return await initAfetch()
  }
  return _afetch
}

// ========== Authenticated Afetch (带 token 自动刷新) ==========

let _authenticatedAfetch: ReturnType<typeof createAuthenticatedAfetch> | null = null
let authenticatedAfetchPromise: Promise<ReturnType<typeof createAuthenticatedAfetch>> | null = null

async function initAuthenticatedAfetch(): Promise<ReturnType<typeof createAuthenticatedAfetch>> {
  if (authenticatedAfetchPromise) return authenticatedAfetchPromise

  authenticatedAfetchPromise = (async () => {
    _authenticatedAfetch = createAuthenticatedAfetch({
      platformInfo: {
        type: platform.type,
        platform: await platform.getPlatform(),
        os: getOS(),
        version: await platform.getVersion(),
      },
      getTokens: async () => {
        const tokens = authInfoStore.getState().getTokens()
        return tokens
      },
      refreshTokens: async (refreshToken: string) => {
        const result = await refreshAccessToken({ refreshToken })
        authInfoStore.getState().setTokens(result)
        return result
      },
      clearTokens: async () => {
        authInfoStore.getState().clearTokens()
      },
    })
    return _authenticatedAfetch
  })()

  return authenticatedAfetchPromise
}

async function getAuthenticatedAfetch() {
  if (!_authenticatedAfetch) {
    return await initAuthenticatedAfetch()
  }
  return _authenticatedAfetch
}

// ========== API ORIGIN 根据可用性维护 ==========

// const RELEASE_ORIGIN = 'https://releases.chatboxai.app'
export function getAPIOrigin() {
  return chatboxaiAPI.getChatboxAPIOrigin()
}

export function getChatboxOrigin() {
  if (USE_LOCAL_CHATBOX) {
    return 'http://localhost:3002'
  } else if (USE_BETA_CHATBOX) {
    return 'https://beta.chatboxai.app'
  } else {
    return 'https://chatboxai.app'
  }
}

export function buildChatboxUrl(path: string) {
  return new URL(path, getChatboxOrigin()).toString()
}

const getChatboxHeaders = async () => {
  return {
    'CHATBOX-PLATFORM': await platform.getPlatform(),
    'CHATBOX-PLATFORM-TYPE': platform.type,
    'CHATBOX-CHANNEL': CHATBOX_BUILD_CHANNEL,
    'CHATBOX-VERSION': await platform.getVersion(),
    'CHATBOX-OS': getOS(),
  }
}

// ========== 各个接口方法 ==========

export async function checkNeedUpdate(version: string, os: string, config: Config, settings: Settings) {
  type Response = {
    need_update?: boolean
  }
  // const res = await ofetch<Response>(`${RELEASE_ORIGIN}/chatbox_need_update/${version}`, {
  const res = await ofetch<Response>(`${getAPIOrigin()}/chatbox_need_update/${version}`, {
    method: 'POST',
    retry: 3,
    body: {
      uuid: config.uuid,
      os: os,
      allowReportingAndTracking: settings.allowReportingAndTracking ? 1 : 0,
    },
  })
  return !!res.need_update
}

// export async function getSponsorAd(): Promise<null | SponsorAd> {
//     type Response = {
//         data: null | SponsorAd
//     }
//     // const res = await ofetch<Response>(`${RELEASE_ORIGIN}/sponsor_ad`, {
//     const res = await ofetch<Response>(`${API_ORIGIN}/sponsor_ad`, {
//         retry: 3,
//     })
//     return res['data'] || null
// }

// export async function listSponsorAboutBanner() {
//     type Response = {
//         data: SponsorAboutBanner[]
//     }
//     // const res = await ofetch<Response>(`${RELEASE_ORIGIN}/sponsor_about_banner`, {
//     const res = await ofetch<Response>(`${API_ORIGIN}/sponsor_ad`, {
//         retry: 3,
//     })
//     return res['data'] || []
// }

export async function listCopilotTags(lang: string) {
  type Response = {
    data: string[]
  }
  const res = await ofetch<Response>(`${getAPIOrigin()}/api/system_copilots/tags/${lang}`, {
    method: 'GET',
    retry: 3,
  })
  return res.data
}

export async function listCopilotsByCursor(
  lang: string,
  filters?: {
    limit?: number
    cursor?: string
    tag?: string
    search?: string
  }
) {
  type Response = {
    data: CopilotDetail[]
    next_cursor: string | null
  }
  const res = await ofetch<Response>(`${getAPIOrigin()}/api/system_copilots/list`, {
    method: 'POST',
    retry: 3,
    body: { lang, ...filters },
  })
  return res
}

export async function recordCopilotUsage(params: {
  id: string
  action: 'create_session' | 'create_thread' | 'create_message' | 'use_copilot'
}) {
  await ofetch(`${getAPIOrigin()}/api/system_copilots/record_usage`, {
    method: 'POST',
    body: {
      ...params,
      device_id: (await platform.getConfig()).uuid,
    },
  })
}

export async function recordCopilotShare(detail: CopilotDetail) {
  await ofetch(`${getAPIOrigin()}/api/copilots/share-record`, {
    method: 'POST',
    body: {
      detail: detail,
    },
  })
}

export async function getPremiumPrice() {
  type Response = {
    data: {
      price: number
      discount: number
      discountLabel: string
    }
  }
  const res = await ofetch<Response>(`${getAPIOrigin()}/api/premium/price`, {
    retry: 3,
  })
  return res.data
}

export async function getRemoteConfig(config: keyof RemoteConfig) {
  type Response = {
    data: Pick<RemoteConfig, typeof config>
  }
  const res = await ofetch<Response>(`${getAPIOrigin()}/api/remote_config/${config}`, {
    retry: 3,
    headers: await getChatboxHeaders(),
  })
  return res['data']
}

/**
 * In-memory cache for session RAG remote config. The config controls toolset
 * capabilities (rerank availability, rerank model) which the renderer needs every time
 * a tool set is built — once per generation. Hitting the network on each call is
 * wasteful and adds latency to message submission. The remote config changes rarely
 * (capability flag flips, model swaps), so a 10-minute TTL is comfortable.
 *
 * Each cache entry stores the in-flight promise so concurrent callers share a single
 * request. On rejection the entry is evicted so the next caller retries.
 */
type SessionRagConfigCacheEntry = {
  expiresAt: number
  promise: Promise<SessionRagConfig>
}

const SESSION_RAG_CONFIG_CACHE_TTL_MS = 10 * 60 * 1000
const sessionRagConfigCache = new Map<string, SessionRagConfigCacheEntry>()

export async function getSessionRagConfig(params?: { licenseKey?: string }) {
  type Response = {
    data: SessionRagConfig
  }
  const cacheKey = params?.licenseKey ?? ''
  const now = Date.now()
  const cached = sessionRagConfigCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.promise
  }

  const promise = (async () => {
    const headers = await getChatboxHeaders()
    const res = await ofetch<Response>(`${getAPIOrigin()}/api/session_rag/config`, {
      retry: 3,
      headers: {
        ...(params?.licenseKey ? { Authorization: `Bearer ${params.licenseKey}` } : {}),
        ...headers,
      },
    })
    return res.data
  })()

  const entry: SessionRagConfigCacheEntry = {
    expiresAt: now + SESSION_RAG_CONFIG_CACHE_TTL_MS,
    promise,
  }
  sessionRagConfigCache.set(cacheKey, entry)

  // Evict on failure so the next caller retries instead of being stuck with a rejected
  // promise for the entire TTL window.
  promise.catch(() => {
    if (sessionRagConfigCache.get(cacheKey) === entry) {
      sessionRagConfigCache.delete(cacheKey)
    }
  })

  return promise
}

/**
 * Invalidate cached session RAG config. Call this when the license changes or when the
 * caller has reason to believe the remote config has been updated (e.g. user just
 * activated a new license, signed out).
 */
export function invalidateSessionRagConfigCache(licenseKey?: string) {
  if (licenseKey === undefined) {
    sessionRagConfigCache.clear()
    return
  }
  sessionRagConfigCache.delete(licenseKey)
}

export interface DialogConfig {
  markdown: string
  buttons: { label: string; url: string }[]
}

export async function getDialogConfig(params: { uuid: string; language: string; version: string }) {
  type Response = {
    data: null | DialogConfig
  }
  const res = await ofetch<Response>(`${getAPIOrigin()}/api/dialog_config`, {
    method: 'POST',
    retry: 3,
    body: params,
    headers: await getChatboxHeaders(),
  })
  return res['data'] || null
}

export async function getLicenseDetail(params: { licenseKey: string }) {
  type Response = {
    data: ChatboxAILicenseDetail | null
  }
  const res = await ofetch<Response>(`${getAPIOrigin()}/api/license/detail`, {
    retry: 3,
    headers: {
      Authorization: params.licenseKey,
      ...(await getChatboxHeaders()),
    },
  })
  return res['data'] || null
}

export interface LicenseDetailError {
  code: string
  detail: string
  status: number
  title: string
}

export interface LicenseDetailResponse {
  data: ChatboxAILicenseDetail | null
  error?: LicenseDetailError
}

export async function getLicenseDetailRealtime(params: { licenseKey: string }): Promise<LicenseDetailResponse> {
  type Response = {
    data: ChatboxAILicenseDetail | null
    error?: LicenseDetailError
  }
  // 用于捕获错误响应体
  let capturedError: LicenseDetailError | undefined
  try {
    const res = await ofetch<Response>(`${getAPIOrigin()}/api/license/detail/realtime`, {
      retry: 5,
      headers: {
        Authorization: params.licenseKey,
        ...(await getChatboxHeaders()),
      },
      onResponseError({ response }) {
        // 在错误响应时捕获 error 对象
        const body = response._data as { error?: LicenseDetailError } | undefined
        if (body?.error) {
          capturedError = body.error
        }
      },
    })
    return { data: res.data || null, error: res.error }
  } catch (e: unknown) {
    // 如果捕获到了错误响应体，返回它
    if (capturedError) {
      return { data: null, error: capturedError }
    }
    // 重新抛出原始错误
    throw e
  }
}

export async function generateUploadUrl(params: { licenseKey: string; filename: string }) {
  type Response = {
    data: {
      url: string
      filename: string
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/files/generate-upload-url`,
    {
      method: 'POST',
      headers: {
        Authorization: params.licenseKey,
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    { parseChatboxRemoteError: true }
  )
  const json: Response = await res.json()
  return json['data']
}

export async function createUserFile<T extends boolean>(params: {
  licenseKey: string
  filename: string
  filetype: string
  returnContent: T
}) {
  type Response = {
    data: {
      uuid: string
      content: T extends true ? string : undefined
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/files/create`,
    {
      method: 'POST',
      headers: {
        Authorization: params.licenseKey,
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    { parseChatboxRemoteError: true }
  )
  const json: Response = await res.json()
  return json['data']
}

export async function uploadAndCreateUserFile(licenseKey: string, file: File) {
  const { url, filename } = await generateUploadUrl({
    licenseKey,
    filename: file.name,
  })
  log.debug(`Uploading user file to URL: ${url}`)
  await uploadFile(file, url)
  log.debug(`Uploaded user file: ${file.name}`)
  const result = await createUserFile({
    licenseKey,
    filename,
    filetype: file.type,
    returnContent: true,
  })
  log.debug(`Created user file with UUID: ${result.uuid}`)
  const storageKey = `parseFile-${file.name}_${result.uuid}.${file.type.split('/')[1]}.txt`

  await platform.setStoreBlob(storageKey, result.content)
  return storageKey
}

export async function parseUserLinkPro(params: { licenseKey: string; url: string; abortSignal?: AbortSignal }) {
  type Response = {
    data: {
      uuid: string
      title: string
      content: string
    }
  }
  const { licenseKey, url, abortSignal } = params
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/links/parse`,
    {
      method: 'POST',
      headers: {
        Authorization: licenseKey,
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        licenseKey,
        url,
        returnContent: true,
      }),
      signal: abortSignal,
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  const storageKey = `parseUrl-${url}_${json['data']['uuid']}.txt`
  if (json['data']['content']) {
    await platform.setStoreBlob(storageKey, json['data']['content'])
  }
  return {
    key: json['data']['uuid'],
    title: json['data']['title'],
    storageKey,
  }
}

export async function parseUserLinkFree(params: { url: string }) {
  type Response = {
    title: string
    text: string
  }
  const afetch = await getAfetch()
  const res = await afetch(`https://cors-proxy.chatboxai.app/api/fetch-webpage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getChatboxHeaders()),
    },
    body: JSON.stringify(params),
  })
  const json: Response = await res.json()
  return json
}

/**
 * Request seam for the Chatbox `build-in` web search provider. Mirrors
 * `getLicenseRequestOptions`: injects an afetch `fetchFn` (Chatbox error parsing + retry),
 * the API origin, and the Chatbox platform headers into the shared `searchNativeWeb` call.
 */
export async function getChatboxWebSearchRequestOptions(): Promise<{
  chatboxApiOrigin: string
  fetchFn: typeof fetch
  headers: Record<string, string>
}> {
  const afetch = await getAfetch()
  return {
    chatboxApiOrigin: getAPIOrigin(),
    fetchFn: (input, init) => afetch(input, init, { parseChatboxRemoteError: true, retry: 2 }),
    headers: await getChatboxHeaders(),
  }
}

async function getLicenseRequestOptions(): Promise<NativeLicenseRequestOptions> {
  const afetch = await getAfetch()
  return {
    apiOrigin: getAPIOrigin(),
    fetchFn: (input, init) => afetch(input, init, { parseChatboxRemoteError: true, retry: 5 }),
    headers: await getChatboxHeaders(),
  }
}

export async function activateLicense(params: { licenseKey: string; instanceName: string }) {
  const result = await activateNativeLicense(params.licenseKey, params.instanceName, await getLicenseRequestOptions())
  return { ...result, error: result.error ?? '' }
}

export async function deactivateLicense(params: { licenseKey: string; instanceId: string }) {
  await deactivateNativeLicense(params.licenseKey, params.instanceId, await getLicenseRequestOptions())
}

export async function validateLicense(params: { licenseKey: string; instanceId: string }) {
  return { valid: await validateNativeLicense(params.licenseKey, params.instanceId, await getLicenseRequestOptions()) }
}

const RemoteModelInfoSchema = z.object({
  modelId: z.string(),
  modelName: z.string(),
  labels: z.array(z.string()).optional(),
  type: z.enum(['chat', 'embedding', 'rerank', 'image']).optional(),
  apiStyle: z.enum(['google', 'openai', 'openai-responses', 'anthropic']).optional(),
  contextWindow: z.number().optional(),
  capabilities: z.array(z.enum(['vision', 'tool_use', 'reasoning'])).optional(),
})

export type RemoteModelInfo = z.infer<typeof RemoteModelInfoSchema>

const ModelManifestResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.object({
    groupName: z.string(),
    models: z.array(RemoteModelInfoSchema),
    imageModels: z.array(RemoteModelInfoSchema).optional().default([]),
  }),
})

export async function getModelManifest(params: { aiProvider: ModelProvider; licenseKey?: string; language?: string }) {
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/model_manifest`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        aiProvider: params.aiProvider,
        licenseKey: params.licenseKey,
        language: params.language,
      }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const { success, data, error } = ModelManifestResponseSchema.safeParse(await res.json())
  if (!success) {
    log.error('getModelManifest error', error)
    throw error
  }
  return data.data
}

const ChatboxAIModelAccessSchema = z.object({
  available: z.boolean().optional().default(true),
})

const ChatboxAIModelPriceTierSchema = z.object({
  max_input_tokens: z.number().optional().default(0),
  max_output_tokens: z.number().optional().default(0),
  price_input: z.number(),
  price_output: z.number(),
})

const ChatboxAIModelPricingSchema = z.object({
  tokensPerComputePoint: z.number().optional().default(0),
  officialInput: z.number().optional().default(0),
  officialOutput: z.number().optional().default(0),
  tieredPricing: z.array(ChatboxAIModelPriceTierSchema).optional().default([]),
})

const ChatboxAIModelInfoSchema = RemoteModelInfoSchema.extend({
  costLevel: z.string().optional().default(''),
  description: z.string().optional().default(''),
  access: ChatboxAIModelAccessSchema.optional().default({ available: true }),
  pricing: ChatboxAIModelPricingSchema.optional(),
})

const ChatboxAIModelListResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      provider: z.object({
        id: z.string(),
        name: z.string(),
      }),
      license: z
        .object({
          plan: z.string().optional().default('unknown'),
        })
        .optional()
        .default({ plan: 'unknown' }),
      groups: z.array(
        z.object({
          id: z.string(),
          modelIds: z.array(z.string()),
          featuredModelIds: z.array(z.string()).optional(),
        })
      ),
      models: z.record(z.string(), ChatboxAIModelInfoSchema),
      imageModels: z.array(RemoteModelInfoSchema).optional().default([]),
      links: z
        .object({
          modelPricing: z.string().optional(),
          upgrade: z.string().optional(),
        })
        .optional(),
    })
    .passthrough(),
})

export type ChatboxAIModelList = z.infer<typeof ChatboxAIModelListResponseSchema>['data']

export async function getChatboxAIModelList(params: { licenseKey?: string; language?: string }) {
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/chatbox_ai/model_list`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        licenseKey: params.licenseKey,
        language: params.language,
      }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const { success, data, error } = ChatboxAIModelListResponseSchema.safeParse(await res.json())
  if (!success) {
    log.error('getChatboxAIModelList error', error)
    throw error
  }
  return data.data
}

export async function reportContent(params: { id: string; type: string; details: string }) {
  const afetch = await getAfetch()
  await reportNativeContent({
    ...params,
    apiOrigin: getAPIOrigin(),
    fetchFn: (input, init) => afetch(input, init),
    headers: await getChatboxHeaders(),
  })
}

const ProviderInfoResponseSchema = z.object({
  success: z.boolean(),
  data: z.record(z.string(), ProviderModelInfoSchema.nullable()),
})

export async function getProviderModelsInfo(params: { modelIds: string[] }) {
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/provider_models_info`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json = ProviderInfoResponseSchema.parse(await res.json())
  return json.data
}

export async function requestLoginTicketId() {
  type Response = {
    data: {
      ticket_id: string
    }
  }
  const afetch = await getAfetch()

  let deviceType: string
  if (platform.type === 'mobile') {
    deviceType = await platform.getPlatform()
  } else if (platform.type === 'desktop') {
    const os = getOS()
    deviceType = os
  } else {
    // web 或其他
    deviceType = platform.type
  }
  const appVersion = await platform.getVersion()
  const deviceName = await platform.getDeviceName()

  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/request_login_ticket`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        device_type: deviceType,
        app_version: appVersion,
        device_name: deviceName,
      }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 3,
    }
  )
  const json: Response = await res.json()
  return json.data.ticket_id
}

export async function sendEmailLoginCode(params: { email: string; lang?: string }) {
  type Response = {
    data: {
      result: string
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/send_email_login_code`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        email: params.email,
        lang: params.lang,
      }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  return json.data.result
}

export async function loginOrSignupWithEmailCode(params: { email: string; code: string }) {
  type Response = {
    data: {
      access_token: string
      refresh_token: string
    }
    success: boolean
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/login_or_signup_with_email_code`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        email: params.email,
        code: params.code,
      }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 1,
    }
  )
  const json: Response = await res.json()
  return {
    accessToken: json.data.access_token,
    refreshToken: json.data.refresh_token,
  }
}

export async function getWebAuthToken(): Promise<string> {
  type Response = {
    data: {
      web_auth_token: string
    }
    success: boolean
  }
  const afetch = await getAuthenticatedAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/web_auth_token/generate`,
    {
      method: 'POST',
      headers: {
        ...(await getChatboxHeaders()),
      },
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  return json.data.web_auth_token
}

export async function checkLoginStatus(ticketId: string) {
  type Response = {
    data: {
      status?: 'success' | 'rejected' | 'pending'
      access_token?: string
      refresh_token?: string
    }
    success: boolean
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/login_status`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({ ticket_id: ticketId }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  const responseStatus = json.data.status
  const accessToken = json.data.access_token || null
  const refreshToken = json.data.refresh_token || null

  let status: 'pending' | 'success' | 'rejected' = 'pending'
  if (responseStatus === 'success' && accessToken && refreshToken) {
    status = 'success'
  } else if (responseStatus === 'rejected') {
    status = 'rejected'
  }

  return {
    status,
    accessToken,
    refreshToken,
  }
}

export async function refreshAccessToken(params: { refreshToken: string }) {
  type Response = {
    data: {
      result: string
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/auth/token_refresh`,
    {
      method: 'POST',
      headers: {
        'x-chatbox-refresh-token': params.refreshToken,
        ...(await getChatboxHeaders()),
      },
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  // log.info('✅ refreshAccessToken response', json)

  const accessToken = res.headers.get('x-chatbox-access-token')
  const refreshToken = res.headers.get('x-chatbox-refresh-token')

  if (!accessToken || !refreshToken) {
    log.error('❌ Missing tokens in response headers:', {
      accessToken: accessToken ? 'present' : 'missing',
      refreshToken: refreshToken ? 'present' : 'missing',
    })
    throw new Error('Failed to refresh token: missing tokens in response headers')
  }

  return {
    accessToken,
    refreshToken,
  }
}

export async function getUserProfile() {
  type Response = {
    data: {
      email: string
      id: string
      created_at: string
    }
  }
  const afetch = await getAuthenticatedAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/user/profile`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  return json.data
}

/**
 * Issue (or fetch the cached) VibeDrop publish key for the logged-in user.
 * chatbox-backend acts as a trusted VibeDrop partner: it derives the email from
 * the JWT and returns a key bound to that account. Throws
 * VibedropEmailRequiredError when the account has no email.
 */
export async function issueVibedropKey(): Promise<{ vdKey: string; tier: string }> {
  const afetch = await getAuthenticatedAfetch()
  try {
    const res = await afetch(
      `${getAPIOrigin()}/api/vibedrop/issue-key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getChatboxHeaders()),
        },
      },
      // No retry: issue-key is a fast upsert; email_required is a deterministic
      // 400 and retrying it just wastes a round-trip (afetch retries all non-2xx).
      { retry: 0 }
    )
    const json: { vd_key: string; tier: string } = await res.json()
    return { vdKey: json.vd_key, tier: json.tier }
  } catch (e) {
    if (e instanceof ApiError && e.responseBody) {
      try {
        const parsed = JSON.parse(e.responseBody)
        if (parsed?.error?.code === 'email_required') {
          throw new VibedropEmailRequiredError('email required')
        }
      } catch (parseErr) {
        if (parseErr instanceof VibedropEmailRequiredError) throw parseErr
      }
    }
    throw e
  }
}

export interface UserLicense {
  id: number
  key: string
  status: string
  platform: string
  product_name: string
  plan?: ChatboxAIPlanType
  payment_type: string
  image_usage: number
  unified_token_usage: number
  unified_token_limit: number
  unified_token_usage_details: Array<{
    type: string
    token_usage: number
    token_limit: number
  }>
  image_limit: number
  next_token_refresh_at: string
  expires_at: string
  created_at: string
  recurring_canceled: boolean
  quota_packs: any[]
}

export async function listLicensesByUser(): Promise<UserLicense[]> {
  type Response = {
    data: UserLicense[]
  }
  const afetch = await getAuthenticatedAfetch()
  const res = await afetch(
    `${getChatboxOrigin()}/api/license/list_by_user`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  return json.data
}

export async function claimFreeAgentModeReward(licenseKey: string): Promise<ClaimedAgentModeReward> {
  const normalizedLicenseKey = licenseKey.trim()
  if (!normalizedLicenseKey) {
    throw new Error('A license key is required to claim the Agent Mode reward')
  }

  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/license/claim-free-agent-mode-reward`,
    {
      method: 'POST',
      headers: {
        ...(await getChatboxHeaders()),
        Authorization: `Bearer ${normalizedLicenseKey}`,
      },
    },
    {
      parseChatboxRemoteError: true,
      retry: 0,
    }
  )
  return ClaimFreeAgentModeRewardResponseSchema.parse(await res.json())
}

// ========== Image Generation API ==========

const IMAGE_GEN_API_ORIGIN = getAPIOrigin()

export interface ImageCompletionRequest {
  model: string
  prompt: string
  response_format: 'b64_json'
  style?: string
  aspect_ratio?: string
  quantity?: number
  images?: Array<{ image_url: string }>
}

// Zod schemas for runtime validation
// 后端异步生图任务的单个图片 item 状态；不要和客户端本地状态 ImageGeneration.status 混淆。
// 这些状态来自接口，客户端会在 imageGenerationActions.ts 中聚合成一条本地生成记录的整体状态。
const ImageGenerationItemSchema = z.object({
  uuid: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  created_at: z.string(),
  image_url: z.string().optional(),
  thumbnail_url: z.string().optional(),
  generated_at: z.string().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
})

const ImageGenerationTaskResponseSchema = z.object({
  // 接口结构预留为数组，但当前产品功能层面不支持一次异步生成多张图。
  // 现阶段后端也写死item 为 1；
  items: z.array(ImageGenerationItemSchema),
  is_finished: z.boolean(),
  task_id: z.string(),
})

export type ImageGenerationItem = z.infer<typeof ImageGenerationItemSchema>
export type ImageGenerationTaskResponse = z.infer<typeof ImageGenerationTaskResponseSchema>

export async function submitImageGeneration(
  params: ImageCompletionRequest,
  licenseKey: string
): Promise<ImageGenerationTaskResponse> {
  const afetch = await getAfetch()
  const res = await afetch(
    `${IMAGE_GEN_API_ORIGIN}/api/images/async_generations`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${licenseKey}`,
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify(params),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json = await res.json()
  return ImageGenerationTaskResponseSchema.parse(json)
}

export async function pollImageTask(
  taskId: string,
  licenseKey: string,
  signal?: AbortSignal
): Promise<ImageGenerationTaskResponse> {
  const afetch = await getAfetch()
  const res = await afetch(
    `${IMAGE_GEN_API_ORIGIN}/api/images/async_generations/${taskId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${licenseKey}`,
        ...(await getChatboxHeaders()),
      },
      signal,
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json = await res.json()
  return ImageGenerationTaskResponseSchema.parse(json)
}

export const IMAGE_GENERATION_POLL_INTERVAL_MS = 2000

export async function pollTaskUntilComplete(
  taskId: string,
  licenseKey: string,
  options?: {
    signal?: AbortSignal
    onPoll?: (response: ImageGenerationTaskResponse) => void
  }
): Promise<ImageGenerationTaskResponse> {
  while (true) {
    if (options?.signal?.aborted) {
      throw new DOMException('Polling aborted', 'AbortError')
    }

    const result = await pollImageTask(taskId, licenseKey, options?.signal)
    options?.onPoll?.(result)

    if (result.is_finished) {
      return result
    }

    await new Promise((resolve) => setTimeout(resolve, IMAGE_GENERATION_POLL_INTERVAL_MS))
  }
}
