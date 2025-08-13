import { createAfetch } from 'src/shared/request/request'
import type { ApiRequestOptions, ModelDependencies } from 'src/shared/types/adapters'
import { getOS } from '@/packages/navigator'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as settingActions from '@/stores/settingActions'
import { apiRequest } from '@/utils/request'
import { RendererSentryAdapter } from './sentry'

export async function createModelDependencies(): Promise<ModelDependencies> {
  // 获取平台信息
  const platformInfo = {
    type: platform.type,
    platform: await platform.getPlatform(),
    os: getOS(),
    version: (await platform.getVersion()) || 'unknown',
  }

  const afetch = createAfetch(platformInfo)

  return {
    storage: {
      async saveImage(folder: string, dataUrl: string): Promise<string> {
        const storageKey = StorageKeyGenerator.picture(folder)
        await storage.setBlob(storageKey, dataUrl)
        return storageKey
      },
      async getImage(storageKey: string): Promise<string> {
        const blob = await storage.getBlob(storageKey)
        return blob || ''
      },
    },
    request: {
      fetchWithOptions: async (
        url: string,
        init?: RequestInit,
        options?: { retry?: number; parseChatboxRemoteError?: boolean }
      ): Promise<Response> => {
        // 支持自定义选项的 fetch
        return afetch(url, init, options || {})
      },
      async apiRequest(options: ApiRequestOptions): Promise<Response> {
        if (options.method === 'POST') {
          return apiRequest.post(options.url, options.headers || {}, options.body, {
            signal: options.signal,
            retry: options.retry,
            useProxy: options.useProxy,
          })
        } else {
          return apiRequest.get(options.url, options.headers || {}, {
            signal: options.signal,
            retry: options.retry,
            useProxy: options.useProxy,
          })
        }
      },
    },
    sentry: new RendererSentryAdapter(),
    getRemoteConfig: settingActions.getRemoteConfig,
  }
}
