import { isUsingOAuth, mergeSharedOAuthProviderSettings } from '@shared/oauth'
import type { PlatformType } from '@shared/platform'
import { getRatioOptionsForModel } from '@shared/providers/definitions/image-models'
import {
  type ImageGenerationModel,
  type ImageModelCapabilities,
  ModelProviderEnum,
  ModelProviderType,
  type ProviderModelInfo,
  type Settings,
} from '@shared/types'
import { z } from 'zod'

export interface ImageModelOption {
  modelId: string
  displayName: string
  description?: string
  capabilities?: ImageModelCapabilities
}

const imageModelManifestResponseSchema = z.object({
  data: z.object({
    imageModels: z
      .array(z.object({ modelId: z.string(), modelName: z.string().optional(), description: z.string().optional() }))
      .optional()
      .default([]),
  }),
})

export function parseImageModelManifestResponse(payload: unknown): ImageModelOption[] {
  return imageModelManifestResponseSchema.parse(payload).data.imageModels.map((model) => ({
    modelId: model.modelId,
    displayName: model.modelName || model.modelId,
    ...(model.description ? { description: model.description } : {}),
  }))
}

export interface ImageModelProvider {
  id: string
  name: string
  isCustom?: boolean
  type?: ModelProviderType
}

export interface ImageModelGroup {
  label: string
  providerId: string
  isCustom?: boolean
  models: ImageModelOption[]
}

export type RemoteImageModels = Partial<Record<ModelProviderEnum, readonly ImageModelOption[]>>

export function manualImageModelToOption(model: ProviderModelInfo & { description?: string }): ImageModelOption {
  return {
    modelId: model.modelId,
    displayName: model.nickname || model.modelId,
    ...(model.description ? { description: model.description } : {}),
  }
}

export function mergeImageModels(
  remoteModels: readonly ImageModelOption[],
  manualModels: readonly ImageModelOption[]
): ImageModelOption[] {
  const modelsById = new Map<string, ImageModelOption>()
  for (const model of remoteModels) modelsById.set(model.modelId, model)
  for (const model of manualModels) {
    modelsById.set(model.modelId, { ...modelsById.get(model.modelId), ...model })
  }
  return [...modelsById.values()]
}

export function isOpenAIImageGenerationAuthSupported(
  providers: Settings['providers'],
  platform: PlatformType
): boolean {
  return !isUsingOAuth(mergeSharedOAuthProviderSettings(ModelProviderEnum.OpenAI, providers), platform)
}

/** Image catalogs require provider authentication, even when a built-in model is configured manually. */
export function getConfiguredImageProviders(
  providers: readonly ImageModelProvider[],
  settings: Settings,
  platform: PlatformType
): ImageModelProvider[] {
  return providers.filter((provider) => {
    if (provider.isCustom) return Boolean(settings.providers?.[provider.id]?.models?.length)
    if (provider.id === ModelProviderEnum.ChatboxAI) return Boolean(settings.licenseKey)
    if (
      ![ModelProviderEnum.OpenAI, ModelProviderEnum.Gemini, ModelProviderEnum.OpenRouter].includes(
        provider.id as ModelProviderEnum
      )
    )
      return false
    const configured = mergeSharedOAuthProviderSettings(provider.id, settings.providers)
    return Boolean(configured.apiKey || isUsingOAuth(configured, platform))
  })
}

/** Shared Web/native projection; manual names override remote labels without discarding capabilities. */
export function buildImageModelGroups(options: {
  providers: readonly ImageModelProvider[]
  settings: Pick<Settings, 'providers'>
  platform: PlatformType
  remoteModels: RemoteImageModels
}): ImageModelGroup[] {
  const { providers, settings, platform, remoteModels } = options
  const groups: ImageModelGroup[] = []
  const builtin = (id: ModelProviderEnum) => providers.find((provider) => provider.id === id && !provider.isCustom)
  const add = (provider: ImageModelProvider | undefined, remote: readonly ImageModelOption[] = [], manual = true) => {
    if (!provider) return
    const manualModels = manual
      ? (settings.providers?.[provider.id]?.models ?? [])
          .filter((model) => model.type === 'image')
          .map(manualImageModelToOption)
      : []
    let models = mergeImageModels(remote, manualModels)
    if (provider.id === ModelProviderEnum.ChatboxAI) {
      const excluded = new Set(settings.providers?.[provider.id]?.excludedModels ?? [])
      models = models.filter((model) => !excluded.has(model.modelId))
    }
    if (models.length)
      groups.push({
        label: provider.name,
        providerId: provider.id,
        ...(provider.isCustom ? { isCustom: true } : {}),
        models,
      })
  }
  add(builtin(ModelProviderEnum.ChatboxAI), remoteModels[ModelProviderEnum.ChatboxAI], false)
  add(builtin(ModelProviderEnum.Gemini), remoteModels[ModelProviderEnum.Gemini])
  for (const provider of providers.filter(
    (provider) => provider.isCustom && provider.type === ModelProviderType.Gemini
  )) {
    add(provider, remoteModels[ModelProviderEnum.Gemini])
  }
  if (isOpenAIImageGenerationAuthSupported(settings.providers, platform)) {
    add(builtin(ModelProviderEnum.OpenAI), remoteModels[ModelProviderEnum.OpenAI])
  }
  add(builtin(ModelProviderEnum.OpenRouter), remoteModels[ModelProviderEnum.OpenRouter])
  for (const provider of providers.filter(
    (provider) =>
      provider.isCustom &&
      (provider.type === ModelProviderType.OpenAI ||
        provider.type === ModelProviderType.OpenAIResponses ||
        provider.type === undefined)
  )) {
    add(provider)
  }
  return groups
}

export function getImageModelRatioOptions(modelId: string, capabilities?: ImageModelCapabilities): string[] {
  return capabilities
    ? [...new Set(['auto', ...(capabilities.aspectRatio?.values ?? [])])]
    : getRatioOptionsForModel(modelId)
}

export function resolveImageRatioSelection(selectedRatio: string, ratioOptions: readonly string[]): string {
  return ratioOptions.includes(selectedRatio) ? selectedRatio : 'auto'
}

export function resolveImageModelSelection(
  modelGroups: readonly ImageModelGroup[],
  selectedProvider: string,
  selectedModel: string
): { provider: string; model: string } | null {
  if (
    modelGroups
      .find((group) => group.providerId === selectedProvider)
      ?.models.some((model) => model.modelId === selectedModel)
  ) {
    return { provider: selectedProvider, model: selectedModel }
  }
  const group = modelGroups.find((group) => group.models.length)
  const model = group?.models[0]
  return group && model ? { provider: group.providerId, model: model.modelId } : null
}

/** Only providers with an implemented reference-image request protocol can expose the upload action. */
export function supportsImageReferenceInput(
  model: ImageGenerationModel,
  capabilities?: ImageModelCapabilities
): boolean {
  if (model.provider === ModelProviderEnum.ChatboxAI) {
    return (
      capabilities === undefined || (capabilities.inputReferences !== null && capabilities.inputReferences.max !== 0)
    )
  }
  return (
    model.provider === ModelProviderEnum.OpenRouter &&
    Boolean(capabilities?.inputReferences) &&
    capabilities?.inputReferences?.max !== 0
  )
}
