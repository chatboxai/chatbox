import { getProviderDefinition } from '../providers/registry'
import type { SessionSettings, Settings } from '../types'
import { ModelProviderEnum } from '../types/provider'

/** Display the configured recipient while keeping authorization identity independent of its name. */
export function workModelDisclosure(
  settings: Pick<SessionSettings, 'provider' | 'modelId'>,
  globalSettings: Pick<Settings, 'providers' | 'customProviders'>
): { modelName: string; modelIdentity: string } {
  const providerId = settings.provider ?? ModelProviderEnum.ChatboxAI
  const modelId = settings.modelId ?? ''
  const providerName =
    globalSettings.customProviders?.find((provider) => provider.id === providerId)?.name?.trim() ||
    getProviderDefinition(providerId)?.name ||
    providerId
  const modelName =
    globalSettings.providers?.[providerId]?.models?.find((model) => model.modelId === modelId)?.nickname?.trim() ||
    modelId
  return { modelName: `${providerName} / ${modelName}`, modelIdentity: JSON.stringify([providerId, modelId]) }
}
