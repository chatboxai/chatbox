import { type EmbeddingModel, embedMany } from 'ai'
import { createModel } from '@/adapters'
import { settingsStore } from '@/stores/settingsStore'
import { parseKnowledgeBaseModelString } from '@shared/utils/knowledge-base-model-parser'
import { SessionSettingsSchema } from '@shared/types'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000

export interface MobileEmbeddingResolution {
  provider: EmbeddingModel
  modelString: string
  source: 'chatbox-ai-license' | 'default-embedding-model'
}

export function getMobileEmbeddingModelString(): string | undefined {
  const settings = settingsStore.getState()
  const defaultModel = settings.defaultEmbeddingModel
  if (defaultModel?.provider && defaultModel.model) {
    return `${defaultModel.provider}:${defaultModel.model}`
  }
  if (settings.licenseKey) {
    return 'chatbox-ai:text-embedding-3-small'
  }
  return undefined
}

export async function resolveMobileEmbeddingProvider(
  customModelString?: string
): Promise<MobileEmbeddingResolution> {
  const modelString = customModelString ?? getMobileEmbeddingModelString()
  if (!modelString) {
    throw new Error('No embedding model configured. Please set an embedding model in settings.')
  }

  const parsed = parseKnowledgeBaseModelString(modelString)
  if (!parsed) {
    throw new Error(`Invalid embedding model identifier: ${modelString}`)
  }

  const { providerId, modelId } = parsed
  const globalSettings = settingsStore.getState()
  const sessionSettings = SessionSettingsSchema.parse({
    ...globalSettings,
    provider: providerId,
    modelId,
  })

  const model = await createModel(sessionSettings)
  const maybeGetTextEmbeddingModel = (model as { getTextEmbeddingModel?: (opts: unknown) => EmbeddingModel })
    .getTextEmbeddingModel
  if (typeof maybeGetTextEmbeddingModel !== 'function') {
    throw new Error(`Provider ${providerId} model ${modelId} does not support embeddings`)
  }

  const embeddingModel = maybeGetTextEmbeddingModel.call(model, {})
  const isDefault = Boolean(
    globalSettings.defaultEmbeddingModel?.provider && globalSettings.defaultEmbeddingModel.model
  )

  return {
    provider: embeddingModel,
    modelString,
    source: isDefault ? 'default-embedding-model' : 'chatbox-ai-license',
  }
}

export async function embedManyWithRetry(
  model: EmbeddingModel,
  values: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<number[][]> {
  let attempt = 0
  const deadline = Date.now() + timeoutMs

  while (true) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new Error(`Embedding request timed out after ${timeoutMs / 1000} seconds`)
    }

    const abortController = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        abortController.abort()
        reject(new Error(`Embedding request timed out after ${timeoutMs / 1000} seconds`))
      }, remainingMs)
    })

    try {
      const result = await Promise.race([
        embedMany({
          model,
          values,
          maxRetries: 0,
          abortSignal: abortController.signal,
        }),
        timeoutPromise,
      ])
      return result.embeddings
    } catch (error) {
      attempt += 1
      if (attempt > MAX_RETRIES) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }
}

export function validateEmbeddingBatch(
  embeddings: number[][],
  expectedCount: number,
  expectedDimension?: number
) {
  if (embeddings.length !== expectedCount) {
    throw new Error(`Embedding batch failed: expected ${expectedCount}, got ${embeddings.length}`)
  }
  for (const embedding of embeddings) {
    if (!embedding || embedding.length === 0) {
      throw new Error('Embedding provider returned an empty vector')
    }
    if (expectedDimension !== undefined && embedding.length !== expectedDimension) {
      throw new Error(`Embedding dimension mismatch: expected ${expectedDimension}, got ${embedding.length}`)
    }
  }
}
