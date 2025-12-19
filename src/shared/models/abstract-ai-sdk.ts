import type { LanguageModelV2 } from '@ai-sdk/provider'
import {
  APICallError,
  type EmbeddingModel,
  type FinishReason,
  experimental_generateImage as generateImage,
  type ImageModel,
  type JSONValue,
  type LanguageModelUsage,
  type ModelMessage,
  type Provider,
  simulateStreamingMiddleware,
  stepCountIs,
  streamText,
  type TextStreamPart,
  type ToolSet,
  type TypedToolCall,
  type TypedToolError,
  type TypedToolResult,
  wrapLanguageModel,
} from 'ai'
import type {
  MessageContentParts,
  MessageReasoningPart,
  MessageTextPart,
  MessageToolCallPart,
  ProviderModelInfo,
  StreamTextResult,
} from '../types'
import type { ModelDependencies } from '../types/adapters'
import { ApiError, ChatboxAIAPIError } from './errors'
import type { CallChatCompletionOptions, ModelInterface } from './types'

// ai sdk CallSettings类型的子集
export interface CallSettings {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  providerOptions?: Record<string, Record<string, JSONValue>>
}

interface ToolExecutionResult {
  toolCallId: string
  result: unknown
  isError?: boolean
}

export default abstract class AbstractAISDKModel implements ModelInterface {
  public name = 'AI SDK Model'
  public injectDefaultMetadata = true
  public modelId = ''

  public isSupportToolUse() {
    return this.options.model.capabilities?.includes('tool_use') || false
  }
  public isSupportVision() {
    return this.options.model.capabilities?.includes('vision') || false
  }
  public isSupportReasoning() {
    return this.options.model.capabilities?.includes('reasoning') || false
  }

  static isSupportTextEmbedding() {
    return false
  }

  public constructor(
    public options: { model: ProviderModelInfo; stream?: boolean },
    protected dependencies: ModelDependencies
  ) {
    this.modelId = options.model.modelId
  }

  protected abstract getProvider(
    options: CallChatCompletionOptions
  ): Pick<Provider, 'languageModel'> & Partial<Pick<Provider, 'textEmbeddingModel' | 'imageModel'>>

  protected abstract getChatModel(options: CallChatCompletionOptions): LanguageModelV2

  protected getImageModel(): ImageModel | null {
    return null
  }

  protected getTextEmbeddingModel(options: CallChatCompletionOptions): EmbeddingModel<string> | null {
    const provider = this.getProvider(options)
    if (provider.textEmbeddingModel) {
      return provider.textEmbeddingModel(this.options.model.modelId)
    }
    return null
  }

  public isSupportSystemMessage() {
    return true
  }

  protected getCallSettings(_options: CallChatCompletionOptions): CallSettings {
    return {}
  }

  public async chat(messages: ModelMessage[], options: CallChatCompletionOptions): Promise<StreamTextResult> {
    try {
      return await this._callChatCompletion(messages, options)
    } catch (e) {
      if (e instanceof ChatboxAIAPIError) {
        throw e
      }
      // 如果当前模型不支持图片输入，抛出对应的错误
      if (
        e instanceof ApiError &&
        e.message.includes('Invalid content type. image_url is only supported by certain models.')
      ) {
        // 根据当前 IP，判断是否在错误中推荐 Chatbox AI 4
        const remoteConfig = this.dependencies.getRemoteConfig()
        if (remoteConfig.setting_chatboxai_first) {
          throw ChatboxAIAPIError.fromCodeName('model_not_support_image', 'model_not_support_image')
        } else {
          throw ChatboxAIAPIError.fromCodeName('model_not_support_image', 'model_not_support_image_2')
        }
      }

      // 添加请求信息到 Sentry
      this.dependencies.sentry.withScope((scope) => {
        scope.setTag('provider_name', this.name)
        scope.setExtra('messages', JSON.stringify(messages))
        scope.setExtra('options', JSON.stringify(options))
        this.dependencies.sentry.captureException(e)
      })
      throw e
    }
  }

