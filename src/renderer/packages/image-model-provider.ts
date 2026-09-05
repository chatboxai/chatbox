import { fetchOpenRouterImageModels } from '@shared/providers/definitions/models/openrouter-image-api'
import { type ImageModelCapabilities, ModelProviderEnum } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { getModelManifest } from '@/packages/remote'
export interface ImageModelOption {
  modelId: string
  displayName: string
  capabilities?: ImageModelCapabilities
}

export interface ImageModelCatalogOptions {
  apiKey?: string
  licenseKey?: string
  language?: string
}

export async function loadProviderImageModels(
  provider: ModelProviderEnum,
  options: ImageModelCatalogOptions = {}
): Promise<ImageModelOption[]> {
  if (provider === ModelProviderEnum.OpenRouter && options.apiKey) {
    try {
      const dependencies = await createModelDependencies()
      const models = await fetchOpenRouterImageModels(options.apiKey, dependencies)
      return models.map((model) => ({
        modelId: model.modelId,
        displayName: model.nickname,
        capabilities: model.capabilities,
      }))
    } catch {
      // Fall through to the Chatbox manifest when OpenRouter is unreachable.
    }
  }

  const manifest = await getModelManifest({
    aiProvider: provider,
    language: options.language,
    licenseKey: provider === ModelProviderEnum.ChatboxAI ? options.licenseKey : undefined,
  })
  return manifest.imageModels.map((model) => ({
    modelId: model.modelId,
    displayName: model.modelName || model.modelId,
  }))
}
