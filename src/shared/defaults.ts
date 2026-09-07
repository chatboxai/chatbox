import { createDefaultSettings, DEFAULT_SYSTEM_PROMPT } from '@chatbox/core/domain/settings'
import { v4 as uuidv4 } from 'uuid'
import { type Config, ModelProviderEnum, type SessionSettings, type Settings } from './types'

/**
 * Compatibility export. Global Settings defaults are owned by the Settings
 * domain so React Native consumers do not load UUID/provider dependencies.
 */
export function settings(): Settings {
  return createDefaultSettings()
}

export function newConfigs(): Config {
  return { uuid: uuidv4() }
}

export function getDefaultPrompt() {
  return DEFAULT_SYSTEM_PROMPT
}

export function chatSessionSettings(): SessionSettings {
  return {
    provider: ModelProviderEnum.ChatboxAI,
    modelId: 'chatboxai-4',
    maxContextMessageCount: Number.MAX_SAFE_INTEGER,
  }
}

export function pictureSessionSettings(): SessionSettings {
  return {
    provider: ModelProviderEnum.ChatboxAI,
    modelId: 'DALL-E-3',
    imageGenerateNum: 1,
    dalleStyle: 'vivid',
  }
}

// SystemProviders is generated from the provider registry.
export { getSystemProviders as SystemProviders } from './providers/registry'