  public async paint(
    prompt: string,
    num: number,
    callback?: (picBase64: string) => void,
    signal?: AbortSignal
  ): Promise<string[]> {
    const imageModel = this.getImageModel()
    if (!imageModel) {
      throw new ApiError('Provider doesnt support image generation')
    }
    const result = await generateImage({
      model: imageModel,
      prompt,
      n: num,
      abortSignal: signal,
    })
    const dataUrls = result.images.map((image) => `data:${image.mediaType};base64,${image.base64}`)
    for (const dataUrl of dataUrls) {
      callback?.(dataUrl)
    }
    return dataUrls
  }

  /**
   * Adds a content part to the message and handles timing for reasoning parts
   * @param contentPart - The content part to add
   * @param contentParts - Array of existing content parts
   * @param options - Call options with result change callback
   */
  private addContentPart(
    contentPart: MessageContentParts[number],
    contentParts: MessageContentParts,
    options: CallChatCompletionOptions
  ): void {
    // Handle timing for reasoning parts in non-streaming mode
    if (contentPart.type === 'reasoning') {
      const reasoningPart = contentPart as MessageReasoningPart
      const now = Date.now()
      reasoningPart.startTime = now
      // In non-streaming mode, reasoning content arrives complete, so we set
      // a minimal duration to indicate the thinking process occurred
      reasoningPart.duration = 1
    }
    contentParts.push(contentPart)
    options.onResultChange?.({ contentParts })
  }

