import { enrichModelFromRegistry } from '@shared/model-registry/enrich'
import { mergeProviderModelCapabilities } from '@shared/providers/model-config'
import { getProviderDefinition, getSystemProviders } from '@shared/providers/registry'
import type { Settings } from '@shared/types'

/** Resolve a model's configured context window from provider settings, if any. */
export function getConfiguredContextWindow(
  settings: Pick<Settings, 'providers'>,
  providerId: string | undefined,
  modelId: string | undefined
): number | undefined {
  if (!providerId || !modelId) return undefined
  return settings.providers?.[providerId]?.models?.find((model) => model.modelId === modelId)?.contextWindow
}

/** The reply limit a request runs with: the session's max tokens, else the model's max output. */
export function getEffectiveMaxOutputTokens(
  settings: Pick<Settings, 'providers'>,
  providerId: string | undefined,
  modelId: string | undefined,
  sessionMaxTokens: number | undefined
): number | undefined {
  if (sessionMaxTokens !== undefined) return sessionMaxTokens
  if (!providerId || !modelId) return undefined
  const storedModel = settings.providers?.[providerId]?.models?.find((model) => model.modelId === modelId)
  const defaultModel =
    getSystemProviders()
      .find((provider) => provider.id === providerId)
      ?.defaultSettings?.models?.find((model) => model.modelId === modelId) ??
    getProviderDefinition(providerId)?.defaultSettings?.models?.find((model) => model.modelId === modelId)
  const model = mergeProviderModelCapabilities(storedModel, defaultModel) ?? { modelId }
  return enrichModelFromRegistry(model, providerId).maxOutput
}
