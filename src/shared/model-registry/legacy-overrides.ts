import type { ModelMetadata, ModelRegistryData } from './types'

/**
 * Retired Claude 3 IDs that ChatboxAI still serves. Their real max output is 4096;
 * without this overlay, live models.dev catalogs drop them and
 * getDefaultAnthropicMaxOutputTokens() falls back to 8192, which upstream rejects.
 */
const LEGACY_CLAUDE_MODELS: Record<string, ModelMetadata> = {
  'claude-3-haiku-20240307': {
    modelId: 'claude-3-haiku-20240307',
    name: 'Claude Haiku 3',
    type: 'chat',
    capabilities: ['tool_use', 'vision'],
    contextWindow: 200_000,
    maxOutput: 4_096,
    costInput: 0.25,
    costOutput: 1.25,
    family: 'claude-haiku',
    releaseDate: '2024-03-13',
  },
  'claude-3-sonnet-20240229': {
    modelId: 'claude-3-sonnet-20240229',
    name: 'Claude Sonnet 3',
    type: 'chat',
    capabilities: ['tool_use', 'vision'],
    contextWindow: 200_000,
    maxOutput: 4_096,
    costInput: 3,
    costOutput: 15,
    family: 'claude-sonnet',
    releaseDate: '2024-03-04',
  },
  'claude-3-opus-20240229': {
    modelId: 'claude-3-opus-20240229',
    name: 'Claude Opus 3',
    type: 'chat',
    capabilities: ['tool_use', 'vision'],
    contextWindow: 200_000,
    maxOutput: 4_096,
    costInput: 15,
    costOutput: 75,
    family: 'claude-opus',
    releaseDate: '2024-02-29',
  },
}

const DEEPSEEK_COMPATIBILITY_MODELS: Record<string, ModelMetadata> = {
  'deepseek-v4-flash-vision-exp': {
    modelId: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision Exp',
    type: 'chat',
    capabilities: ['tool_use', 'reasoning', 'vision'],
    contextWindow: 1_000_000,
    maxOutput: 384_000,
    costInput: 0.14,
    costOutput: 0.28,
    family: 'deepseek-flash',
    releaseDate: '2026-08-21',
    status: 'beta',
  },
}

const REGISTRY_OVERLAYS: ModelRegistryData = {
  claude: LEGACY_CLAUDE_MODELS,
  deepseek: DEEPSEEK_COMPATIBILITY_MODELS,
}

/**
 * Merge compatibility metadata into a registry without overwriting live entries.
 */
function mergeCompatibilityModel(existing: ModelMetadata | undefined, overlay: ModelMetadata): ModelMetadata {
  if (!existing) return overlay

  if (
    overlay.modelId === 'deepseek-v4-flash-vision-exp' &&
    overlay.capabilities.includes('vision') &&
    !existing.capabilities.includes('vision')
  ) {
    return {
      ...existing,
      capabilities: [...existing.capabilities, 'vision'],
    }
  }

  return existing
}

export function applyRegistryOverlays(registry: ModelRegistryData): ModelRegistryData {
  let result = registry

  for (const [providerId, overlayModels] of Object.entries(REGISTRY_OVERLAYS)) {
    const existingModels = result[providerId] ?? {}
    const nextModels = { ...existingModels }
    let changed = false

    for (const [modelId, overlayModel] of Object.entries(overlayModels)) {
      const mergedModel = mergeCompatibilityModel(existingModels[modelId], overlayModel)
      if (mergedModel !== existingModels[modelId]) {
        nextModels[modelId] = mergedModel
        changed = true
      }
    }

    if (changed) {
      result = {
        ...result,
        [providerId]: nextModels,
      }
    }
  }

  return result
}
