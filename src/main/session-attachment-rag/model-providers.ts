import type { EmbeddingModel } from 'ai'
import { CohereClient } from 'cohere-ai'
import { getProviderSettings } from '../../shared/models'
import { getWorkspAIceAPIOrigin } from '../../shared/request/workspaiceai_pool'
import { sentry } from '../../shared/sentry-shim'
import { parseKnowledgeBaseModelString } from '../../shared/utils/knowledge-base-model-parser'
import { cache } from '../cache'
import { createEmbeddingProviderFromModelString } from '../knowledge-base/model-providers'
import { getSettings, store } from '../store-node'
import { getLogger } from '../util'

const log = getLogger('session-attachment-rag:model-providers')

const SESSION_ATTACHMENT_EMBEDDING_MODEL = 'openai:text-embedding-3-small'

export async function getSessionAttachmentEmbeddingProvider(): Promise<EmbeddingModel> {
  try {
    return await createEmbeddingProviderFromModelString(SESSION_ATTACHMENT_EMBEDDING_MODEL)
  } catch (error) {
    log.error(
      `[MODEL] Failed to resolve fixed session attachment embedding provider: ${SESSION_ATTACHMENT_EMBEDDING_MODEL}`,
      error
    )
    sentry.withScope((scope) => {
      scope.setTag('component', 'session-attachment-rag-model')
      scope.setTag('operation', 'get_embedding_provider')
      scope.setExtra('embeddingModel', SESSION_ATTACHMENT_EMBEDDING_MODEL)
      sentry.captureException(error)
    })
    throw error
  }
}

export async function getSessionAttachmentRerankProvider(modelString?: string | null) {
  if (!modelString) {
    return null
  }

  return cache(
    `session-attachment-rag:rerank:${modelString}`,
    async () => {
      try {
        const parsed = parseKnowledgeBaseModelString(modelString)
        if (!parsed) {
          throw new Error(`Invalid rerank model format: ${modelString}`)
        }

        const { providerId, modelId } = parsed
        const settings = getSettings()
        const { providerSetting, formattedApiHost } = getProviderSettings(
          {
            ...settings,
            provider: providerId,
            modelId,
          },
          settings
        )

        const apiHost = formattedApiHost
        const token = providerSetting.apiKey

        if (!token) {
          throw new Error(`Missing token for rerank provider: ${providerId}`)
        }

        const client = new CohereClient({
          environment: apiHost,
          token,
        })
        return { client, modelId }
      } catch (error) {
        log.error(`[MODEL] Failed to resolve session attachment rerank provider: ${modelString}`, error)
        sentry.withScope((scope) => {
          scope.setTag('component', 'session-attachment-rag-model')
          scope.setTag('operation', 'get_rerank_provider')
          scope.setExtra('rerankModel', modelString)
          sentry.captureException(error)
        })
        throw error
      }
    },
    {
      ttl: 1000 * 60,
    }
  )
}
