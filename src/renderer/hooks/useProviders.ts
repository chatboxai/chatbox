import { useCallback, useMemo } from 'react'
import { SystemProviders } from 'src/shared/defaults'
import { ModelProviderEnum, ProviderInfo } from 'src/shared/types'
import useChatboxAIModels from './useChatboxAIModels'
import { useSettings } from './useSettings'

export const useProviders = () => {
  const { chatboxAIModels } = useChatboxAIModels()
  const { settings, setSettings } = useSettings()
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
            (!p.isCustom && providerSettings?.apiKey) ||
            ((p.isCustom || p.id === ModelProviderEnum.Ollama || p.id === ModelProviderEnum.LMStudio) &&
              providerSettings?.models?.length)
          ) {
            return {
              ...p,
              ...providerSettings,
            } as ProviderInfo
          } else {
            return null
          }
        })
        .filter((p) => !!p),
    [providerSettingsMap, allProviderBaseInfos, chatboxAIModels]
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
    [settings]
  )

  const unfavoriteModel = useCallback(
    (provider: string, model: string) => {
      setSettings({
        favoritedModels: (settings.favoritedModels || []).filter((m) => m.provider !== provider || m.model !== model),
      })
    },
    [settings]
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
