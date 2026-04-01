import { isBuiltinProviderId } from '@shared/providers'
import type { CustomProviderBaseInfo, ModelProviderEnum, ProviderInfo, ProviderSettings, Settings } from '@shared/types'
import { ModelProviderType } from '@shared/types'

type ImportedProviderConfig = ProviderInfo | (ProviderSettings & { id: ModelProviderEnum })

function dedupeModels(importedConfig: ImportedProviderConfig, existingProvider: ProviderInfo | null) {
  const allModels = importedConfig.models || existingProvider?.models || []
  return allModels.filter(
    (model, index, array) => array.findIndex((candidate) => candidate.modelId === model.modelId) === index
  )
}

export function buildImportedProviderSettingsUpdate(params: {
  importedConfig: ImportedProviderConfig
  existingProvider: ProviderInfo | null
  providers: Settings['providers'] | undefined
  customProviders: Settings['customProviders'] | undefined
}): Partial<Settings> {
  const { importedConfig, existingProvider, providers, customProviders } = params

  const providerName =
    ('name' in importedConfig ? importedConfig.name : '') ||
    (existingProvider && 'name' in existingProvider ? existingProvider.name : '') ||
    ''
  const providerId = importedConfig.id
  const apiHost = importedConfig.apiHost || existingProvider?.apiHost || ''
  const apiPath = importedConfig.apiPath || ''
  const apiKey = importedConfig.apiKey || ''
  const urls = 'urls' in importedConfig ? importedConfig.urls : existingProvider?.urls || {}
  const providerType =
    ('type' in importedConfig ? importedConfig.type : undefined) ||
    (existingProvider && 'type' in existingProvider ? existingProvider.type : undefined) ||
    ModelProviderType.OpenAI
  const uniqueModels = dedupeModels(importedConfig, existingProvider)

  const providerSettings = {
    ...providers?.[providerId],
    apiHost,
    apiPath,
    apiKey,
    models: uniqueModels,
  }

  if ('isCustom' in importedConfig && importedConfig.isCustom && isBuiltinProviderId(providerId)) {
    throw new Error(`Custom provider "${providerId}" conflicts with a builtin provider ID`)
  }

  if (existingProvider && !existingProvider.isCustom) {
    return {
      providers: {
        ...providers,
        [providerId]: providerSettings,
      },
    }
  }

  const baseProviderInfo: CustomProviderBaseInfo = {
    id: providerId,
    name: providerName,
    type: providerType,
    iconUrl: 'iconUrl' in importedConfig ? importedConfig.iconUrl : undefined,
    urls,
    isCustom: true,
  }

  return {
    customProviders: existingProvider
      ? (customProviders || []).map((provider) =>
          provider.id === providerId ? { ...provider, ...baseProviderInfo } : provider
        )
      : [...(customProviders || []), baseProviderInfo],
    providers: {
      ...providers,
      [providerId]: providerSettings,
    },
  }
}
