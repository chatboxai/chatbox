import { useCallback, useMemo } from 'react'
import { SystemProviders } from 'src/shared/defaults'
import { ModelProviderEnum, type ProviderInfo } from 'src/shared/types'
import { useSettingsStore } from '@/stores/settingsStore'
import useChatboxAIModels from './useChatboxAIModels'

export const useProviders = () => {
  const { chatboxAIModels } = useChatboxAIModels()
  const { setSettings, ...settings } = useSettingsStore((state) => state)
  const providerSettingsMap = settings.providers

  const allProviderBaseInfos = useMemo(
    () => [...SystemProviders, ...(settings.customProviders || [])],
    [settings.customProviders]
  )
  const providers = useMemo(
    () =>
      allProviderBaseInfos
        .map((p) => {
          const providerSettings = providerSettingsMap?.[p.id]
          if (p.id === ModelProviderEnum.ChatboxAI && settings.licenseKey) {
            return {
              ...p,
              ...providerSettings,
              models: chatboxAIModels,
            }
          } else if (
            // For Bedrock, check AWS credentials instead of apiKey
            (p.id === ModelProviderEnum.Bedrock &&
              providerSettings?.awsAccessKeyId &&
              providerSettings?.awsSecretAccessKey) ||
            // For other non-custom providers, check apiKey
            (!p.isCustom && p.id !== ModelProviderEnum.Bedrock && providerSettings?.apiKey) ||
            // For custom providers, Ollama, and LMStudio, check models list
            ((p.isCustom || p.id === ModelProviderEnum.Ollama || p.id === ModelProviderEnum.LMStudio) &&
              providerSettings?.models?.length)
          ) {
            return {
              // 如果没有自定义 models 列表，使用 defaultSettings，否则被自定义的列表（可能有添加或删除部分 model）覆盖, 不能包含用户排除过的 models
              models: p.defaultSettings?.models,
              ...p,
              ...providerSettings,
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
