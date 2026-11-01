import { type ImageGenerationModel, ModelProviderEnum, type ProviderInfo } from '@shared/types'
import type { ImageModelGroup } from '@/hooks/useImageModelGroups'
import { HISTORY_IMAGE_MODEL_DISPLAY_NAMES } from './constants'

export interface ImageModelDisplayNameContext {
  imageModelGroups: ImageModelGroup[]
  providers: ProviderInfo[]
}

export function getImageModelDisplayName(
  model: ImageGenerationModel,
  { imageModelGroups, providers }: ImageModelDisplayNameContext
): string {
  const group = imageModelGroups.find((item) => item.providerId === model.provider)
  const imageModel = group?.models.find((item) => item.modelId === model.modelId)
  const provider = providers.find((item) => item.id === model.provider)
  const providerModels = provider?.models || provider?.defaultSettings?.models || []
  const providerModel = providerModels.find((item) => item.modelId === model.modelId)
  const modelName = imageModel?.displayName || providerModel?.nickname || model.modelId || 'Image'

  if (model.provider === ModelProviderEnum.ChatboxAI) {
    return modelName
  }
  const providerName = group?.label || provider?.name || model.provider
  return providerName ? `${providerName} - ${modelName}` : modelName
}

export function getHistoryImageModelDisplayName(
  model: ImageGenerationModel,
  context: ImageModelDisplayNameContext
): string {
  // The legacy table is keyed by the model ids those records shipped with, including an
  // empty one. Only a record that still names its provider can be matched against it.
  const legacyName = model.provider ? HISTORY_IMAGE_MODEL_DISPLAY_NAMES[model.modelId] : undefined
  if (!legacyName) return getImageModelDisplayName(model, context)

  if (model.provider === ModelProviderEnum.ChatboxAI) {
    return legacyName
  }

  const group = context.imageModelGroups.find((item) => item.providerId === model.provider)
  const provider = context.providers.find((item) => item.id === model.provider)
  const providerName = group?.label || provider?.name || model.provider
  return `${providerName} - ${legacyName}`
}
