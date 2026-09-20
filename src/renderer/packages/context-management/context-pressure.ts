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
