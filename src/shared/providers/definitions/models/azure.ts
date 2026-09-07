import { createAzure } from '@ai-sdk/azure'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeAzureEndpoint } from '../../../utils/llm_utils'

const AZURE_V1_API_VERSION = 'v1'

function normalizeAzureApiVersion(apiVersion: string) {
  const normalized = apiVersion.trim()
  return normalized.toLowerCase() === AZURE_V1_API_VERSION || normalized.length === 0
    ? AZURE_V1_API_VERSION
    : normalized
}

function isStandardAzureOpenAIEndpoint(endpoint: string) {
  try {
    return new URL(endpoint).hostname.toLowerCase().endsWith('.openai.azure.com')
  } catch {
    return false
  }
}

function createAzureV1Fetch(apiVersion: string): typeof globalThis.fetch {
  return (input, init) => {
    const url = new URL(typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input))
    url.searchParams.set('api-version', apiVersion)

    // AI SDK provider fetches pass request metadata through init. Only the URL
    // is rewritten here so method, headers, body, and cancellation stay intact.
    return globalThis.fetch(url.toString(), init)
  }
}

interface Options {
  azureEndpoint: string
  model: ProviderModelInfo
  azureDalleDeploymentName: string // dall-e-3 的部署名称
  azureApikey: string
  azureApiVersion: string

  // openaiMaxTokens: number
  temperature?: number
  topP?: number
  maxOutputTokens?: number

  dalleStyle: 'vivid' | 'natural'
  imageGenerateNum: number // 生成图片的数量

  injectDefaultMetadata: boolean
  stream?: boolean
}

export default class AzureOpenAI extends AbstractAISDKModel {
  public name = 'Azure OpenAI'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider() {
    const apiVersion = normalizeAzureApiVersion(this.options.azureApiVersion)
    const normalizedEndpoint = normalizeAzureEndpoint(this.options.azureEndpoint).endpoint
    const useDeploymentBasedUrls = apiVersion !== AZURE_V1_API_VERSION
    const isStandardEndpoint = isStandardAzureOpenAIEndpoint(normalizedEndpoint)

    // @ai-sdk/azure 3.0.84 changed custom base URLs to own their complete
    // routing. Preserve Chatbox's historical Azure semantics for those URLs:
    // v1 uses /openai/v1/*, while dated API versions use deployment URLs.
    const baseURL = !useDeploymentBasedUrls && !isStandardEndpoint ? `${normalizedEndpoint}/v1` : normalizedEndpoint

    return createAzure({
      apiKey: this.options.azureApikey,
      apiVersion,
      baseURL,
      useDeploymentBasedUrls,
      fetch: !useDeploymentBasedUrls && !isStandardEndpoint ? createAzureV1Fetch(apiVersion) : undefined,
    })
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
    }
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.chat(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  protected getImageModel() {
    const provider = this.getProvider()
    return provider.imageModel(this.options.model.modelId)
  }
}
