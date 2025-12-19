import { ApiError, BaseError, ChatboxAIAPIError, NetworkError } from '../models/errors'
import { parseJsonOrEmpty } from '../utils/json_utils'
import { isChatboxAPI } from './chatboxai_pool'

interface PlatformInfo {
  type: string
  platform: string
  os: string
  version: string
}

export function createAfetch(platformInfo: PlatformInfo) {
  return async function afetch(
    url: RequestInfo | URL,
    init?: RequestInit,
    options: {
      retry?: number
      parseChatboxRemoteError?: boolean
    } = {}
  ) {
    let requestError: BaseError | null = null
    const retry = options.retry || 0
    for (let i = 0; i < retry + 1; i++) {
      try {
        if (isChatboxAPI(url)) {
          init = {
            ...init,
            headers: {
              ...init?.headers,
              'CHATBOX-PLATFORM': platformInfo.platform,
              'CHATBOX-PLATFORM-TYPE': platformInfo.type,
              'CHATBOX-OS': platformInfo.os,
              'CHATBOX-VERSION': platformInfo.version,
            },
          }
        }
        const res = await fetch(url, init)
        // 状态码不在 200～299 之间，一般是接口报错了，这里也需要抛错后重试
        if (!res.ok) {
          const response = await res.text().catch((e) => '')
          if (options.parseChatboxRemoteError) {
            const errorCodeName = parseJsonOrEmpty(response)?.error?.code
            const chatboxAIError = ChatboxAIAPIError.fromCodeName(response, errorCodeName)
            if (chatboxAIError) {
              throw chatboxAIError
            }
          }
          throw new ApiError(`Status Code ${res.status}, ${response}`)
        }
        return res
      } catch (e) {
        if (e instanceof BaseError) {
          requestError = e
        } else {
          const err = e as Error
          let origin: string
          if (url instanceof Request) {
            origin = new URL(url.url).origin
          } else {
            origin = new URL(url).origin
          }
          requestError = new NetworkError(err.message, origin)
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    if (requestError) {
      throw requestError
    } else {
      throw new Error('Unknown error')
    }
  }
}

export async function uploadFile(file: File, url: string) {
  // COS 需要使用原始的 XMLHttpRequest（根据官网示例）
  // 如果使用 fetch，会导致上传的 excel、docx 格式不正确
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.upload.onprogress = () => {
      // do nothing
    }
    xhr.onload = () => {
      if (/^2\d\d$/.test(`${xhr.status}`)) {
        const ETag = xhr.getResponseHeader('etag')
        resolve({ url: url, ETag: ETag })
      } else {
        const error = new NetworkError(`XMLHttpRequest failed, status code ${xhr.status}`, '')
        reject(error)
      }
    }
    xhr.onerror = () => {
      const error = new NetworkError(`XMLHttpRequest failed, status code ${xhr.status}`, '')
      reject(error)
    }
    xhr.send(file)
  })
}

interface AuthTokens {
  accessToken: string
  refreshToken: string
}

interface AuthenticatedAfetchConfig {
  platformInfo: PlatformInfo
  getTokens: () => Promise<AuthTokens | null>
  refreshTokens: (refreshToken: string) => Promise<AuthTokens>
  clearTokens: () => Promise<void>
}

export function createAuthenticatedAfetch(config: AuthenticatedAfetchConfig) {
  const { platformInfo, getTokens, refreshTokens, clearTokens } = config

  // 用于防止并发刷新 token
  let refreshPromise: Promise<AuthTokens> | null = null

  return async function authenticatedAfetch(
    url: RequestInfo | URL,
    init?: RequestInit,
    options: {
      retry?: number
      parseChatboxRemoteError?: boolean
    } = {}
  ) {
    // 获取当前 tokens
    const tokens = await getTokens()
    if (!tokens) {
      throw new ApiError('No authentication tokens available')
    }

    // 构建包含 token 的 headers 的辅助函数
    function buildHeaders(accessToken: string) {
      const authHeaders: Record<string, string> = {
        'x-chatbox-access-token': accessToken,
      }

      if (isChatboxAPI(url)) {
        authHeaders['CHATBOX-PLATFORM'] = platformInfo.platform
        authHeaders['CHATBOX-PLATFORM-TYPE'] = platformInfo.type
        authHeaders['CHATBOX-OS'] = platformInfo.os
        authHeaders['CHATBOX-VERSION'] = platformInfo.version
      }

      return {
        ...init?.headers,
        ...authHeaders,
      }
    }

    // 添加 access token 到 headers
    init = {
      ...init,
      headers: buildHeaders(tokens.accessToken),
    }

    let requestError: BaseError | null = null
    const retry = options.retry || 0

    for (let i = 0; i < retry + 1; i++) {
      try {
        const res = await fetch(url, init)

        // 检查 401 Unauthorized
        if (res.status === 401) {
          console.log('🔄 Access token expired, refreshing...')

          // 防止并发刷新：如果已有刷新请求，等待它完成
          if (!refreshPromise) {
            refreshPromise = (async () => {
              try {
                const currentTokens = await getTokens()
                if (!currentTokens) {
                  throw new ApiError('No refresh token available')
                }

                console.log('🔑 Refreshing access token with refresh token...')
                const newTokens = await refreshTokens(currentTokens.refreshToken)
                console.log('✅ Token refreshed successfully')
                return newTokens
              } catch (error) {
                console.error('❌ Failed to refresh token:', error)
                // 刷新失败，清除所有 tokens
                await clearTokens()
                throw new ApiError('Token refresh failed, please login again')
              } finally {
                refreshPromise = null
              }
            })()
          }

          // 等待刷新完成
          const newTokens = await refreshPromise

          // 使用新 token 重试请求
          init = {
            ...init,
            headers: buildHeaders(newTokens.accessToken),
          }

          console.log('🔄 Retrying request with new token...')
          const retryRes = await fetch(url, init)

          if (!retryRes.ok) {
            const response = await retryRes.text().catch(() => '')
            if (options.parseChatboxRemoteError) {
              const errorCodeName = parseJsonOrEmpty(response)?.error?.code
              const chatboxAIError = ChatboxAIAPIError.fromCodeName(response, errorCodeName)
              if (chatboxAIError) {
                throw chatboxAIError
              }
            }
            throw new ApiError(`Status Code ${retryRes.status}, ${response}`)
          }

          return retryRes
        }

        // 其他错误状态码
        if (!res.ok) {
          const response = await res.text().catch(() => '')
          if (options.parseChatboxRemoteError) {
            const errorCodeName = parseJsonOrEmpty(response)?.error?.code
            const chatboxAIError = ChatboxAIAPIError.fromCodeName(response, errorCodeName)
            if (chatboxAIError) {
              throw chatboxAIError
            }
          }
          throw new ApiError(`Status Code ${res.status}, ${response}`)
        }

        return res
      } catch (e) {
        if (e instanceof BaseError) {
          requestError = e
        } else {
          const err = e as Error
          let origin: string
          if (url instanceof Request) {
            origin = new URL(url.url).origin
          } else {
            origin = new URL(url).origin
          }
          requestError = new NetworkError(err.message, origin)
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    if (requestError) {
      throw requestError
    } else {
      throw new Error('Unknown error')
    }
  }
}
