import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
  type GoogleGenerativeAIProviderOptions,
} from '@ai-sdk/google'
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { type ModelMessage, streamText, type ToolSet } from 'ai'
import { getRegistryModelMeta } from '../../../model-registry'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import { addAnthropicCacheControl } from '../../../models/anthropic-cache'
import { getOpenAICompatibleProviderOptionsKey } from '../../../models/openai-compatible'
import type {
  CallChatCompletionOptions,
  ChatStreamOptions,
  ModelInterface,
  ModelStreamPart,
} from '../../../models/types'
import {
  isDeepSeekReasoningModel,
  isDeepSeekWeakToolUse,
  normalizeDeepSeekReasoningEffort,
} from '../../../models/utils/deepseek'
import { maybeWrapGeminiErrorResponse } from '../../../models/utils/gemini-stream-error'
import { getChatboxAPIOrigin } from '../../../request/chatboxai_pool'
import type { StreamTextResult, ToolUseScope } from '../../../types'
import { type ChatboxAILicenseDetail, ModelProviderEnum, type ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import {
  getLegacyOpenAICompatibleThinkingType,
  normalizeClaudeReasoningOptions,
  normalizeOpenAIReasoningOptions,
  pickOpenAICompatibleReasoningOptions,
} from '../../../utils/reasoning-control'
import { buildGeminiImageConfig } from '../gemini-types'

interface Options {
  licenseKey?: string
  model: ProviderModelInfo
  licenseInstances?: {
    [key: string]: string
  }
  licenseDetail?: ChatboxAILicenseDetail
  language: string
  dalleStyle: 'vivid' | 'natural'
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

interface Config {
  uuid: string
}

const DEFAULT_CHATBOXAI_ANTHROPIC_MAX_OUTPUT_TOKENS = 8192

function inferChatboxAIModelApiStyle(modelId: string): ProviderModelInfo['apiStyle'] | undefined {
  const normalized = modelId.toLowerCase()
  if (normalized.startsWith('gemini-')) return 'google'
  if (normalized.startsWith('claude-')) return 'anthropic'
  return undefined
}

function withChatboxAIModelApiStyleFallback(model: ProviderModelInfo): ProviderModelInfo {
  if (model.apiStyle) return model
  const apiStyle = inferChatboxAIModelApiStyle(model.modelId)
  return apiStyle ? { ...model, apiStyle } : model
}

/**
 * Default max_tokens for ChatboxAI Anthropic models when the user has not set one.
 * Capped by the model's real output limit: the gateway serves upstream Anthropic
 * model ids, but the manifest carries no maxOutput and ChatboxAI is excluded from
 * registry enrichment, so we consult the claude registry section directly. Without
 * the cap, models with limits below the default (e.g. claude-3-opus: 4096) would be
 * rejected upstream — @ai-sdk/anthropic only clamps overshoot for model ids it knows.
 */
function getDefaultAnthropicMaxOutputTokens(model: ProviderModelInfo): number {
  const registryMaxOutput = getRegistryModelMeta(ModelProviderEnum.Claude, model.modelId)?.maxOutput
  const modelLimit = model.maxOutput ?? registryMaxOutput
  if (modelLimit && modelLimit > 0) {
    return Math.min(DEFAULT_CHATBOXAI_ANTHROPIC_MAX_OUTPUT_TOKENS, modelLimit)
  }
  return DEFAULT_CHATBOXAI_ANTHROPIC_MAX_OUTPUT_TOKENS
}

// 将chatboxAIFetch移到类内部作为私有方法

export default class ChatboxAI extends AbstractAISDKModel implements ModelInterface {
  public name = 'ChatboxAI'

  constructor(
    public options: Options,
    public config: Config,
    dependencies: ModelDependencies
  ) {
    options.stream = true
    options.model = withChatboxAIModelApiStyleFallback(options.model)
    super(options, dependencies)
  }

  private async chatboxAIFetch(url: RequestInfo | URL, options?: RequestInit) {
    const urlString = url.toString()
    const response = await this.dependencies.request.fetchWithOptions(urlString, options, {
      parseChatboxRemoteError: true,
    })
    // @ai-sdk/google silently strips mid-stream {"error":...} SSE; intercept before the SDK.
    // Intentionally ChatboxAI-gateway-only: the mid-stream error frames come from our
    // backend's graceful-shutdown coordination (chatbox-backend #548). Direct Gemini
    // providers (gemini.ts / custom-gemini.ts) don't route through this fetch and are
    // out of scope until the same frame shape is confirmed from Google's own API.
    return maybeWrapGeminiErrorResponse(urlString, response)
  }

  static isSupportTextEmbedding() {
    return true
  }

  private getChatHeaders(options: CallChatCompletionOptions): Record<string, string> {
    const license = this.options.licenseKey || ''
    const instanceId = (this.options.licenseInstances ? this.options.licenseInstances[license] : '') || ''
    return {
      'Instance-Id': instanceId,
      'chatbox-session-id': options.sessionId || '',
      'chatbox-agent-mode': String(options.agentMode === true),
    }
  }

  protected getProvider(options: CallChatCompletionOptions) {
    if (this.options.model.apiStyle === 'google') {
      const provider = createGoogleGenerativeAI({
        apiKey: this.options.licenseKey || '',
        baseURL: `${getChatboxAPIOrigin()}/gateway/google-ai-studio/v1beta`,
        headers: {
          ...this.getChatHeaders(options),
          Authorization: `Bearer ${this.options.licenseKey || ''}`,
        },
        fetch: this.chatboxAIFetch.bind(this),
      })
      return provider
    } else if (this.options.model.apiStyle === 'anthropic') {
      const provider = createAnthropic({
        apiKey: this.options.licenseKey || '',
        baseURL: `${getChatboxAPIOrigin()}/gateway/anthropic/v1`,
        headers: this.getChatHeaders(options),
        fetch: this.chatboxAIFetch.bind(this),
      })
      return provider
    } else if (this.options.model.apiStyle === 'openai-responses') {
      const provider = createOpenAI({
        apiKey: this.options.licenseKey || '',
        baseURL: `${getChatboxAPIOrigin()}/gateway/openai-responses/v1`,
        headers: this.getChatHeaders(options),
        fetch: this.chatboxAIFetch.bind(this),
      })
      return provider
    } else if (isDeepSeekReasoningModel(this.options.model.modelId)) {
      const provider = createDeepSeek({
        apiKey: this.options.licenseKey || '',
        baseURL: `${getChatboxAPIOrigin()}/gateway/openai/v1`,
        headers: this.getChatHeaders(options),
        fetch: this.chatboxAIFetch.bind(this),
      })
      return provider
    } else {
      const provider = createOpenAICompatible({
        name: 'ChatboxAI',
        apiKey: this.options.licenseKey || '',
        baseURL: `${getChatboxAPIOrigin()}/gateway/openai/v1`,
        headers: this.getChatHeaders(options),
        fetch: this.chatboxAIFetch.bind(this),
      })
      return provider
    }
  }

  protected getCallSettings(options: CallChatCompletionOptions): CallSettings {
    if (this.options.model.apiStyle === 'anthropic') {
      let providerOptions: CallSettings['providerOptions'] = {}
      const isDeepSeek = isDeepSeekReasoningModel(this.options.model.modelId)
      const rawClaudeOptions = options.providerOptions?.claude
      const deepSeekEffort = normalizeDeepSeekReasoningEffort(this.options.model.modelId, rawClaudeOptions?.effort)
      const claudeOptions = isDeepSeek
        ? rawClaudeOptions?.thinking
          ? {
              thinking: rawClaudeOptions.thinking,
              ...(rawClaudeOptions.thinking.type !== 'disabled' && deepSeekEffort ? { effort: deepSeekEffort } : {}),
            }
          : undefined
        : normalizeClaudeReasoningOptions(this.options.model.modelId, rawClaudeOptions)
      if (claudeOptions) {
        providerOptions = {
          anthropic: { ...claudeOptions },
        }
      }
      // Anthropic API requires only one of temperature or topP
      const callSettings: CallSettings = {
        providerOptions,
        maxOutputTokens: this.options.maxOutputTokens ?? getDefaultAnthropicMaxOutputTokens(this.options.model),
      }
      const isDeepSeekThinking = isDeepSeek && claudeOptions?.thinking?.type !== 'disabled'
      if (!isDeepSeekThinking) {
        if (this.options.temperature !== undefined) {
          callSettings.temperature = this.options.temperature
        } else if (this.options.topP !== undefined) {
          callSettings.topP = this.options.topP
        }
      }
      return callSettings
    }
    if (this.options.model.apiStyle === 'google') {
      const providerOptions: GoogleGenerativeAIProviderOptions = {}
      if (options.providerOptions?.google?.thinkingConfig) {
        providerOptions.thinkingConfig = options.providerOptions.google.thinkingConfig
      }
      return {
        temperature: this.options.temperature,
        topP: this.options.topP,
        maxOutputTokens: this.options.maxOutputTokens,
        providerOptions: Object.keys(providerOptions).length > 0 ? { google: providerOptions } : undefined,
      }
    }
    if (this.options.model.apiStyle === 'openai-responses') {
      // Responses 的服务端状态（item_reference / previous_response_id）无法跨 provider 解析。
      // store=false 让 AI SDK 内联完整历史，不依赖服务端状态。
      const isDeepSeek = isDeepSeekReasoningModel(this.options.model.modelId)
      const openAIOptions = options.providerOptions?.openai
      const responseEffort = openAIOptions?.reasoningEffort
      const deepSeekEffort = normalizeDeepSeekReasoningEffort(this.options.model.modelId, responseEffort)
      const reasoningOptions = isDeepSeek
        ? deepSeekEffort || responseEffort === 'none'
          ? { reasoningEffort: responseEffort, forceReasoning: true }
          : undefined
        : normalizeOpenAIReasoningOptions(this.options.model.modelId, openAIOptions)
      const isDeepSeekThinking = isDeepSeek && reasoningOptions?.reasoningEffort !== 'none'
      return {
        ...(!isDeepSeekThinking ? { temperature: this.options.temperature, topP: this.options.topP } : {}),
        maxOutputTokens: this.options.maxOutputTokens,
        providerOptions: {
          openai: {
            ...reasoningOptions,
            store: false,
          },
        },
      }
    }
    const openAICompatibleOptions = pickOpenAICompatibleReasoningOptions(
      this.options.model.modelId,
      options.providerOptions
    )
    if (isDeepSeekReasoningModel(this.options.model.modelId)) {
      const deepseekOptions = options.providerOptions?.deepseek
      const thinkingType =
        deepseekOptions?.thinking?.type ??
        getLegacyOpenAICompatibleThinkingType(options.providerOptions?.openaiCompatible?.reasoning)
      const reasoningEffort = normalizeDeepSeekReasoningEffort(
        this.options.model.modelId,
        deepseekOptions?.reasoningEffort
      )
      const providerOptions =
        thinkingType || reasoningEffort
          ? {
              deepseek: {
                ...(thinkingType ? { thinking: { type: thinkingType } } : {}),
                ...(reasoningEffort ? { reasoningEffort } : {}),
              },
            }
          : undefined
      const isThinkingMode = thinkingType !== 'disabled'

      return {
        ...(!isThinkingMode ? { temperature: this.options.temperature, topP: this.options.topP } : {}),
        maxOutputTokens: this.options.maxOutputTokens,
        providerOptions,
      }
    }
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      providerOptions: openAICompatibleOptions
        ? {
            openaiCompatible: openAICompatibleOptions,
            [getOpenAICompatibleProviderOptionsKey('ChatboxAI')]: openAICompatibleOptions,
          }
        : undefined,
    }
  }

  getChatModel(options: CallChatCompletionOptions) {
    const provider = this.getProvider(options)
    if (this.options.model.apiStyle === 'google') {
      return (provider as GoogleGenerativeAIProvider).chat(this.options.model.modelId)
    } else if (this.options.model.apiStyle === 'openai-responses') {
      return (provider as OpenAIProvider).responses(this.options.model.modelId)
    } else {
      return provider.languageModel(this.options.model.modelId)
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
    if (this.options.model.apiStyle === 'google') {
      return this.paintWithGemini(params, signal, callback)
    }
    return this.paintWithChatboxAPI(params, signal, callback)
  }

  private async paintWithGemini(
    params: {
      prompt: string
      images?: { imageUrl: string }[]
      num: number
      aspectRatio?: string
    },
    signal?: AbortSignal,
    callback?: (picBase64: string) => void | Promise<void>
  ): Promise<string[]> {
    const provider = this.getGoogleProvider()
    const model = provider.chat(this.options.model.modelId)

    const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = []
    if (params.images && params.images.length > 0) {
      for (const img of params.images) {
        messageContent.push({ type: 'image', image: img.imageUrl })
      }
    }
    messageContent.push({ type: 'text', text: params.prompt })

    const results: string[] = []
    for (let i = 0; i < params.num; i++) {
      const providerOptions: GoogleGenerativeAIProviderOptions = {
        responseModalities: ['TEXT', 'IMAGE'],
      }
      const imageConfig = buildGeminiImageConfig(params.aspectRatio)
      if (imageConfig) {
        providerOptions.imageConfig = imageConfig
      }

      const result = streamText({
        model,
        messages: [{ role: 'user', content: messageContent }],
        abortSignal: signal,
        providerOptions: {
          google: providerOptions,
        },
        // Image generation is billable; network-error retries could double-charge.
        maxRetries: 0,
      })

      for await (const chunk of result.fullStream) {
        if (chunk.type === 'file' && chunk.file.mediaType?.startsWith('image/') && chunk.file.base64) {
          const dataUrl = `data:${chunk.file.mediaType};base64,${chunk.file.base64}`
          results.push(dataUrl)
          await callback?.(dataUrl)
        }
      }
    }
    return results
  }

  private getGoogleProvider(): GoogleGenerativeAIProvider {
    const license = this.options.licenseKey || ''
    const instanceId = (this.options.licenseInstances ? this.options.licenseInstances[license] : '') || ''
    return createGoogleGenerativeAI({
      apiKey: this.options.licenseKey || '',
      baseURL: `${getChatboxAPIOrigin()}/gateway/google-ai-studio/v1beta`,
      headers: {
        'Instance-Id': instanceId,
        Authorization: `Bearer ${this.options.licenseKey || ''}`,
      },
      fetch: this.chatboxAIFetch.bind(this),
    })
  }

  private async paintWithChatboxAPI(
    params: {
      prompt: string
      images?: { imageUrl: string }[]
      num: number
      aspectRatio?: string
    },
    signal?: AbortSignal,
    callback?: (picBase64: string) => void | Promise<void>
  ): Promise<string[]> {
    const concurrence: Promise<string>[] = []
    for (let i = 0; i < params.num; i++) {
      concurrence.push(
        this.callImageGeneration(params.prompt, params.images, params.aspectRatio, signal).then(async (picBase64) => {
          await callback?.(picBase64)
          return picBase64
        })
      )
    }
    return await Promise.all(concurrence)
  }

  private async callImageGeneration(
    prompt: string,
    images?: { imageUrl: string }[],
    aspectRatio?: string,
    signal?: AbortSignal
  ): Promise<string> {
    const license = this.options.licenseKey || ''
    const instanceId = (this.options.licenseInstances ? this.options.licenseInstances[license] : '') || ''
    const modelId = this.options.model.modelId
    const res = await this.chatboxAIFetch(`${getChatboxAPIOrigin()}/api/ai/paint`, {
      headers: {
        Authorization: `Bearer ${license}`,
        'Instance-Id': instanceId,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({
        prompt,
        ...(modelId ? { model: modelId } : {}),
        images: images?.map((i) => ({ image_url: i.imageUrl })),
        response_format: 'b64_json',
        style: this.options.dalleStyle,
        aspect_ratio: aspectRatio,
        uuid: this.config.uuid,
        language: this.options.language,
      }),
      // RN and DOM use different ambient AbortSignal declarations.
      signal: signal as unknown as RequestInit['signal'],
    })
    const json = await res.json()
    if (!json['data'] || !json['data'][0]) {
      throw new Error('Invalid response format from image generation API')
    }
    return json['data'][0]['b64_json']
  }

  public async chat(messages: ModelMessage[], options: CallChatCompletionOptions): Promise<StreamTextResult> {
    const cached = this.options.model.apiStyle === 'anthropic' ? addAnthropicCacheControl(messages) : messages
    return super.chat(cached, options)
  }

  public async *chatStream<T extends ToolSet>(
    messages: ModelMessage[],
    options: ChatStreamOptions
  ): AsyncGenerator<ModelStreamPart<T>> {
    const cached = this.options.model.apiStyle === 'anthropic' ? addAnthropicCacheControl(messages) : messages
    yield* super.chatStream<T>(cached, options)
  }

  isSupportSystemMessage() {
    return ![
      'o1-mini',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-thinking-exp',
      'gemini-2.0-flash-exp-image-generation',
    ].includes(this.options.model.modelId)
  }

  public isSupportToolUse(scope?: ToolUseScope) {
    if (isDeepSeekWeakToolUse(this.options.model.modelId, scope)) return false
    if (!this.options.model.capabilities) {
      return !this.options.model.type || this.options.model.type === 'chat'
    }
    return super.isSupportToolUse()
  }
}
