import type { ModelInterface } from '../models/types'
import { enrichModelFromRegistry } from '../model-registry/enrich'
import { mergeSharedOAuthProviderSettings, resolveEffectiveApiKey } from '../oauth'
import type { Config, ProviderModelInfo, ProviderSettings, SessionSettings, Settings } from '../types'
import type { ModelDependencies } from '../types/adapters'
// ChatboxAI must be imported first to ensure it appears at the top of provider lists
// Import order determines display order in UI (side-effect registration into Map)
import './definitions/chatboxai'
import './definitions/openai'
import './definitions/openai-responses'
import './definitions/gemini'
import './definitions/claude'
import './definitions/deepseek'
import './definitions/qwen'
import './definitions/qwen-portal'
import './definitions/minimax'
import './definitions/moonshot'
import './definitions/siliconflow'
import './definitions/openrouter'
import './definitions/ollama'
import './definitions/lmstudio'
import './definitions/azure'
import './definitions/groq'
import './definitions/xai'
import './definitions/mistral-ai'
import './definitions/perplexity'
import './definitions/volcengine'
import './definitions/chatglm'
import {
  clearProviderRegistry,
  defineProvider,
  getAllProviders,
  getProviderDefinition,
  getSystemProviders,
  hasProvider,
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

  let model = providerSetting.models?.find((m) => m.modelId === settings.modelId)
  if (!model) {
    model = getSystemProviders()
      .find((p) => p.id === provider)
      ?.defaultSettings?.models?.find((m) => m.modelId === settings.modelId)
  }
  if (!model) {
    const registryProvider = getProviderDefinition(provider)
    model = registryProvider?.defaultSettings?.models?.find((m) => m.modelId === settings.modelId)
  }
  if (!model) {
    model = {
      modelId: settings.modelId ?? '',
    }
  }

  // Enrich with registry metadata (capabilities, contextWindow, maxOutput)
  // so model instances have accurate data for capability checks.
  return enrichModelFromRegistry(model, provider)
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
    const model = getModelConfig(settings, globalSettings, provider)
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
  const model = getModelConfig(settings, globalSettings, provider)

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
