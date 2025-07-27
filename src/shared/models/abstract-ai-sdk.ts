import {
  APICallError,
  type CoreMessage,
  type CoreSystemMessage,
  type EmbeddingModel,
  experimental_generateImage as generateImage,
  generateText,
  type ImageModel,
  type LanguageModelUsage,
  type LanguageModelV1,
  type Provider,
  smoothStream,
  streamText,
  type ToolSet,
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
  maxTokens?: number
  providerOptions?: CoreSystemMessage['providerOptions']
}

interface ToolExecutionResult {
  toolCallId: string
  result: unknown
}

interface ToolCallInfo {
  toolCallId: string
  toolName: string
  args: unknown
}

type KnownStreamChunk =
  | { type: 'text-delta'; textDelta: string }
  | { type: 'reasoning'; textDelta: string }
  | { type: 'reasoning-signature'; signature: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-result'; toolCallId: string; result: unknown }
  | { type: 'file'; mimeType: string; base64: string }
  | { type: 'error'; error: unknown }

type UnknownStreamChunk = { type: string; [key: string]: unknown }

type StreamChunk = KnownStreamChunk | UnknownStreamChunk

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

  protected abstract getChatModel(options: CallChatCompletionOptions): LanguageModelV1

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

  public async chat(messages: CoreMessage[], options: CallChatCompletionOptions): Promise<StreamTextResult> {
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
    const dataUrls = result.images.map((image) => `data:${image.mimeType};base64,${image.base64}`)
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

  private processToolCalls(
    toolCalls: ToolCallInfo[],
    contentParts: MessageContentParts,
    options: CallChatCompletionOptions
  ): void {
    for (const toolCall of toolCalls) {
      this.addContentPart(
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: toolCall.args,
        },
        contentParts,
        options
      )
    }
  }

  private processToolResults(
    toolResults: ToolExecutionResult[],
    contentParts: MessageContentParts,
    options: CallChatCompletionOptions
  ): void {
    for (const toolResult of toolResults) {
      this.updateToolResultPart(toolResult, contentParts)
      options.onResultChange?.({ contentParts })
    }
  }

  private updateToolResultPart(toolResult: ToolExecutionResult, contentParts: MessageContentParts): void {
    const toolCallPart = contentParts.find((p) => p.type === 'tool-call' && p.toolCallId === toolResult.toolCallId) as
      | MessageToolCallPart
      | undefined

    if (toolCallPart) {
      if ((toolResult.result as unknown) instanceof Error) {
        console.debug('mcp tool execute error', toolResult.result)
        toolCallPart.state = 'error'
        toolCallPart.result = JSON.parse(JSON.stringify(toolResult.result))
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

  private addToolCallPart(toolCall: ToolCallInfo, contentParts: MessageContentParts): void {
    contentParts.push({
      type: 'tool-call',
      state: 'call',
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      args: toolCall.args,
    })
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

  private async processStreamChunk(
    chunk: StreamChunk,
    contentParts: MessageContentParts,
    currentTextPart: MessageTextPart | undefined,
    currentReasoningPart: MessageReasoningPart | undefined,
    _options: CallChatCompletionOptions
  ): Promise<{
    currentTextPart: MessageTextPart | undefined
    currentReasoningPart: MessageReasoningPart | undefined
  }> {
    // Process different chunk types using a type-safe switch statement
    const knownTypes = [
      'text-delta',
      'reasoning',
      'reasoning-signature',
      'tool-call',
      'tool-result',
      'file',
      'error',
    ] as const

    if (!knownTypes.includes(chunk.type as (typeof knownTypes)[number])) {
      // Handle unknown chunk types - just log them
      console.debug('Unknown chunk type:', chunk.type, chunk)
      return { currentTextPart, currentReasoningPart }
    }

    const knownChunk = chunk as KnownStreamChunk
    switch (knownChunk.type) {
      case 'text-delta': {
        // Critical timing logic: When we receive the first text chunk, the thinking phase has ended.
        // We must capture the thinking duration at this exact moment to ensure the timer
        // shows only the thinking time, not the total response generation time.
        if (currentReasoningPart && currentReasoningPart.startTime && !currentReasoningPart.duration) {
          currentReasoningPart.duration = Date.now() - currentReasoningPart.startTime
        }
        currentReasoningPart = undefined
        currentTextPart = this.createOrUpdateTextPart(knownChunk.textDelta, contentParts, currentTextPart)
        break
      }
      case 'reasoning': {
        currentTextPart = undefined
        currentReasoningPart = this.createOrUpdateReasoningPart(
          knownChunk.textDelta,
          contentParts,
          currentReasoningPart
        )
        break
      }
      case 'tool-call': {
        // Similar to text-delta: when tool calls begin, thinking has ended.
        // Capture the thinking duration before processing tool calls.
        if (currentReasoningPart && currentReasoningPart.startTime && !currentReasoningPart.duration) {
          currentReasoningPart.duration = Date.now() - currentReasoningPart.startTime
        }
        currentTextPart = undefined
        this.addToolCallPart(knownChunk, contentParts)
        break
      }
      case 'tool-result': {
        this.updateToolResultPart(knownChunk, contentParts)
        break
      }
      case 'file': {
        if (knownChunk.mimeType.startsWith('image/')) {
          currentTextPart = undefined
          await this.processImageFile(knownChunk.mimeType, knownChunk.base64, contentParts)
        }
        break
      }
      case 'error': {
        this.handleStreamError(knownChunk)
      }
    }

    return { currentTextPart, currentReasoningPart }
  }

  private handleError(error: unknown, context: string = ''): never {
    if (APICallError.isInstance(error)) {
      throw new ApiError(`Error from ${this.name}${context}`, error.responseBody)
    }
    if (error instanceof ChatboxAIAPIError) {
      throw error
    }
    throw new ApiError(`Error from ${this.name}${context}: ${error}`)
  }

  private handleStreamError(chunk: { type: 'error'; error: unknown }): never {
    this.handleError(chunk.error)
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
    usage: LanguageModelUsage | undefined,
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
      tokenCount: usage?.completionTokens,
      tokensUsed: usage?.totalTokens,
    })
    return { contentParts, usage }
  }

  private async handleNonStreamingCompletion<T extends ToolSet>(
    model: LanguageModelV1,
    coreMessages: CoreMessage[],
    options: CallChatCompletionOptions<T>,
    callSettings: CallSettings
  ): Promise<StreamTextResult> {
    const contentParts: MessageContentParts = []

    try {
      const result = await generateText({
        model,
        messages: coreMessages,
        maxSteps: Number.MAX_SAFE_INTEGER,
        tools: options.tools,
        abortSignal: options.signal,
        onStepFinish: async (event) => {
          // Process reasoning content
          if (event.reasoning) {
            this.addContentPart({ type: 'reasoning', text: event.reasoning }, contentParts, options)
          }

          // Process text in this step
          if (event.text) {
            this.addContentPart({ type: 'text', text: event.text }, contentParts, options)
          }

          // Process tool calls in this step
          if (event.toolCalls && event.toolCalls.length > 0) {
            this.processToolCalls(event.toolCalls, contentParts, options)
          }

          // Process tool results in this step
          if (event.toolResults && event.toolResults.length > 0) {
            this.processToolResults(event.toolResults, contentParts, options)
          }

          // Process files/images
          if (event.files && event.files.length > 0) {
            for (const file of event.files) {
              if (file.mimeType?.startsWith('image/') && file.base64) {
                await this.processImageFile(file.mimeType, file.base64, contentParts)
                options.onResultChange?.({ contentParts })
              }
            }
          }
        },
        ...callSettings,
      })

      return this.finalizeResult(contentParts, result.usage, options)
    } catch (error) {
      // Handle errors consistently with streaming mode
      this.handleError(error)
    }
  }

  private async handleStreamingCompletion<T extends ToolSet>(
    model: LanguageModelV1,
    coreMessages: CoreMessage[],
    options: CallChatCompletionOptions<T>,
    callSettings: CallSettings
  ): Promise<StreamTextResult> {
    const result = streamText({
      model,
      messages: coreMessages,
      maxSteps: Number.MAX_SAFE_INTEGER,
      tools: options.tools,
      abortSignal: options.signal,
      experimental_transform: smoothStream({
        delayInMs: 20, // optional: defaults to 10ms
        chunking: 'line', // optional: defaults to 'word'
      }),
      ...callSettings,
    })

    const contentParts: MessageContentParts = []
    let currentTextPart: MessageTextPart | undefined
    let currentReasoningPart: MessageReasoningPart | undefined

    try {
      for await (const chunk of result.fullStream) {
        console.debug('stream chunk', chunk)
        const chunkResult = await this.processStreamChunk(
          chunk,
          contentParts,
          currentTextPart,
          currentReasoningPart,
          options
        )
        currentTextPart = chunkResult.currentTextPart
        currentReasoningPart = chunkResult.currentReasoningPart

        if (chunk.type !== 'error') {
          options.onResultChange?.({ contentParts })
        }
      }
    } catch (error) {
      // Ensure reasoning parts get their duration set even if streaming is interrupted
      if (currentReasoningPart && currentReasoningPart.startTime && !currentReasoningPart.duration) {
        currentReasoningPart.duration = Date.now() - currentReasoningPart.startTime
      }
      throw error
    }

    const usage = await result.usage
    return this.finalizeResult(contentParts, usage, options)
  }

  private async _callChatCompletion<T extends ToolSet>(
    coreMessages: CoreMessage[],
    options: CallChatCompletionOptions<T>
  ): Promise<StreamTextResult> {
    const model = this.getChatModel(options)
    const callSettings = this.getCallSettings(options)

    if (this.options.stream === false) {
      return this.handleNonStreamingCompletion(model, coreMessages, options, callSettings)
    }

    return this.handleStreamingCompletion(model, coreMessages, options, callSettings)
  }
}
