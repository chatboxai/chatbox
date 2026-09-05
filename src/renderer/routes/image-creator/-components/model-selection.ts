import { getRatioOptionsForModel } from '@shared/providers/definitions/image-models'
import type { ImageModelCapabilities } from '@shared/types'
import type { ImageModelGroup } from '@/hooks/useImageModelGroups'

export interface ImageModelSelection {
  provider: string
  model: string
}

export function getImageModelRatioOptions(modelId: string, capabilities?: ImageModelCapabilities): string[] {
  if (!capabilities) return getRatioOptionsForModel(modelId)

  return [...new Set(['auto', ...(capabilities.aspectRatio?.values ?? [])])]
}

export function resolveImageRatioSelection(selectedRatio: string, ratioOptions: string[]): string {
  return ratioOptions.includes(selectedRatio) ? selectedRatio : 'auto'
}

export function resolveImageModelSelection(
  modelGroups: ImageModelGroup[],
  selectedProvider: string,
  selectedModel: string
): ImageModelSelection | null {
  const selectedGroup = modelGroups.find((group) => group.providerId === selectedProvider)
  const selectedOption = selectedGroup?.models.find((model) => model.modelId === selectedModel)
  if (selectedOption) {
    return { provider: selectedProvider, model: selectedModel }
  }

  const firstGroup = modelGroups.find((group) => group.models.length > 0)
  const firstModel = firstGroup?.models[0]
  return firstGroup && firstModel ? { provider: firstGroup.providerId, model: firstModel.modelId } : null
}
