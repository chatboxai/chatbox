import { buildImageModelGroups, type ImageModelGroup } from '@chatbox/core/application/image-generation'
import { ModelProviderEnum, ModelProviderType, type ProviderSettings } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  type ImageModelOption,
  manualImageModelToOption,
  providerImageModelsQueryOptions,
} from '@/packages/image-model-catalog'
import platform from '@/platform'
import { useLanguage, useSettingsStore } from '@/stores/settingsStore'
import useChatboxAIModels from './useChatboxAIModels'
import { useProviders } from './useProviders'

export type { ImageModelGroup } from '@chatbox/core/application/image-generation'

export function useProviderImageModels(
  provider: ModelProviderEnum,
  enabled: boolean,
  providerSettings?: ProviderSettings
): ImageModelOption[] {
  const language = useLanguage()
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const { data } = useQuery({
    ...providerImageModelsQueryOptions(provider, {
      apiKey: provider === ModelProviderEnum.OpenRouter ? providerSettings?.apiKey : undefined,
      language,
      licenseKey,
    }),
    enabled,
  })

  return data || []
}

export function useImageModelGroups(): ImageModelGroup[] {
  const { providers } = useProviders()
  const { chatboxAIImageModels } = useChatboxAIModels()
  const providerSettingsMap = useSettingsStore((state) => state.providers)

  const openAIProvider = providers.find((p) => p.id === ModelProviderEnum.OpenAI)
  const openRouterProvider = providers.find((p) => p.id === ModelProviderEnum.OpenRouter)
  const geminiProvider = providers.find((p) => p.id === ModelProviderEnum.Gemini)
  const customGeminiProviders = providers.filter((p) => p.isCustom && p.type === ModelProviderType.Gemini)
  const openAIImageModels = useProviderImageModels(ModelProviderEnum.OpenAI, !!openAIProvider)
  const openRouterImageModels = useProviderImageModels(
    ModelProviderEnum.OpenRouter,
    !!openRouterProvider,
    providerSettingsMap?.[ModelProviderEnum.OpenRouter]
  )
  const geminiImageModels = useProviderImageModels(
    ModelProviderEnum.Gemini,
    !!geminiProvider || customGeminiProviders.length > 0
  )

  return useMemo(
    () =>
      buildImageModelGroups({
        providers,
        settings: { providers: providerSettingsMap },
        platform: platform.type,
        remoteModels: {
          [ModelProviderEnum.ChatboxAI]: chatboxAIImageModels.map(manualImageModelToOption),
          [ModelProviderEnum.OpenAI]: openAIImageModels,
          [ModelProviderEnum.OpenRouter]: openRouterImageModels,
          [ModelProviderEnum.Gemini]: geminiImageModels,
        },
      }),
    [providers, providerSettingsMap, chatboxAIImageModels, openAIImageModels, openRouterImageModels, geminiImageModels]
  )
}