  private processToolCalls<T extends ToolSet>(
    toolCalls: TypedToolCall<T>[],
    contentParts: MessageContentParts,
    options: CallChatCompletionOptions
  ): void {
    for (const toolCall of toolCalls) {
      const args = toolCall.input
      this.addContentPart(
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args,
        },
        contentParts,
        options
      )
    }
  }

  private processToolResults<T extends ToolSet>(
    toolResults: TypedToolResult<T>[],
    contentParts: MessageContentParts,
    options: CallChatCompletionOptions
  ): void {
    for (const toolResult of toolResults) {
      const result = toolResult.output
      const mappedResult: ToolExecutionResult = {
        toolCallId: toolResult.toolCallId,
        result,
      }
      this.updateToolResultPart(mappedResult, contentParts)
      options.onResultChange?.({ contentParts })
    }
  }

  private processToolErrors<T extends ToolSet>(
    toolErrors: TypedToolError<T>[],
    contentParts: MessageContentParts,
    options: CallChatCompletionOptions
  ): void {
    for (const toolError of toolErrors) {
      const serializedError =
        toolError.error instanceof Error
          ? {
              name: toolError.error.name,
              message: toolError.error.message,
              stack: toolError.error.stack,
            }
          : toolError.error
      const mappedResult: ToolExecutionResult = {
        toolCallId: toolError.toolCallId,
        result: {
          error: serializedError,
          input: toolError.input,
          toolName: toolError.toolName,
        },
        isError: true,
      }
      this.updateToolResultPart(mappedResult, contentParts)
      options.onResultChange?.({ contentParts })
    }
  }

  private updateToolResultPart(toolResult: ToolExecutionResult, contentParts: MessageContentParts): void {
    const toolCallPart = contentParts.find((p) => p.type === 'tool-call' && p.toolCallId === toolResult.toolCallId) as
      | MessageToolCallPart
      | undefined

    if (toolCallPart) {
      const isError = toolResult.isError || (toolResult.result as unknown) instanceof Error
      if (isError) {
        if ((toolResult.result as unknown) instanceof Error) {
          const error = toolResult.result as Error
          console.debug('mcp tool execute error', error)
          toolCallPart.result = {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        } else {
          console.debug('mcp tool execute error', toolResult.result)
          toolCallPart.result = toolResult.result ?? {
            message: 'Unknown tool error',
          }
        }
        toolCallPart.state = 'error'
      } else {
        toolCallPart.state = 'result'
        toolCallPart.result = toolResult.result
      }
    }
  }

  private createOrUpdateContentPart<T extends MessageTextPart | MessageReasoningPart>(
    textDelta: string,
    contentParts: MessageContentParts,
    currentPart: T | undefined,
    type: T['type']
  ): T {
    if (!currentPart) {
      currentPart = { type, text: '' } as T
      contentParts.push(currentPart)
    }
    currentPart.text += textDelta
    return currentPart
  }

  private createOrUpdateTextPart(
    textDelta: string,
    contentParts: MessageContentParts,
    currentTextPart: MessageTextPart | undefined
  ): MessageTextPart {
    return this.createOrUpdateContentPart(textDelta, contentParts, currentTextPart, 'text')
  }

  /**
   * Creates or updates a reasoning part with timing information for streaming responses
   * @param textDelta - New text to append to the reasoning content
   * @param contentParts - Array of message content parts
   * @param currentReasoningPart - Existing reasoning part to update, if any
   * @returns The updated or newly created reasoning part
   */
  private createOrUpdateReasoningPart(
    textDelta: string,
    contentParts: MessageContentParts,
    currentReasoningPart: MessageReasoningPart | undefined
  ): MessageReasoningPart {
    if (!currentReasoningPart) {
      // Create new reasoning part with start time for timer tracking in streaming mode
      currentReasoningPart = {
        type: 'reasoning',
        text: '',
        startTime: Date.now(), // Capture when thinking begins
      }
      contentParts.push(currentReasoningPart)
    }
    currentReasoningPart.text += textDelta
    return currentReasoningPart
  }

  private async processImageFile(
    mimeType: string,
    base64: string,
    contentParts: MessageContentParts,
    responseType: 'response' = 'response'
  ): Promise<void> {
    const storageKey = await this.dependencies.storage.saveImage(responseType, `data:${mimeType};base64,${base64}`)
    contentParts.push({ type: 'image', storageKey })
  }

  private async processStreamChunk<T extends ToolSet>(
    chunk: TextStreamPart<T>,
    contentParts: MessageContentParts,
    currentTextPart: MessageTextPart | undefined,
    currentReasoningPart: MessageReasoningPart | undefined,
    _options: CallChatCompletionOptions
  ): Promise<{
    currentTextPart: MessageTextPart | undefined
    currentReasoningPart: MessageReasoningPart | undefined
  }> {
    // Finalize reasoning duration when transitioning to other content types
    const finalizeReasoningDuration = () => {
      if (currentReasoningPart?.startTime && !currentReasoningPart.duration) {
        currentReasoningPart.duration = Date.now() - currentReasoningPart.startTime
      }
    }

    switch (chunk.type) {
      case 'text-delta':
        finalizeReasoningDuration()
        // clear current reasoning part
        return {
          currentTextPart: this.createOrUpdateTextPart(chunk.text, contentParts, currentTextPart),
          currentReasoningPart: undefined,
        }

      case 'reasoning-delta':
        // 部分提供方会随文本返回空的reasoning，防止分割正常的content
        if (chunk.text.trim()) {
          return {
            currentTextPart: undefined,
            currentReasoningPart: this.createOrUpdateReasoningPart(chunk.text, contentParts, currentReasoningPart),
          }
        }
        break

      case 'tool-call':
        finalizeReasoningDuration()
        this.processToolCalls([chunk], contentParts, _options)
        return {
          currentTextPart: undefined,
          currentReasoningPart: undefined,
        }

      case 'tool-result':
        this.processToolResults([chunk], contentParts, _options)
        break
      case 'tool-error':
        finalizeReasoningDuration()
        this.processToolErrors([chunk], contentParts, _options)
        break

      case 'file':
        if (chunk.file.mediaType?.startsWith('image/') && chunk.file.base64) {
          await this.processImageFile(chunk.file.mediaType, chunk.file.base64, contentParts)
          return {
            currentTextPart: undefined,
            currentReasoningPart: undefined,
          }
        }
        break
      case 'error':
        this.handleError(chunk.error)
        break
      case 'finish':
        break
      default:
        break
    }

    return { currentTextPart, currentReasoningPart }
  }

  private handleError(error: unknown, context: string = ''): never {
    if (APICallError.isInstance(error)) {
      throw new ApiError(`Error from ${this.name}${context}`, error.responseBody)
    }
    if (error instanceof ApiError) {
      throw error
    }
    if (error instanceof ChatboxAIAPIError) {
      throw error
    }
    throw new ApiError(`Error from ${this.name}${context}: ${error}`)
  }

  /**
   * Finalizes the result and ensures all reasoning parts have duration set
   * This is a fallback to ensure timing is captured even if not set during streaming
   * @param contentParts - Array of message content parts
   * @param usage - Token usage information
   * @param options - Call options with result change callback
   * @returns The finalized stream text result
   */
  private finalizeResult(
    contentParts: MessageContentParts,
    result: {
      usage?: LanguageModelUsage
      finishReason?: FinishReason
    },
    options: CallChatCompletionOptions
  ): StreamTextResult {
    // Fallback: Set final duration for any reasoning parts that don't have it yet
    // This should rarely be needed since we capture duration at transition points,
    // but provides safety for edge cases
    const now = Date.now()
    for (const part of contentParts) {
      if (part.type === 'reasoning' && part.startTime && !part.duration) {
        part.duration = now - part.startTime
      }
    }

    options.onResultChange?.({
      contentParts,
      tokenCount: result.usage?.outputTokens,
      tokensUsed: result.usage?.totalTokens,
    })
    return { contentParts, usage: result.usage, finishReason: result.finishReason }
  }

  private async handleStreamingCompletion<T extends ToolSet>(
    model: LanguageModelV2,
    coreMessages: ModelMessage[],
    options: CallChatCompletionOptions<T>,
    callSettings: CallSettings
  ): Promise<StreamTextResult> {
    const result = streamText({
      model,
      messages: coreMessages,
      stopWhen: stepCountIs(options.maxSteps || Number.MAX_SAFE_INTEGER),
      tools: options.tools,
      abortSignal: options.signal,
      // experimental_transform: smoothStream({
      //   delayInMs: 10, // optional: defaults to 10ms
      //   chunking: 'word', // optional: defaults to 'word'
      // }),
      ...callSettings,
    })

    const contentParts: MessageContentParts = []
    let currentTextPart: MessageTextPart | undefined
    let currentReasoningPart: MessageReasoningPart | undefined

    try {
      for await (const chunk of result.fullStream) {
        // console.debug('stream chunk', chunk)

        // Handle error chunks
        if (chunk.type === 'error') {
          this.handleError(chunk.error)
        }

        const chunkResult = await this.processStreamChunk(
          chunk,
          contentParts,
          currentTextPart,
          currentReasoningPart,
          options
        )
        currentTextPart = chunkResult.currentTextPart
        currentReasoningPart = chunkResult.currentReasoningPart

        options.onResultChange?.({ contentParts })
      }
    } catch (error) {
      // Ensure reasoning parts get their duration set even if streaming is interrupted
      if (currentReasoningPart?.startTime && !currentReasoningPart.duration) {
        currentReasoningPart.duration = Date.now() - currentReasoningPart.startTime
      }
      throw error
    }

    return this.finalizeResult(
      contentParts,
      {
        usage: await result.totalUsage,
        finishReason: await result.finishReason,
      },
      options
    )
  }

  private async _callChatCompletion<T extends ToolSet>(
    coreMessages: ModelMessage[],
    options: CallChatCompletionOptions<T>
  ): Promise<StreamTextResult> {
    let model = this.getChatModel(options)
    const callSettings = this.getCallSettings(options)

    if (this.options.stream === false) {
      model = wrapLanguageModel({
        model,
        middleware: simulateStreamingMiddleware(),
      })
    }

    return await this.handleStreamingCompletion(model, coreMessages, options, callSettings)
  }
}
