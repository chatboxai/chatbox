import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { ImageModelProviderMetadata, ModelMessage, ToolSet } from 'ai'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { addAnthropicCacheControl } from '../../../models/anthropic-cache'
import { fetchRemoteModels } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions, ChatStreamOptions, ModelStreamPart } from '../../../models/types'
import { createOpenAIChatCompletionSseFetch } from '../../../models/utils/openai-chat-sse-termination'
import type { ProviderModelInfo, StreamTextResult } from '../../../types'
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

  public async chat(messages: ModelMessage[], options: CallChatCompletionOptions): Promise<StreamTextResult> {
    return super.chat(this.withPromptCache(messages), options)
  }

  public async *chatStream<T extends ToolSet>(
    messages: ModelMessage[],
    options: ChatStreamOptions
  ): AsyncGenerator<ModelStreamPart<T>> {
    yield* super.chatStream<T>(this.withPromptCache(messages), options)
  }

  // OpenRouter only caches Claude prompts at explicit cache_control breakpoints.
  private withPromptCache(messages: ModelMessage[]): ModelMessage[] {
    if (!/claude/i.test(this.options.model.modelId)) return messages
    const result = addAnthropicCacheControl(messages)
    const lastIndex = result.length - 1
    const last = messages[lastIndex]
    if (last?.role !== 'tool') return result

    // OpenRouter copies a tool message's cache marker onto every result it expands into,
    // so mark only the last tool result to stay within Anthropic's four breakpoints.
    const cacheControl = result[lastIndex].providerOptions?.anthropic?.cacheControl
    const lastResultIndex = last.content.findLastIndex((part) => part.type === 'tool-result')
    result[lastIndex] = {
      ...last,
      content: last.content.map((part, index) =>
        index === lastResultIndex && part.type === 'tool-result'
          ? {
              ...part,
              providerOptions: {
                ...part.providerOptions,
                anthropic: { ...part.providerOptions?.anthropic, cacheControl },
              },
            }
          : part
      ),
    }
    return result
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
