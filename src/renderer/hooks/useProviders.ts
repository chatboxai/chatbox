import { SystemProviders } from '@shared/defaults'
import { ModelProviderEnum, type ProviderInfo } from '@shared/types'
import { useCallback, useMemo } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'

export const useProviders = () => {
  const setSettings = useSettingsStore((state) => state.setSettings)
  const providerSettingsMap = useSettingsStore((state) => state.providers)
  const customProviders = useSettingsStore((state) => state.customProviders)
  const favoritedModelsSettings = useSettingsStore((state) => state.favoritedModels)

  const allProviderBaseInfos = useMemo(() => [...SystemProviders(), ...(customProviders || [])], [customProviders])
  const providers = useMemo(
    () =>
      allProviderBaseInfos
        .map((p) => {
          const providerSettings = providerSettingsMap?.[p.id]
          if (
            (!p.isCustom && providerSettings?.apiKey) ||
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
    [providerSettingsMap, allProviderBaseInfos]
  )

  const favoritedModels = useMemo(
    () =>
      favoritedModelsSettings
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
    [favoritedModelsSettings, providers]
  )

  const favoriteModel = useCallback(
    (provider: string, model: string) => {
      setSettings({
        favoritedModels: [
          ...(favoritedModelsSettings || []),
          {
            provider,
            model,
          },
        ],
      })
    },
    [favoritedModelsSettings, setSettings]
  )

  const unfavoriteModel = useCallback(
    (provider: string, model: string) => {
      setSettings({
        favoritedModels: (favoritedModelsSettings || []).filter((m) => m.provider !== provider || m.model !== model),
      })
    },
    [favoritedModelsSettings, setSettings]
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
