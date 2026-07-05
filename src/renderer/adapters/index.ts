import { getModel } from '@shared/models'
import type { ModelInterface } from '@shared/models/types'
import { type OAuthCredentials, OAuthIpcChannels, toOAuthSettingsProviderId } from '@shared/oauth'
import { createAfetch } from '@shared/request/request'
import type { SessionSettings } from '@shared/types'
import type { ApiRequestOptions, ModelDependencies } from '@shared/types/adapters'
import { getOS } from '@/packages/navigator'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as settingActions from '@/stores/settingActions'
import { settingsStore } from '@/stores/settingsStore'
import { apiRequest } from '@/utils/request'
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
      async getImage(keyOrUrl: string): Promise<string> {
        // If it's a URL, return as-is
        if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
          return keyOrUrl
        }
        // Otherwise read from local storage
        const blob = await storage.getBlob(keyOrUrl)
        if (!blob) return ''
        return blob.startsWith('data:') ? blob : `data:image/png;base64,${blob}`
      },
    },
    request: {
      fetchWithOptions: async (
        url: string,
        init?: RequestInit,
        options?: { retry?: number; parseWorkspAIceRemoteError?: boolean }
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
    oauth:
      platform.type === 'desktop'
        ? {
            async refreshCredential(providerId: string, credential: OAuthCredentials): Promise<OAuthCredentials> {
              const resultJson: string = await (platform as any).ipc.invoke(
                OAuthIpcChannels.REFRESH,
                providerId,
                JSON.stringify(credential)
              )
              const result = JSON.parse(resultJson) as {
                success: boolean
                credentials?: OAuthCredentials
                error?: string
              }
              if (!result.success || !result.credentials) {
                throw new Error(result.error || `Failed to refresh OAuth credential for ${providerId}`)
              }
              return result.credentials
            },
            persistCredential(providerId: string, credential: OAuthCredentials): void {
              const settingsProviderId = toOAuthSettingsProviderId(providerId) || providerId
              settingsStore.setState((currentSettings) => ({
                providers: {
                  ...(currentSettings.providers || {}),
                  [settingsProviderId]: {
                    ...(currentSettings.providers?.[settingsProviderId] || {}),
                    oauth: credential,
                  },
                },
              }))
            },
            clearCredential(providerId: string): void {
              const settingsProviderId = toOAuthSettingsProviderId(providerId) || providerId
              settingsStore.setState((currentSettings) => {
                const currentProviderSettings = currentSettings.providers?.[settingsProviderId] || {}
                return {
                  providers: {
                    ...(currentSettings.providers || {}),
                    [settingsProviderId]: {
                      ...currentProviderSettings,
                      oauth: undefined,
                    },
                  },
                }
              })
            },
          }
        : undefined,
    platformType: platform.type,
  }
}

export async function createModel(
  settings: SessionSettings,
  dependencies?: ModelDependencies
): Promise<ModelInterface> {
  const globalSettings = settingsStore.getState().getSettings()
  const configs = await platform.getConfig()
  const modelDependencies = dependencies ?? (await createModelDependencies())
  return getModel(settings, globalSettings, configs, modelDependencies)
}
