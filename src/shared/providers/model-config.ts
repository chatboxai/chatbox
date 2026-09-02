import type { ProviderModelInfo } from '../types'

/** Fill capabilities added to a built-in model after its settings were persisted. */
export function mergeProviderModelCapabilities(
  storedModel: ProviderModelInfo | undefined,
  defaultModel: ProviderModelInfo | undefined
): ProviderModelInfo | undefined {
  if (!storedModel) return defaultModel
  if (storedModel.capabilities !== undefined || defaultModel?.capabilities === undefined) return storedModel

  return {
    ...storedModel,
    capabilities: defaultModel.capabilities,
  }
}
