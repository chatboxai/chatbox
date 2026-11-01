import type { LanguageModelV4 } from '@ai-sdk/provider'
import {
  APICallError,
  type EmbeddingModel,
  type FinishReason,
  generateImage,
  type ImageModel,
  type ImageModelProviderMetadata,
  isStepCount,
  type LanguageModelUsage,
  type ModelMessage,
  type PrepareStepFunction,
  type Provider,
  type ProviderMetadata,
  RetryError,
  simulateStreamingMiddleware,
  streamText,
  type TextStreamPart,
  type ToolCallRepairFunction,
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
import { getReasoningControlCapabilities, stripReasoningProviderOptions } from '../utils/reasoning-control'
import { normalizeCompletedResponse } from './completed-response-normalizer'
import {
  accumulateReasoningChunk,
  accumulateTextChunk,
  type ContentPartAccumulator,
  finalizeReasoningDuration,
} from './content-part-accumulator'
import { isExpectedGenerationError } from './error-classification'
import { ApiError, BaseError, ChatboxAIAPIError, NetworkError } from './errors'
import { toMessageUsage } from './message-usage'
import { wrapOpenAICompatibleNonStreamingModel } from './openai-compatible-non-streaming'
import { stopWhenPersistentToolCallPause } from './persistent-tool-call-pause'
import { bindReplaySource } from './provider-part-metadata'
import { createRetryableChatModel } from './retryable-chat-model'
import { simulateStreamingWithTextReplayMetadataMiddleware, textReplayMetadataMiddleware } from './text-replay-metadata'
import { repairToolCallJson } from './tool-call-json-repair'
import type {
  CallChatCompletionOptions,
  CallSettings,
  ChatStreamOptions,
  ModelInterface,
  ModelStatus,
  ModelStreamPart,
} from './types'
import { isKimiFixedSamplingModel } from './utils/kimi'
import { extractStreamErrorMessage, extractStreamErrorStatusCode } from './utils/stream-error-message'

export type { CallSettings } from './types'

function sanitizeCallSettings(callSettings: CallSettings): CallSettings {
  const maxOutputTokens = callSettings.maxOutputTokens
  if (maxOutputTokens === undefined || (Number.isInteger(maxOutputTokens) && maxOutputTokens >= 1)) {
    return callSettings
  }

  const sanitized = { ...callSettings }
  delete sanitized.maxOutputTokens
  return sanitized
}

export { isRetryableStatusError } from './retryable-chat-model'

class StatusQueue {
  private queue: ModelStatus[] = []
  private version = 0
  private waiters = new Set<() => void>()

  push(status: ModelStatus): void {
    this.queue.push(status)
    this.version += 1
    for (const waiter of this.waiters) {
      waiter()
    }
    this.waiters.clear()
  }

  shift(): ModelStatus | undefined {
    return this.queue.shift()
  }

  getVersion(): number {
    return this.version
  }

  waitForChange(version: number): { promise: Promise<void>; cancel: () => void } {
    if (this.version !== version || this.queue.length > 0) {
      return { promise: Promise.resolve(), cancel: () => undefined }
    }

    let resolveWaiter: (() => void) | undefined
    const promise = new Promise<void>((resolve) => {
      resolveWaiter = resolve
      this.waiters.add(resolve)
    })

    return {
      promise,
      cancel: () => {
        if (resolveWaiter) {
          this.waiters.delete(resolveWaiter)
        }
      },
    }
  }
}

interface ToolExecutionResult {
  toolCallId: string
  result: unknown
  isError?: boolean
  providerMetadata?: ProviderMetadata
}

export default abstract class AbstractAISDKModel implements ModelInterface {
  public name = 'AI SDK Model'
  public injectDefaultMetadata = true
  public modelId = ''
  public reasoningReplaySource?: string

  public get apiStyle(): ProviderModelInfo['apiStyle'] {
    return this.options.model.apiStyle
  }

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
  ): Pick<Provider, 'languageModel'> & Partial<Pick<Provider, 'embeddingModel' | 'imageModel'>>

  protected abstract getChatModel(options: CallChatCompletionOptions): LanguageModelV4

  private prepareChatModel(model: LanguageModelV4): LanguageModelV4 {
    if (this.apiStyle === 'google') {
      return wrapLanguageModel({
        model,
        middleware:
          this.options.stream === false
            ? simulateStreamingWithTextReplayMetadataMiddleware
            : textReplayMetadataMiddleware,
      })
    }
    if (this.options.stream !== false) return model

    if (this.apiStyle === 'openai') {
      return wrapOpenAICompatibleNonStreamingModel(model)
    }

    return wrapLanguageModel({
      model,
      middleware: simulateStreamingMiddleware(),
    })
  }

  protected getImageModel(): ImageModel | null {
    return null
  }

  protected getImageGenerationOptions(aspectRatio?: string): {
    size?: `${number}x${number}`
    aspectRatio?: `${number}:${number}`
  } {
    if (!aspectRatio || aspectRatio === 'auto') return {}
    return { aspectRatio: aspectRatio as `${number}:${number}` }
  }

  protected getImageGenerationPrompt(params: {
    prompt: string
    images?: { imageUrl: string }[]
  }): string | { text: string; images: string[] } {
    return params.prompt
  }

  protected getMaxImagesPerGenerationRequest(): number | undefined {
    return undefined
  }

  protected getGeneratedImageMediaType(
    defaultMediaType: string,
    _index: number,
    _providerMetadata: ImageModelProviderMetadata
  ): string {
    return defaultMediaType
  }

  protected getTextEmbeddingModel(options: CallChatCompletionOptions): EmbeddingModel | null {
    const provider = this.getProvider(options)
    if (provider.embeddingModel) {
      return provider.embeddingModel(this.options.model.modelId)
    }
    return null
  }

  public isSupportSystemMessage() {
    return true
  }

  public normalizeCompletedResponse(
    contentParts: MessageContentParts,
    finishReason: string | undefined
  ): MessageContentParts {
    return normalizeCompletedResponse(contentParts, finishReason, this.modelId)
  }

  protected getCallSettings(_options: CallChatCompletionOptions): CallSettings {
    return {}
  }

  // Resolves call settings while ensuring reasoning provider options are never sent
  // to a model that does not support reasoning control. Stale options can linger on a
  // session after switching from a reasoning-capable model, so we strip them at the
  // request edge using the same provider + hard-coded model-id logic as the UI control
  // (the generic `reasoning` capability flag is unreliable — some reasoning models, e.g.
  // qwen3.x, ship without it in their registry metadata). When the provider is unknown we
  // leave options untouched to avoid stripping anything we cannot positively classify.
  //
  // Kimi K2/K3 families pin temperature and top_p. Moonshot rejects any other
  // value, so those fields are dropped here after subclass getCallSettings so
  // every transport (Moonshot, aggregators, custom OpenAI hosts) sees the same
  // request shape.
  private resolveCallSettings(options: CallChatCompletionOptions): CallSettings {
    const providerId = this.options.model.providerId
    const shouldStrip =
      !!providerId &&
      !!options.providerOptions &&
      !getReasoningControlCapabilities(providerId, this.options.model).supported
    const sanitizedOptions = shouldStrip
      ? { ...options, providerOptions: stripReasoningProviderOptions(options.providerOptions) }
      : options
    const settings = this.getCallSettings(sanitizedOptions)
    if (!isKimiFixedSamplingModel(this.options.model.modelId, providerId)) {
      return sanitizeCallSettings(settings)
    }
    return sanitizeCallSettings({
      maxOutputTokens: settings.maxOutputTokens,
      providerOptions: settings.providerOptions,
      system: settings.system,
    })
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

      // Provider/API/network failures are expected user-facing outcomes. Report only
      // unexpected client/runtime failures, and never attach prompts or request options.
      if (!isExpectedGenerationError(e)) {
        const providerId = this.options.model.providerId
        const providerTag = providerId?.startsWith('custom-provider-') ? 'custom' : providerId || 'unknown'
        this.dependencies.sentry.withScope((scope) => {
          scope.setTag('component', 'ai-provider')
          scope.setTag('operation', 'chat_completion')
          scope.setTag('error_domain', 'ai-provider')
          scope.setTag('error_operation', 'chat_completion')
          scope.setTag('error_priority', 'high')
          scope.setTag('error_handled', 'true')
          scope.setTag('provider_name', providerTag)
          scope.setExtra('messageCount', messages.length)
          this.dependencies.sentry.captureException(e)
        })
      }
      throw e
    }
  }

  public async *chatStream<T extends ToolSet>(
    messages: ModelMessage[],
    options: ChatStreamOptions
  ): AsyncGenerator<ModelStreamPart<T>> {
    const baseModel = this.prepareChatModel(this.getChatModel(options))
    const callSettings = this.resolveCallSettings(options)
    const basePrepareStep = options.prepareStep as PrepareStepFunction<T> | undefined
    const onRequestResolved = options.onRequestResolved
    const prepareStep: PrepareStepFunction<T> | undefined =
      basePrepareStep || onRequestResolved
        ? async (stepOptions) => {
            // Each preparation starts from the full transcript so temporary step
            // messages, such as image injections, do not accumulate across steps.
            const messages = [...stepOptions.initialMessages, ...stepOptions.responseMessages]
            const prepared = await basePrepareStep?.({ ...stepOptions, messages })
            const stepMessages = prepared?.messages ?? messages
            const allTools = (options.tools ?? {}) as T
            const activeToolNames = prepared?.activeTools ? new Set(prepared.activeTools.map(String)) : undefined
            const effectiveTools = activeToolNames
              ? (Object.fromEntries(
                  Object.entries(allTools).filter(([toolName]) => activeToolNames.has(toolName))
                ) as T)
              : allTools
            await onRequestResolved?.({
              callSettings,
              modelMessages: stepMessages,
              tools: effectiveTools,
              stream: this.options.stream !== false,
            })
            return { ...(prepared ?? {}), messages: stepMessages }
          }
        : undefined

    const statusQueue = new StatusQueue()

    const model = createRetryableChatModel(baseModel, (status) => statusQueue.push(status))

    const result = streamText({
      model,
      messages,
      // Chatbox lets users author system prompts and preserves their position in chat history.
      allowSystemInMessages: true,
      stopWhen: [isStepCount(options.maxSteps || Number.MAX_SAFE_INTEGER), stopWhenPersistentToolCallPause<T>()],
      tools: options.tools as T | undefined,
      prepareStep,
      experimental_repairToolCall: repairToolCallJson as ToolCallRepairFunction<T>,
      abortSignal: options.signal,
      ...callSettings,
      // Chatbox owns request diagnostics; SDK tracing result promises need a Node consumer.
      telemetry: { isEnabled: false },
      // The model wrapper owns retry limits, backoff and UI status for HTTP and
      // network failures. Keep SDK retries disabled to avoid multiplying attempts.
      maxRetries: 0,
    })

    const streamIterator = result.stream[Symbol.asyncIterator]()
    const readNextChunk = () => {
      const nextChunk = streamIterator.next()
      // A consumer can pause at yield while the prefetched read rejects on abort.
      // Observe it immediately and keep the original promise for the next read.
      void nextChunk.catch(() => {})
      return nextChunk
    }
    let nextChunk = readNextChunk()

    try {
      while (true) {
        let status = statusQueue.shift()
        while (status) {
          yield { type: 'status', status }
          status = statusQueue.shift()
        }

        const currentVersion = statusQueue.getVersion()
        const statusWait = statusQueue.waitForChange(currentVersion)
        let next: { type: 'chunk'; iteration: IteratorResult<TextStreamPart<T>> } | { type: 'status' }
        try {
          next = await Promise.race([
            nextChunk.then((iteration: IteratorResult<TextStreamPart<T>>) => ({
              type: 'chunk' as const,
              iteration,
            })),
            statusWait.promise.then(() => ({ type: 'status' as const })),
          ])
        } finally {
          statusWait.cancel()
        }

        if (next.type === 'status') {
          continue
        }

        if (next.iteration.done) {
          break
        }

        const chunk = next.iteration.value
        nextChunk = readNextChunk()
        if (chunk.type === 'error') {
          this.handleError(chunk.error)
        }

        yield this.scopeReasoningReplayMetadata(chunk)
      }

      let status = statusQueue.shift()
      while (status) {
        yield { type: 'status', status }
        status = statusQueue.shift()
      }
    } finally {
      // Consumers may close this generator early (Stop drain, chunk-processing failure).
      // Propagate the closure to the SDK stream, otherwise the prefetched read keeps
      // provider/tool work alive after the message was already finalized.
      await streamIterator.return?.().catch(() => {})
    }
  }

  public async paint(
    params: {
      prompt: string
      images?: { imageUrl: string }[]
      num: number
      aspectRatio?: string
    },
    signal?: AbortSignal,
    callback?: (picBase64: string) => void | Promise<void>
  ): Promise<string[]> {
    const imageModel = this.getImageModel()
    if (!imageModel) {
      throw new ApiError('Provider doesnt support image generation')
    }

    const maxImagesPerRequest = this.getMaxImagesPerGenerationRequest()
    const requestSizes = maxImagesPerRequest
      ? Array.from({ length: Math.ceil(params.num / maxImagesPerRequest) }, (_, index) =>
          Math.min(maxImagesPerRequest, params.num - index * maxImagesPerRequest)
        )
      : [params.num]
    const dataUrls: string[] = []

    for (const requestSize of requestSizes) {
      const result = await generateImage({
        model: imageModel,
        prompt: this.getImageGenerationPrompt(params),
        n: requestSize,
        ...this.getImageGenerationOptions(params.aspectRatio),
        abortSignal: signal,
        // Image generation is billable; network-error retries could double-charge.
        maxRetries: 0,
      })
      for (const [index, image] of result.images.entries()) {
        const mediaType = this.getGeneratedImageMediaType(image.mediaType, index, result.providerMetadata ?? {})
        const dataUrl = `data:${mediaType};base64,${image.base64}`
        await callback?.(dataUrl)
        dataUrls.push(dataUrl)
      }
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
          providerMetadata: toolCall.providerMetadata,
          providerExecuted: toolCall.providerExecuted,
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
        providerMetadata: toolResult.providerMetadata,
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
      const existing = contentParts.find(
        (part): part is MessageToolCallPart => part.type === 'tool-call' && part.toolCallId === toolError.toolCallId
      )
      if (!existing) {
        contentParts.push({
          type: 'tool-call',
          state: 'call',
          toolCallId: toolError.toolCallId,
          toolName: toolError.toolName,
          args: toolError.input,
          providerMetadata: toolError.providerMetadata,
          providerExecuted: toolError.providerExecuted,
        })
      }

      const serializedError =
        toolError.error instanceof Error
          ? {
              name: toolError.error.name,
              message: toolError.error.message,
              stack: toolError.error.stack,
              ...(toolError.error instanceof BaseError ? { errorCode: toolError.error.code } : {}),
            }
          : toolError.error
      const errorCode = toolError.error instanceof BaseError ? toolError.error.code : undefined
      const mappedResult: ToolExecutionResult = {
        toolCallId: toolError.toolCallId,
        result: {
          error: serializedError,
          ...(errorCode ? { errorCode } : {}),
          input: toolError.input,
          toolName: toolError.toolName,
        },
        isError: true,
        providerMetadata: existing ? toolError.providerMetadata : undefined,
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
        toolCallPart.resultProviderMetadata = toolResult.providerMetadata
      } else {
        toolCallPart.state = 'result'
        toolCallPart.result = toolResult.result
        toolCallPart.resultProviderMetadata = toolResult.providerMetadata
      }
    }
  }

  private scopeReasoningReplayMetadata<T extends ToolSet>(chunk: TextStreamPart<T>): TextStreamPart<T> {
    if (chunk.type !== 'reasoning-start' && chunk.type !== 'reasoning-delta' && chunk.type !== 'reasoning-end') {
      return chunk
    }
    return { ...chunk, providerMetadata: bindReplaySource(chunk.providerMetadata, this.reasoningReplaySource) }
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
    pendingReasoningText: string,
    _options: CallChatCompletionOptions
  ): Promise<{
    currentTextPart: MessageTextPart | undefined
    currentReasoningPart: MessageReasoningPart | undefined
    /**
     * Whitespace-only reasoning deltas seen before the current block has
     * produced a part; prepended when the block materializes so signed thinking
     * round-trips byte-for-byte (see the core stream-chunk-processor).
     */
    pendingReasoningText: string
  }> {
    switch (chunk.type) {
      case 'text-end':
      case 'text-delta':
      case 'reasoning-start':
      case 'reasoning-delta':
      case 'reasoning-end': {
        const accumulator: ContentPartAccumulator = {
          contentParts,
          currentTextPart,
          currentReasoningPart,
          pendingReasoningText,
        }
        if (chunk.type === 'text-delta' || chunk.type === 'text-end') {
          accumulateTextChunk(accumulator, chunk)
        } else {
          accumulateReasoningChunk(accumulator, chunk)
        }
        return {
          currentTextPart: accumulator.currentTextPart,
          currentReasoningPart: accumulator.currentReasoningPart,
          pendingReasoningText: accumulator.pendingReasoningText,
        }
      }

      case 'tool-call':
        finalizeReasoningDuration(currentReasoningPart)
        this.processToolCalls([chunk], contentParts, _options)
        return {
          currentTextPart: undefined,
          currentReasoningPart: undefined,
          pendingReasoningText: '',
        }

      case 'tool-result':
        this.processToolResults([chunk], contentParts, _options)
        break
      case 'tool-error':
        finalizeReasoningDuration(currentReasoningPart)
        this.processToolErrors([chunk], contentParts, _options)
        break
      case 'file':
        if (chunk.file.mediaType?.startsWith('image/') && chunk.file.base64) {
          await this.processImageFile(chunk.file.mediaType, chunk.file.base64, contentParts)
          return {
            currentTextPart: undefined,
            currentReasoningPart: undefined,
            pendingReasoningText: '',
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

    return { currentTextPart, currentReasoningPart, pendingReasoningText: '' }
  }

  private handleError(error: unknown, context: string = ''): never {
    // When a retried attempt fails again, ai-retry wraps the failure in the AI
    // SDK's RetryError; unwrap so the original error's message/statusCode/
    // responseBody reach the UI instead of the generic "Failed after N attempts".
    // (Relies on RetryError.lastError holding the raw thrown error — re-check on
    // ai-retry upgrades.)
    if (
      RetryError.isInstance(error) &&
      (error.lastError instanceof Error || APICallError.isInstance(error.lastError))
    ) {
      return this.handleError(error.lastError, context)
    }
    if (APICallError.isInstance(error)) {
      const responseBody = this.sanitizeResponseBody(error.statusCode, error.responseBody)
      throw new ApiError(`Error from ${this.name}${context}`, responseBody, error.statusCode)
    }
    if (error instanceof ApiError || error instanceof NetworkError) {
      throw error
    }
    if (error instanceof ChatboxAIAPIError) {
      throw error
    }
    // Mid-stream provider errors are often plain objects ({ message, type, code });
    // interpolating them yields "[object Object]".
    throw new ApiError(
      `Error from ${this.name}${context}: ${extractStreamErrorMessage(error)}`,
      undefined,
      extractStreamErrorStatusCode(error)
    )
  }

  /**
   * Sanitize HTML error pages (e.g., 502/503/504 gateway errors) from response bodies.
   */
  private sanitizeResponseBody(statusCode: number | undefined, responseBody: string | undefined): string {
    if (!responseBody) return ''
    const trimmed = responseBody.trimStart().toLowerCase()
    if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
      const statusMessages: Record<number, string> = {
        502: 'Bad Gateway',
        503: 'Service Unavailable',
        504: 'Gateway Timeout',
      }
      const statusMsg = statusCode ? statusMessages[statusCode] || `HTTP ${statusCode}` : 'Server Error'
      return `${statusMsg} - The server returned an HTML error page instead of a valid response.`
    }
    return responseBody
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

    const normalizedContentParts = this.normalizeCompletedResponse(contentParts, result.finishReason)

    options.onResultChange?.({
      contentParts: normalizedContentParts,
      tokenCount: result.usage?.outputTokens,
      tokensUsed: result.usage?.totalTokens,
    })
    return {
      contentParts: normalizedContentParts,
      usage: result.usage ? toMessageUsage(result.usage) : undefined,
      finishReason: result.finishReason,
    }
  }

  private async handleStreamingCompletion<T extends ToolSet>(
    model: LanguageModelV4,
    coreMessages: ModelMessage[],
    options: CallChatCompletionOptions<T>,
    callSettings: CallSettings
  ): Promise<StreamTextResult> {
    const result = streamText({
      model,
      messages: coreMessages,
      allowSystemInMessages: true,
      stopWhen: [isStepCount(options.maxSteps || Number.MAX_SAFE_INTEGER), stopWhenPersistentToolCallPause<T>()],
      tools: options.tools,
      experimental_repairToolCall: repairToolCallJson as ToolCallRepairFunction<T>,
      abortSignal: options.signal,
      ...callSettings,
      telemetry: { isEnabled: false },
      // The model wrapper owns retry limits, backoff and UI status for HTTP and
      // network failures. Keep SDK retries disabled to avoid multiplying attempts.
      maxRetries: 0,
    })

    const contentParts: MessageContentParts = []
    let currentTextPart: MessageTextPart | undefined
    let currentReasoningPart: MessageReasoningPart | undefined
    let pendingReasoningText = ''

    try {
      for await (const chunk of result.stream) {
        // console.debug('stream chunk', chunk)

        // Handle error chunks
        if (chunk.type === 'error') {
          this.handleError(chunk.error)
        }

        const chunkResult = await this.processStreamChunk(
          this.scopeReasoningReplayMetadata(chunk),
          contentParts,
          currentTextPart,
          currentReasoningPart,
          pendingReasoningText,
          options
        )
        currentTextPart = chunkResult.currentTextPart
        currentReasoningPart = chunkResult.currentReasoningPart
        pendingReasoningText = chunkResult.pendingReasoningText

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
    const baseModel = this.prepareChatModel(this.getChatModel(options))
    const callSettings = this.resolveCallSettings(options)

    const model = createRetryableChatModel(baseModel, (status) => options.onStatusChange?.(status))

    try {
      const result = await this.handleStreamingCompletion(model, coreMessages, options, callSettings)
      options.onStatusChange?.(null)
      return result
    } catch (error) {
      options.onStatusChange?.(null)
      throw error
    }
  }
}
