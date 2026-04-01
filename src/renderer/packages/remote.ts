import { ofetch } from 'ofetch'
import { z } from 'zod'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { authInfoStore } from '@/stores/authInfoStore'
import { CHATBOX_BUILD_CHANNEL, USE_BETA_API, USE_BETA_CHATBOX, USE_LOCAL_API, USE_LOCAL_CHATBOX } from '@/variables'
import * as chatboxaiAPI from '../../shared/request/chatboxai_pool'
import { createAfetch, createAuthenticatedAfetch, uploadFile } from '../../shared/request/request'
import {
  type ChatboxAILicenseDetail,
  type Config,
  type CopilotDetail,
  type ModelProvider,
  ProviderModelInfoSchema,
  type RemoteConfig,
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
function getAPIOrigin() {
  if (USE_LOCAL_API) {
    return 'http://localhost:8002'
  } else if (USE_BETA_API) {
    return 'https://api-beta.chatboxai.app'
  } else {
    return chatboxaiAPI.getChatboxAPIOrigin()
  }
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

export async function parseUserLinkPro(params: { licenseKey: string; url: string }) {
  type Response = {
    data: {
      uuid: string
      title: string
      content: string
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/links/parse`,
    {
      method: 'POST',
      headers: {
        Authorization: params.licenseKey,
        'Content-Type': 'application/json',
        ...(await getChatboxHeaders()),
      },
      body: JSON.stringify({
        ...params,
        returnContent: true,
      }),
    },
    {
      parseChatboxRemoteError: true,
      retry: 2,
    }
  )
  const json: Response = await res.json()
  const storageKey = `parseUrl-${params.url}_${json['data']['uuid']}.txt`
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

export async function webBrowsing(params: { licenseKey: string; query: string }) {
  type Response = {
    data: {
      uuid?: string
      query: string
      links: {
        title: string
        url: string
        content: string
      }[]
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/tool/web-search`,
    {
      method: 'POST',
      headers: {
        Authorization: params.licenseKey,
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
  const json: Response = await res.json()
  return json['data']
}

export async function activateLicense(params: { licenseKey: string; instanceName: string }) {
  type Response = {
    data: {
      valid: boolean
      instanceId: string
      error: string
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/license/activate`,
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
      retry: 5,
    }
  )
  const json: Response = await res.json()
  return json['data']
}

export async function deactivateLicense(params: { licenseKey: string; instanceId: string }) {
  const afetch = await getAfetch()
  await afetch(
    `${getAPIOrigin()}/api/license/deactivate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    },
    {
      parseChatboxRemoteError: true,
      retry: 5,
    }
  )
}

export async function validateLicense(params: { licenseKey: string; instanceId: string }) {
  type Response = {
    data: {
      valid: boolean
    }
  }
  const afetch = await getAfetch()
  const res = await afetch(
    `${getAPIOrigin()}/api/license/validate`,
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
      retry: 5,
    }
  )
  const json: Response = await res.json()
  return json['data']
}

const RemoteModelInfoSchema = z.object({
  modelId: z.string(),
  modelName: z.string(),
  labels: z.array(z.string()).optional(),
  type: z.enum(['chat', 'embedding', 'rerank']).optional(),
  apiStyle: z.enum(['google', 'openai', 'anthropic']).optional(),
  contextWindow: z.number().optional(),
  capabilities: z.array(z.enum(['vision', 'tool_use', 'reasoning'])).optional(),
})

const ModelManifestResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.object({
    groupName: z.string(),
    models: z.array(RemoteModelInfoSchema),
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

export async function reportContent(params: { id: string; type: string; details: string }) {
  const afetch = await getAfetch()
  await afetch(`${getAPIOrigin()}/api/report_content`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getChatboxHeaders()),
    },
    body: JSON.stringify(params),
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

export interface UserLicense {
  id: number
  key: string
  status: string
  platform: string
  product_name: string
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
const ImageGenerationItemSchema = z.object({
  uuid: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  created_at: z.string(),
  image_url: z.string().optional(),
  generated_at: z.string().optional(),
})

const ImageGenerationTaskResponseSchema = z.object({
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

const POLL_INTERVAL_MS = 2000

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

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}
