import { enrichModelFromRegistry } from '../model-registry/enrich'
import type { ModelInterface } from '../models/types'
import { mergeSharedOAuthProviderSettings, resolveEffectiveApiKey } from '../oauth'
import type { Config, ProviderModelInfo, SessionSettings, Settings } from '../types'
import type { ModelDependencies } from '../types/adapters'
import { withResolvedModelApiStyle } from './api-style'
import './builtin-registration'
import { mergeProviderModelCapabilities } from './model-config'
import {
  clearProviderRegistry,
  defineProvider,
  getAllProviders,
  getProviderDefinition,
  getSystemProviders,
  hasProvider,
  isProviderAvailableOnPlatform,
} from './registry'
import type { CreateModelConfig, ProviderDefinition, ProviderDefinitionInput } from './types'
import { createCustomProviderModel } from './utils'

export {
  clearProviderRegistry,
  defineProvider,
  getAllProviders,
  getProviderDefinition,
  getSystemProviders,
  hasProvider,
  isProviderAvailableOnPlatform,
}
export type { CreateModelConfig, ProviderDefinition, ProviderDefinitionInput }

export function isBuiltinProviderId(providerId: string): boolean {
  return !!getProviderDefinition(providerId)
}

export function getBuiltinProviderIds(): string[] {
  return getSystemProviders().map((provider) => provider.id)
}

/**
 * Get provider settings from session and global settings.
 * This is a helper function that extracts and formats provider-related settings.
 */
export function getProviderSettings(setting: SessionSettings, globalSettings: Settings) {
  console.debug('getProviderSettings', setting.provider, setting.modelId)
  const provider = setting.provider
  if (!provider) {
    throw new Error('Model provider must not be empty.')
  }

  const registryProviders = getSystemProviders()
  const providerBaseInfo = [...registryProviders, ...(globalSettings.customProviders || [])].find(
    (p) => p.id === provider
  )

  if (!providerBaseInfo) {
    throw new Error(`Cannot find model with provider: ${setting.provider}`)
  }
  const providerSetting = mergeSharedOAuthProviderSettings(provider, globalSettings.providers)
  // When OAuth is active, use the provider's default API host (OAuth tokens are issued for specific endpoints)
  const isOAuthActive = providerSetting.activeAuthMode === 'oauth' && !!providerSetting.oauth?.accessToken
  const formattedApiHost = (
    (isOAuthActive ? '' : providerSetting.apiHost) ||
    providerBaseInfo.defaultSettings?.apiHost ||
    ''
  ).trim()
  return {
    providerSetting,
    formattedApiHost,
    providerBaseInfo,
  }
}

/**
 * Get the model configuration from provider settings or defaults.
 */
function getModelConfig(settings: SessionSettings, globalSettings: Settings, provider: string): ProviderModelInfo {
  const providerSetting = globalSettings.providers?.[provider] || {}
  const storedModel = providerSetting.models?.find((m) => m.modelId === settings.modelId)
  const defaultModel =
    getSystemProviders()
      .find((p) => p.id === provider)
      ?.defaultSettings?.models?.find((m) => m.modelId === settings.modelId) ??
    getProviderDefinition(provider)?.defaultSettings?.models?.find((m) => m.modelId === settings.modelId)
  let model = mergeProviderModelCapabilities(storedModel, defaultModel)
  if (!model) {
    model = {
      modelId: settings.modelId ?? '',
    }
  }

  // Enrich with registry metadata (capabilities, contextWindow, maxOutput)
  // so model instances have accurate data for capability checks.
  // Stamp the resolving provider id so model instances can evaluate reasoning-control
  // support using the same provider+model-id logic as the UI.
  return { ...enrichModelFromRegistry(model, provider), providerId: provider }
}

/**
 * Fills `model.apiStyle` from the provider's type when the model does not carry one,
 * mirroring the renderer's `withProviderApiStyleFallback`. This lets reasoning-control
 * support be judged by API style + model id for providers that proxy upstream models
 * (custom providers and built-in proxies like github-copilot whose id carries no
 * reasoning semantics). For built-in providers that resolve reasoning by their own id,
 * apiStyle is ignored, so stamping it is a harmless no-op.
 */
function withReasoningApiStyle(
  model: ProviderModelInfo,
  providerType: string | undefined,
  providerId?: string
): ProviderModelInfo {
  return withResolvedModelApiStyle(model, { providerId, providerType })
}

/**
 * New getModel() implementation using the provider registry.
 *
 * This function checks if a provider is registered in the registry.
 * If found, it uses the registered createModel() factory function.
 * For custom providers (user-created), it uses createCustomProviderModel().
 */
export function getModel(
  settings: SessionSettings,
  globalSettings: Settings,
  config: Config,
  dependencies: ModelDependencies
): ModelInterface {
  console.debug('getModel (registry)', settings.provider, settings.modelId)

  const provider = settings.provider
  if (!provider) {
    throw new Error('Model provider must not be empty.')
  }

  // Check if provider is registered in the new registry
  const providerDefinition = getProviderDefinition(provider)

  if (providerDefinition) {
    // Provider is registered - use the new registry-based approach
    const { providerSetting, formattedApiHost, providerBaseInfo } = getProviderSettings(settings, globalSettings)
    const model = withReasoningApiStyle(
      getModelConfig(settings, globalSettings, provider),
      providerBaseInfo.type,
      provider
    )
    const formattedApiPath = providerSetting.apiPath || providerBaseInfo.defaultSettings?.apiPath || ''
    const effectiveApiKey = resolveEffectiveApiKey(providerSetting, dependencies.platformType || 'desktop')

    const createConfig: CreateModelConfig = {
      settings,
      globalSettings,
      config,
      dependencies,
      providerSetting,
      formattedApiHost,
      formattedApiPath,
      model,
      effectiveApiKey,
    }

    return providerDefinition.createModel(createConfig)
  }

  // Provider not registered - check if it's a custom provider
  const { providerSetting, formattedApiHost, providerBaseInfo } = getProviderSettings(settings, globalSettings)
  const model = withReasoningApiStyle(
    getModelConfig(settings, globalSettings, provider),
    providerBaseInfo.type,
    provider
  )

  if (providerBaseInfo.isCustom) {
    const formattedApiPath = providerSetting.apiPath || providerBaseInfo.defaultSettings?.apiPath || ''
    const effectiveApiKey = resolveEffectiveApiKey(providerSetting, dependencies.platformType || 'desktop')
    return createCustomProviderModel(
      {
        settings,
        globalSettings,
        config,
        dependencies,
        providerSetting,
        formattedApiHost,
        formattedApiPath,
        model,
        effectiveApiKey,
      },
      providerBaseInfo.type,
      dependencies
    )
  }

  throw new Error(`Cannot find model with provider: ${settings.provider}`)
}
