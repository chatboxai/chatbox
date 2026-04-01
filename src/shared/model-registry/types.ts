// ===== Raw models.dev API response types =====

export interface ModelsDevModelEntry {
  id: string
  name: string
  family: string
  tool_call: boolean
  reasoning: boolean
  attachment?: boolean
  interleaved?: boolean
  structured_output: boolean
  open_weights: boolean
  modalities: {
    input: string[] // e.g., ["text", "image", "audio", "video", "pdf"]
    output: string[] // e.g., ["text", "image"]
  }
  limit: {
    context: number
    output: number
  }
  cost: {
    input: number // per 1M tokens
    output: number // per 1M tokens
  }
  release_date: string
  last_updated?: string
  status?: string
  knowledge?: Record<string, unknown>
  temperature?: Record<string, unknown>
}

export interface ModelsDevProviderEntry {
  id: string
  name: string
  env?: string[]
  npm?: string
  api?: string
  doc: string
  models: Record<string, ModelsDevModelEntry>
}

export interface ModelsDevResponse {
  [providerId: string]: ModelsDevProviderEntry
}

// ===== Internal processed registry types =====

export interface ModelMetadata {
  modelId: string
  name?: string
  type: 'chat' | 'embedding' | 'rerank'
  capabilities: ('vision' | 'reasoning' | 'tool_use' | 'web_search')[]
  contextWindow: number
  maxOutput: number
  costInput?: number // per 1M tokens
  costOutput?: number // per 1M tokens
  family?: string
  releaseDate?: string
  status?: string
}

/** Map of modelId -> metadata for a single provider */
export type ProviderModelRegistry = Record<string, ModelMetadata>

/** Full registry keyed by Chatbox provider ID (ModelProviderEnum values) */
export type ModelRegistryData = Record<string, ProviderModelRegistry>
