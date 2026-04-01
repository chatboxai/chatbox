/**
 * Mapping from Chatbox provider IDs (ModelProviderEnum values)
 * to models.dev provider IDs.
 *
 * Only providers with a known models.dev counterpart are listed here.
 * Providers not in this map (Ollama, LM Studio, VolcEngine,
 * ChatboxAI, Azure) will not receive models.dev enrichment.
 */
export const PROVIDER_ID_MAP: Record<string, string> = {
  openai: 'openai',
  'openai-responses': 'openai',
  claude: 'anthropic',
  gemini: 'google',
  xAI: 'xai',
  deepseek: 'deepseek',
  groq: 'groq',
  'mistral-ai': 'mistral',
  perplexity: 'perplexity',
  openrouter: 'openrouter',
  minimax: 'minimax',
  'minimax-cn': 'minimax-cn',
  moonshot: 'moonshotai',
  'moonshot-cn': 'moonshotai',
  siliconflow: 'siliconflow',
  'chatglm-6b': 'zhipuai',
  qwen: 'alibaba',
  'qwen-portal': 'alibaba',
}

/** Reverse mapping: models.dev provider ID -> Chatbox provider IDs */
export const REVERSE_PROVIDER_MAP: Record<string, string[]> = Object.entries(PROVIDER_ID_MAP).reduce(
  (acc, [chatboxId, modelsDevId]) => {
    if (!acc[modelsDevId]) {
      acc[modelsDevId] = []
    }
    acc[modelsDevId].push(chatboxId)
    return acc
  },
  {} as Record<string, string[]>
)

/**
 * Get the models.dev provider ID for a Chatbox provider.
 * Returns undefined if no mapping exists.
 */
export function getModelsDevProviderId(chatboxProviderId: string): string | undefined {
  return PROVIDER_ID_MAP[chatboxProviderId]
}

/**
 * Get all Chatbox provider IDs that map to a given models.dev provider ID.
 */
export function getChatboxProviderIds(modelsDevProviderId: string): string[] {
  return [...(REVERSE_PROVIDER_MAP[modelsDevProviderId] ?? [])]
}
