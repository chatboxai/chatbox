import { applyRegistryOverlays } from './legacy-overrides'
import { REVERSE_PROVIDER_MAP } from './provider-mapping'
import type {
  ModelMetadata,
  ModelRegistryData,
  ModelsDevModelEntry,
  ModelsDevResponse,
  ProviderModelRegistry,
} from './types'

const MEDIA_GENERATION_FAMILIES = new Set(['veo', 'lyria'])

/**
 * Image / video / audio generators are not conversational models. Keep them out of
 * the chat registry so getDiscoveredModels() cannot surface them as new chat options.
 */
export function isNonChatMediaModel(entry: ModelsDevModelEntry): boolean {
  if (MEDIA_GENERATION_FAMILIES.has(entry.family ?? '')) {
    return true
  }
  const outputs = entry.modalities?.output ?? []
  return outputs.length > 0 && !outputs.includes('text')
}

// models.dev currently marks GPT-5 chat-tuned variants as reasoning models, but their
// chat-completions endpoints reject reasoning_effort. Keep the source correction here so
// generated snapshots and live enrichment apply the same override.
const GPT_NON_REASONING_CHAT_MODEL = /(?:^|\/)gpt-5[\w.-]*[.-]chat(?:[.-]|$)/i

/**
 * Transform a single models.dev model entry into our internal ModelMetadata format.
 */
export function transformModelEntry(entry: ModelsDevModelEntry): ModelMetadata {
  const capabilities: ModelMetadata['capabilities'] = []

  if (entry.tool_call) {
    capabilities.push('tool_use')
  }
  if (entry.reasoning && !GPT_NON_REASONING_CHAT_MODEL.test(entry.id)) {
    capabilities.push('reasoning')
  }
  if (entry.modalities?.input?.some((m) => ['image', 'video'].includes(m))) {
    capabilities.push('vision')
  }

  // Determine type based on model name/family heuristics
  let type: ModelMetadata['type'] = 'chat'
  const idLower = entry.id.toLowerCase()
  if (idLower.includes('embed')) {
    type = 'embedding'
  } else if (idLower.includes('rerank')) {
    type = 'rerank'
  }

  return {
    modelId: entry.id,
    name: entry.name,
    type,
    capabilities,
    contextWindow: entry.limit?.context ?? 0,
    maxOutput: entry.limit?.output ?? 0,
    costInput: entry.cost?.input,
    costOutput: entry.cost?.output,
    family: entry.family,
    releaseDate: entry.release_date,
    status: entry.status,
  }
}

/**
 * Transform a models.dev provider's models into a ProviderModelRegistry.
 */
export function transformProviderModels(models: Record<string, ModelsDevModelEntry>): ProviderModelRegistry {
  const registry: ProviderModelRegistry = {}

  for (const [modelId, entry] of Object.entries(models)) {
    if (!entry || !modelId || isNonChatMediaModel(entry)) continue
    registry[modelId] = transformModelEntry(entry)
  }

  return registry
}

/**
 * Transform the full models.dev API response into our internal ModelRegistryData format.
 * Only processes providers that have a mapping in PROVIDER_ID_MAP.
 */
export function transformFullResponse(response: ModelsDevResponse): ModelRegistryData {
  const registry: ModelRegistryData = {}

  for (const [modelsDevId, providerEntry] of Object.entries(response)) {
    if (!providerEntry?.models) continue

    // Check if this models.dev provider maps to any Chatbox providers
    const chatboxIds = REVERSE_PROVIDER_MAP[modelsDevId]
    if (!chatboxIds || chatboxIds.length === 0) continue

    const providerModels = transformProviderModels(providerEntry.models)

    // Assign to all Chatbox provider IDs that map to this models.dev provider
    for (const chatboxId of chatboxIds) {
      registry[chatboxId] = providerModels
    }
  }

  return applyRegistryOverlays(registry)
}

/**
 * Extract a flat map of modelId -> contextWindow from the full registry.
 * Used for backward compatibility with the old model-context module.
 */
export function extractContextWindows(registry: ModelRegistryData): Record<string, number> {
  const result: Record<string, number> = {}

  for (const providerRegistry of Object.values(registry)) {
    for (const [modelId, meta] of Object.entries(providerRegistry)) {
      if (meta.contextWindow > 0) {
        result[modelId] = meta.contextWindow
      }
    }
  }

  return result
}
