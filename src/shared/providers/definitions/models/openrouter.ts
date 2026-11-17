import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { ImageModelProviderMetadata, ModelMessage } from 'ai'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { applyAnthropicCacheBreakpoints } from '../../../models/anthropic-cache'
import { fetchRemoteModels } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import { createOpenAIChatCompletionSseFetch } from '../../../models/utils/openai-chat-sse-termination'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
  customFetch?: typeof globalThis.fetch
}

export default class OpenRouter extends AbstractAISDKModel {
  public name = 'OpenRouter'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      providerOptions: options.providerOptions?.openrouter
        ? {
            openrouter: options.providerOptions.openrouter,
          }
        : undefined,
    }
  }

  protected getProvider() {
    return createOpenRouter({
      apiKey: this.options.apiKey,
      headers: {
        'HTTP-Referer': 'https://chatboxai.app',
        'X-Title': 'Chatbox AI',
      },
      fetch: createOpenAIChatCompletionSseFetch(this.options.customFetch),
    })
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  // OpenRouter only caches Claude prompts at explicit cache_control breakpoints.
  protected override prepareRequestMessages(messages: ModelMessage[]): ModelMessage[] {
    if (!/claude/i.test(this.options.model.modelId)) return messages
    return applyAnthropicCacheBreakpoints(messages).map(withAssistantCacheControlOnMessage)
  }

  protected getImageModel() {
    const modelId = this.options.model.modelId
    if (!modelId) return null
    return this.getProvider().imageModel(modelId)
  }

  protected override getMaxImagesPerGenerationRequest() {
    return 1
  }

  protected override getImageGenerationPrompt(params: {
    prompt: string
    images?: { imageUrl: string }[]
  }): string | { text: string; images: string[] } {
    if (!params.images?.length) return params.prompt
    return {
      text: params.prompt,
      images: params.images.map((image) => image.imageUrl),
    }
  }

  protected override getGeneratedImageMediaType(
    defaultMediaType: string,
    index: number,
    providerMetadata: ImageModelProviderMetadata
  ): string {
    const imageMetadata = providerMetadata.openrouter?.images
    if (!Array.isArray(imageMetadata)) return defaultMediaType
    const metadata = imageMetadata[index]
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return defaultMediaType
    const mediaType = metadata.mediaType
    return typeof mediaType === 'string' && mediaType.startsWith('image/') ? mediaType : defaultMediaType
  }

  public listModels(): Promise<ProviderModelInfo[]> {
    return fetchRemoteModels(
      {
        apiHost: 'https://openrouter.ai/api/v1',
        apiKey: this.options.apiKey,
        useProxy: false,
      },
      this.dependencies
    ).catch((err) => {
      console.error(err)
      return []
    })
  }
}

type AssistantPart = Exclude<Extract<ModelMessage, { role: 'assistant' }>['content'], string>[number]

function getAnthropicCacheControl(options: ModelMessage['providerOptions']) {
  return options?.anthropic?.cacheControl
}

/**
 * The OpenRouter serializer reads `cache_control` on an assistant message only from
 * the message itself and sends reasoning in separate fields, so a breakpoint placed on
 * an assistant part (the fallback when the message ends in reasoning) is moved to the
 * message.
 */
function withAssistantCacheControlOnMessage(message: ModelMessage): ModelMessage {
  if (message.role !== 'assistant' || typeof message.content === 'string') return message
  const parts = message.content as AssistantPart[]
  const marked = parts.find((part) => 'providerOptions' in part && getAnthropicCacheControl(part.providerOptions))
  if (!marked || !('providerOptions' in marked)) return message
  const cacheControl = getAnthropicCacheControl(marked.providerOptions)
  return {
    ...message,
    content: parts.map((part) => {
      if (part !== marked) return part
      const { cacheControl: _cacheControl, ...anthropic } = marked.providerOptions?.anthropic ?? {}
      return { ...marked, providerOptions: { ...marked.providerOptions, anthropic } }
    }),
    providerOptions: {
      ...message.providerOptions,
      anthropic: { ...message.providerOptions?.anthropic, cacheControl },
    },
  } as ModelMessage
}
