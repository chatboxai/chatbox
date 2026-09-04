import { ModelProviderEnum, ModelProviderType } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  type ImageModelOption,
  isOpenAIImageGenerationAuthSupported,
  loadProviderImageModels,
  manualImageModelToOption,
  mergeImageModels,
} from '@/packages/image-model-catalog'
import { useLanguage, useSettingsStore } from '@/stores/settingsStore'
import useChatboxAIModels from './useChatboxAIModels'
import { useProviders } from './useProviders'

export interface ImageModelGroup {
  label: string
  providerId: string
  isCustom?: boolean
  models: ImageModelOption[]
}

export function useProviderImageModels(provider: ModelProviderEnum, enabled: boolean): ImageModelOption[] {
  const language = useLanguage()
  const licenseKey = useSettingsStore((state) => state.licenseKey)

  const { data } = useQuery({
    queryKey: [
      'provider-image-models',
      provider,
      language,
      provider === ModelProviderEnum.ChatboxAI ? licenseKey || '' : '',
    ],
    enabled,
    staleTime: 3600 * 1000,
    queryFn: () =>
      loadProviderImageModels(provider, {
        language,
        licenseKey,
      }),
  })

  return data || []
}

export function useImageModelGroups(): ImageModelGroup[] {
  const { providers } = useProviders()
  const { chatboxAIImageModels } = useChatboxAIModels()
  const providerSettingsMap = useSettingsStore((state) => state.providers)

  const chatboxProvider = providers.find((p) => p.id === ModelProviderEnum.ChatboxAI)
  const openAIProvider = providers.find((p) => p.id === ModelProviderEnum.OpenAI)
  const openRouterProvider = providers.find((p) => p.id === ModelProviderEnum.OpenRouter)
  const geminiProvider = providers.find((p) => p.id === ModelProviderEnum.Gemini)
  const customGeminiProviders = providers.filter((p) => p.isCustom && p.type === ModelProviderType.Gemini)
  const customOpenAICompatibleProviders = providers.filter(
    (p) =>
      p.isCustom &&
      (p.type === ModelProviderType.OpenAI || p.type === ModelProviderType.OpenAIResponses || p.type === undefined)
  )

  const openAIImageModels = useProviderImageModels(ModelProviderEnum.OpenAI, !!openAIProvider)
  const openRouterImageModels = useProviderImageModels(ModelProviderEnum.OpenRouter, !!openRouterProvider)
  const geminiImageModels = useProviderImageModels(
    ModelProviderEnum.Gemini,
    !!geminiProvider || customGeminiProviders.length > 0
  )

  return useMemo(() => {
    const groups: ImageModelGroup[] = []
    if (chatboxProvider) {
      const excluded = new Set(providerSettingsMap?.[ModelProviderEnum.ChatboxAI]?.excludedModels || [])
      const models = chatboxAIImageModels.map(manualImageModelToOption).filter((model) => !excluded.has(model.modelId))
      if (models.length > 0) {
        groups.push({
          label: chatboxProvider.name,
          providerId: chatboxProvider.id,
          models,
        })
      }
    }

    if (geminiProvider) {
      const manualModels = (providerSettingsMap?.[geminiProvider.id]?.models || [])
        .filter((model) => model.type === 'image')
        .map(manualImageModelToOption)
      const models = mergeImageModels(geminiImageModels, manualModels)
      if (models.length > 0) {
        groups.push({
          label: geminiProvider.name,
          providerId: geminiProvider.id,
          models,
        })
      }
    }

    for (const provider of customGeminiProviders) {
      const manualModels = (providerSettingsMap?.[provider.id]?.models || [])
        .filter((model) => model.type === 'image')
        .map(manualImageModelToOption)
      const models = mergeImageModels(geminiImageModels, manualModels)
      if (models.length > 0) {
        groups.push({
          label: provider.name,
          providerId: provider.id,
          isCustom: true,
          models,
        })
      }
    }

    if (openAIProvider && isOpenAIImageGenerationAuthSupported(providerSettingsMap)) {
      const manualModels = (providerSettingsMap?.[openAIProvider.id]?.models || [])
        .filter((model) => model.type === 'image')
        .map(manualImageModelToOption)
      const models = mergeImageModels(openAIImageModels, manualModels)
      if (models.length > 0) {
        groups.push({
          label: openAIProvider.name,
          providerId: openAIProvider.id,
          models,
        })
      }
    }

    if (openRouterProvider) {
      const manualModels = (providerSettingsMap?.[openRouterProvider.id]?.models || [])
        .filter((model) => model.type === 'image')
        .map(manualImageModelToOption)
      const models = mergeImageModels(openRouterImageModels, manualModels)
      if (models.length > 0) {
        groups.push({
          label: openRouterProvider.name,
          providerId: openRouterProvider.id,
          models,
        })
      }
    }

    for (const provider of customOpenAICompatibleProviders) {
      const models = (providerSettingsMap?.[provider.id]?.models || [])
        .filter((model) => model.type === 'image')
        .map(manualImageModelToOption)
      if (models.length > 0) {
        groups.push({
          label: provider.name,
          providerId: provider.id,
          isCustom: true,
          models,
        })
      }
    }

    return groups
  }, [
    chatboxProvider,
    openAIProvider,
    openRouterProvider,
    geminiProvider,
    customGeminiProviders,
    customOpenAICompatibleProviders,
    providerSettingsMap,
    chatboxAIImageModels,
    openAIImageModels,
    openRouterImageModels,
    geminiImageModels,
  ])
}
