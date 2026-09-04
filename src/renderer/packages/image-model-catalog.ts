import { isUsingOAuth, mergeSharedOAuthProviderSettings } from '@shared/oauth'
import { ModelProviderEnum, ModelProviderType, type ProviderModelInfo, type Settings } from '@shared/types'
import { getLogger } from '@/lib/utils'
import { getModelManifest, type RemoteModelInfo } from '@/packages/remote'
import platform from '@/platform'
import type { PlatformType } from '@/platform/interfaces'
import { settingsStore } from '@/stores/settingsStore'

const log = getLogger('image-model-catalog')

export interface ImageModelOption {
  modelId: string
  displayName: string
}

export interface AvailableImageModel {
  provider: string
  modelId: string
  nickname: string
}

export function remoteImageModelToOption(model: RemoteModelInfo): ImageModelOption {
  return {
    modelId: model.modelId,
    displayName: model.modelName || model.modelId,
  }
}

export function manualImageModelToOption(model: ProviderModelInfo): ImageModelOption {
  return {
    modelId: model.modelId,
    displayName: model.nickname || model.modelId,
  }
}

export function mergeImageModels(
  remoteModels: ImageModelOption[],
  manualModels: ImageModelOption[]
): ImageModelOption[] {
  const modelsById = new Map<string, ImageModelOption>()
  for (const model of remoteModels) modelsById.set(model.modelId, model)
  for (const model of manualModels) {
    modelsById.set(model.modelId, {
      ...modelsById.get(model.modelId),
      ...model,
    })
  }
  return [...modelsById.values()]
}

export async function loadProviderImageModels(
  provider: ModelProviderEnum,
  options: { licenseKey?: string; language?: string } = {}
): Promise<ImageModelOption[]> {
  const manifest = await getModelManifest({
    aiProvider: provider,
    language: options.language,
    licenseKey: provider === ModelProviderEnum.ChatboxAI ? options.licenseKey : undefined,
  })
  return manifest.imageModels.map(remoteImageModelToOption)
}

function isBuiltinProviderConfigured(provider: ModelProviderEnum, settings: Settings): boolean {
  const providerSettings = mergeSharedOAuthProviderSettings(provider, settings.providers)
  return !!providerSettings.apiKey || isUsingOAuth(providerSettings, platform.type)
}

export function isOpenAIImageGenerationAuthSupported(
  providers: Settings['providers'],
  platformType: PlatformType = platform.type
): boolean {
  const providerSettings = mergeSharedOAuthProviderSettings(ModelProviderEnum.OpenAI, providers)
  return !isUsingOAuth(providerSettings, platformType)
}

function manualImageModels(settings: Settings, provider: string): ImageModelOption[] {
  return (settings.providers?.[provider]?.models ?? [])
    .filter((model) => model.type === 'image')
    .map(manualImageModelToOption)
}

async function loadRemoteModels(provider: ModelProviderEnum, settings: Settings): Promise<ImageModelOption[]> {
  try {
    return await loadProviderImageModels(provider, {
      language: settings.language,
      licenseKey: settings.licenseKey,
    })
  } catch (error) {
    log.error(`Failed to load image model manifest for ${provider}:`, error)
    return []
  }
}

function catalogEntries(provider: string, models: ImageModelOption[]): AvailableImageModel[] {
  return models.map((model) => ({
    provider,
    modelId: model.modelId,
    nickname: model.displayName,
  }))
}

/**
 * Builds the non-React image model catalog used by the image creator UI.
 * Remote manifest models and manually configured models follow the same merge
 * and provider-visibility rules as useImageModelGroups().
 */
export async function getAvailableImageModels(
  settings: Settings = settingsStore.getState()
): Promise<AvailableImageModel[]> {
  const catalog: AvailableImageModel[] = []

  if (settings.licenseKey) {
    const excluded = new Set(settings.providers?.[ModelProviderEnum.ChatboxAI]?.excludedModels ?? [])
    const chatboxModels = (await loadRemoteModels(ModelProviderEnum.ChatboxAI, settings)).filter(
      (model) => !excluded.has(model.modelId)
    )
    catalog.push(...catalogEntries(ModelProviderEnum.ChatboxAI, chatboxModels))
  }

  const geminiConfigured = isBuiltinProviderConfigured(ModelProviderEnum.Gemini, settings)
  const customGeminiProviders = (settings.customProviders ?? []).filter(
    (provider) =>
      provider.isCustom &&
      provider.type === ModelProviderType.Gemini &&
      (settings.providers?.[provider.id]?.models?.length ?? 0) > 0
  )
  if (geminiConfigured || customGeminiProviders.length > 0) {
    const remoteModels = await loadRemoteModels(ModelProviderEnum.Gemini, settings)
    if (geminiConfigured) {
      catalog.push(
        ...catalogEntries(
          ModelProviderEnum.Gemini,
          mergeImageModels(remoteModels, manualImageModels(settings, ModelProviderEnum.Gemini))
        )
      )
    }
    for (const provider of customGeminiProviders) {
      catalog.push(
        ...catalogEntries(provider.id, mergeImageModels(remoteModels, manualImageModels(settings, provider.id)))
      )
    }
  }

  if (
    isBuiltinProviderConfigured(ModelProviderEnum.OpenAI, settings) &&
    isOpenAIImageGenerationAuthSupported(settings.providers)
  ) {
    const remoteModels = await loadRemoteModels(ModelProviderEnum.OpenAI, settings)
    catalog.push(
      ...catalogEntries(
        ModelProviderEnum.OpenAI,
        mergeImageModels(remoteModels, manualImageModels(settings, ModelProviderEnum.OpenAI))
      )
    )
  }

  if (isBuiltinProviderConfigured(ModelProviderEnum.OpenRouter, settings)) {
    const remoteModels = await loadRemoteModels(ModelProviderEnum.OpenRouter, settings)
    catalog.push(
      ...catalogEntries(
        ModelProviderEnum.OpenRouter,
        mergeImageModels(remoteModels, manualImageModels(settings, ModelProviderEnum.OpenRouter))
      )
    )
  }

  for (const provider of customOpenAICompatibleImageProviders(settings)) {
    catalog.push(...catalogEntries(provider.id, manualImageModels(settings, provider.id)))
  }

  return catalog
}

function isOpenAICompatibleCustomProviderType(type: ModelProviderType | undefined) {
  return type === ModelProviderType.OpenAI || type === ModelProviderType.OpenAIResponses || type === undefined
}

function customOpenAICompatibleImageProviders(settings: Settings) {
  return (settings.customProviders ?? []).filter(
    (provider) =>
      provider.isCustom &&
      isOpenAICompatibleCustomProviderType(provider.type) &&
      manualImageModels(settings, provider.id).length > 0
  )
}
