import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV4, EmbeddingModelV4CallOptions } from '@ai-sdk/provider'
import type { EmbeddingModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import type { CallChatCompletionOptions } from '../../../models/types'
import { isDeepSeekWeakToolUse } from '../../../models/utils/deepseek'
import { createOpenAIChatCompletionSseFetch } from '../../../models/utils/openai-chat-sse-termination'
import type { ProviderModelInfo, ToolUseScope } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

const API_ORIGIN = 'https://ark.cn-beijing.volces.com'
const API_BASE = `${API_ORIGIN}/api/v3`

export function isVolcengineVisionEmbeddingModel(modelId: string): boolean {
  return modelId.includes('embedding-vision')
}

export default class VolcEngine extends AbstractAISDKModel {
  public name = 'VolcEngine'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider() {
    return createOpenAICompatible({
      name: this.name,
      apiKey: this.options.apiKey,
      baseURL: API_BASE,
      fetch: createOpenAIChatCompletionSseFetch(globalThis.fetch),
    })
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return provider.chatModel(this.options.model.modelId)
  }

  protected getTextEmbeddingModel(options: CallChatCompletionOptions): EmbeddingModel | null {
    if (isVolcengineVisionEmbeddingModel(this.options.model.modelId)) {
      return new VolcengineMultimodalTextEmbeddingModel({
        apiKey: this.options.apiKey,
        modelId: this.options.model.modelId,
      })
    }
    return super.getTextEmbeddingModel(options)
  }

  isSupportToolUse(scope?: ToolUseScope) {
    if (isDeepSeekWeakToolUse(this.options.model.modelId, scope)) return false
    return super.isSupportToolUse()
  }
}

class VolcengineMultimodalTextEmbeddingModel implements EmbeddingModelV4 {
  readonly specificationVersion = 'v4' as const
  readonly provider = 'volcengine.embedding'
  readonly maxEmbeddingsPerCall = 64
  readonly supportsParallelCalls = false

  constructor(private readonly options: { apiKey: string; modelId: string }) {}

  get modelId() {
    return this.options.modelId
  }

  async doEmbed({ values, abortSignal, headers }: EmbeddingModelV4CallOptions) {
    const embeddings: number[][] = []
    for (const text of values) {
      const response = await fetch(`${API_BASE}/embeddings/multimodal`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          model: this.options.modelId,
          input: [{ type: 'text', text }],
        }),
        signal: abortSignal,
      })
      const body: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        throw new Error(
          `Volcengine multimodal embedding failed (${response.status}): ${readVolcengineErrorMessage(body)}`
        )
      }
      const embedding = readVolcengineMultimodalEmbedding(body)
      if (!embedding) {
        throw new Error('Volcengine multimodal embedding response did not include a vector')
      }
      embeddings.push(embedding)
    }
    return { embeddings, warnings: [] }
  }
}

function readVolcengineErrorMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return 'request failed'
  const error = (body as { error?: unknown }).error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    const message = (error as { message: string }).message.trim()
    if (message) return message
  }
  return 'request failed'
}

function readVolcengineMultimodalEmbedding(body: unknown): number[] | undefined {
  if (!body || typeof body !== 'object') return undefined
  const data = (body as { data?: unknown }).data
  if (Array.isArray(data)) {
    const embedding =
      data[0] && typeof data[0] === 'object' ? (data[0] as { embedding?: unknown }).embedding : undefined
    return isNumberArray(embedding) ? embedding : undefined
  }
  if (data && typeof data === 'object') {
    const embedding = (data as { embedding?: unknown }).embedding
    return isNumberArray(embedding) ? embedding : undefined
  }
  return undefined
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
}
