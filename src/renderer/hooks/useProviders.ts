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
  const setSettings = useSettingsStore((state) => state.setSettings)
  const customProviders = useSettingsStore((state) => state.customProviders)
  const favoritedModelsSetting = useSettingsStore((state) => state.favoritedModels)
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const providerSettingsMap = useSettingsStore((state) => state.providers)

  const allProviderBaseInfos = useMemo(() => [...SystemProviders(), ...(customProviders || [])], [customProviders])
  const providers = useMemo(
    () =>
      allProviderBaseInfos
        .map((p) => {
          const providerSettings = mergeSharedOAuthProviderSettings(p.id, providerSettingsMap)
          if (p.id === ModelProviderEnum.ChatboxAI && licenseKey) {
            return {
              ...p,
              ...providerSettings,
              models: chatboxAIModels,
            }
          } else if (
            (!p.isCustom &&
              (providerSettings?.apiKey ||
                isUsingOAuth(providerSettings || {}, platform.type) ||
                (p.id === ModelProviderEnum.Bedrock && providerSettings?.accessKey && providerSettings?.secretKey))) ||
            ((p.isCustom || p.id === ModelProviderEnum.Ollama ||
              p.id === ModelProviderEnum.LMStudio ||
              p.id === ModelProviderEnum.Llmman) &&
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
    [providerSettingsMap, allProviderBaseInfos, chatboxAIModels, licenseKey]
  )

  const favoritedModels = useMemo(
    () =>
      favoritedModelsSetting
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
    [favoritedModelsSetting, providers]
  )

  const favoriteModel = useCallback(
    (provider: string, model: string) => {
      setSettings({
        favoritedModels: [
          ...(favoritedModelsSetting || []),
          {
            provider,
            model,
          },
        ],
      })
    },
    [favoritedModelsSetting, setSettings]
  )

  const unfavoriteModel = useCallback(
    (provider: string, model: string) => {
      setSettings({
        favoritedModels: (favoritedModelsSetting || []).filter((m) => m.provider !== provider || m.model !== model),
      })
    },
    [favoritedModelsSetting, setSettings]
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
