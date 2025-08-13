import uniq from 'lodash/uniq'
import { ofetch } from 'ofetch'
import { cache } from '../utils/cache'

let API_ORIGIN = 'https://api.chatboxai.app'

let POOL = [
  'https://api.chatboxai.app',
  'https://chatboxai.app',
  'https://api.ai-chatbox.com',
  'https://api.chatboxapp.xyz',
]

export function isChatboxAPI(input: RequestInfo | URL) {
  const url = typeof input === 'string' ? input : (input as Request).url ?? input.toString()
  return POOL.some((o) => url.startsWith(o)) || url.startsWith(API_ORIGIN)
}

export function getChatboxAPIOrigin() {
  if (process.env.USE_LOCAL_API) {
    return 'http://localhost:8002'
  }
  return API_ORIGIN
}

/**
 * 按顺序测试 API 的可用性，只要有一个 API 域名可用，就终止测试并切换所有流量到该域名。
 * 在测试过程中，会根据服务器返回添加新的 API 域名，并缓存到本地
 */
export async function testApiOrigins() {
  // 按顺序测试 API 的可用性
  const result = await cache(
    'api_origins',
    async () => {
      let i = 0
      let pool = POOL
      while (i < pool.length) {
        try {
          const origin: string = pool[i]
          const controller = new AbortController()
          setTimeout(() => controller.abort(), 2000) // 2秒超时
          const res = await ofetch<{ data: { api_origins: string[] } }>(`${origin}/api/api_origins`, {
            signal: controller.signal,
            retry: 1,
          })
          // 如果服务器返回了新的 API 域名，则更新缓存
          if (res.data.api_origins.length > 0) {
            pool = uniq([...pool, ...res.data.api_origins])
          }
          // 如果当前 API 可用，则切换所有流量到该域名
          API_ORIGIN = origin
          pool = uniq([origin, ...pool]) // 将当前 API 域名添加到列表顶部
          POOL = pool
          return pool
        } catch (e) {
          i++
        }
      }
      return POOL
    },
    { ttl: 1000 * 60 * 60, refreshFallbackToCache: true } // 1小时缓存，失败时使用旧缓存
  )

  return result
}
