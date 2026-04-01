import { SystemProviders } from '@shared/defaults'
import { isUsingOAuth, mergeSharedOAuthProviderSettings } from '@shared/oauth'
import { ModelProviderEnum, type ProviderInfo } from '@shared/types'
import { useCallback, useMemo } from 'react'
import { enrichModelsFromRegistry, useModelRegistryVersion } from '@/packages/model-registry'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'
import useChatboxAIModels from './useChatboxAIModels'

export const useProviders = () => {
  useModelRegistryVersion()

  const { chatboxAIModels } = useChatboxAIModels()
  const { setSettings, ...settings } = useSettingsStore((state) => state)
  const providerSettingsMap = settings.providers

  const allProviderBaseInfos = useMemo(
    () => [...SystemProviders(), ...(settings.customProviders || [])],
    [settings.customProviders]
  )
  const providers = useMemo(
    () =>
      allProviderBaseInfos
        .map((p) => {
          const providerSettings = mergeSharedOAuthProviderSettings(p.id, providerSettingsMap)
          if (p.id === ModelProviderEnum.ChatboxAI && settings.licenseKey) {
            return {
              ...p,
              ...providerSettings,
              models: chatboxAIModels,
            }
          } else if (
            (!p.isCustom && (providerSettings?.apiKey || isUsingOAuth(providerSettings || {}, platform.type))) ||
            ((p.isCustom || p.id === ModelProviderEnum.Ollama || p.id === ModelProviderEnum.LMStudio) &&
              providerSettings?.models?.length)
          ) {
            const baseModels = providerSettings?.models || p.defaultSettings?.models || []
            return {
              ...p,
              ...providerSettings,
              // 如果没有自定义 models 列表，使用 defaultSettings，否则被自定义的列表（可能有添加或删除部分 model）覆盖, 不能包含用户排除过的 models
              models: enrichModelsFromRegistry(baseModels, p.id),
            } as ProviderInfo
          } else {
            return null
          }
        })
        .filter((p) => !!p),
    [providerSettingsMap, allProviderBaseInfos, chatboxAIModels, settings.licenseKey]
  )

  const favoritedModels = useMemo(
    () =>
      settings.favoritedModels
        ?.map((m) => {
          const provider = providers.find((p) => p.id === m.provider)
          const model = (provider?.models || provider?.defaultSettings?.models)?.find((mm) => mm.modelId === m.model)

          if (provider && model) {
            return {
              provider,
              model,
            }
          }
        })
        .filter((fm) => !!fm),
    [settings.favoritedModels, providers]
  )

  const favoriteModel = useCallback(
    (provider: string, model: string) => {
      setSettings({
        favoritedModels: [
          ...(settings.favoritedModels || []),
          {
            provider,
            model,
          },
        ],
      })
    },
    [settings, setSettings]
  )

  const unfavoriteModel = useCallback(
    (provider: string, model: string) => {
      setSettings({
        favoritedModels: (settings.favoritedModels || []).filter((m) => m.provider !== provider || m.model !== model),
      })
    },
    [settings, setSettings]
  )

  const isFavoritedModel = useCallback(
    (provider: string, model: string) =>
      !!favoritedModels?.find((m) => m.provider?.id === provider && m.model?.modelId === model),
    [favoritedModels]
  )

  return {
    providers,
    favoritedModels,
    favoriteModel,
    unfavoriteModel,
    isFavoritedModel,
  }
}
