import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
  type GoogleGenerativeAIProviderOptions,
} from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import type { CallChatCompletionOptions, ModelInterface } from '../../../models/types'
import { getChatboxAPIOrigin } from '../../../request/chatboxai_pool'
import type { ChatboxAILicenseDetail, ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

type GeminiAspectRatio = NonNullable<GoogleGenerativeAIProviderOptions['imageConfig']>['aspectRatio']

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

// 将chatboxAIFetch移到类内部作为私有方法

export default class ChatboxAI extends AbstractAISDKModel implements ModelInterface {
  public name = 'ChatboxAI'

  constructor(
    public options: Options,
    public config: Config,
    dependencies: ModelDependencies
  ) {
    options.stream = true
    super(options, dependencies)
  }

  private async chatboxAIFetch(url: RequestInfo | URL, options?: RequestInit) {
    return this.dependencies.request.fetchWithOptions(url.toString(), options, { parseChatboxRemoteError: true })
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider(options: CallChatCompletionOptions) {
    const license = this.options.licenseKey || ''
    const instanceId = (this.options.licenseInstances ? this.options.licenseInstances[license] : '') || ''
    if (this.options.model.apiStyle === 'google') {
      const provider = createGoogleGenerativeAI({
        apiKey: this.options.licenseKey || '',
        baseURL: `${getChatboxAPIOrigin()}/gateway/google-ai-studio/v1beta`,
        headers: {
          'Instance-Id': instanceId,
          Authorization: `Bearer ${this.options.licenseKey || ''}`,
          'chatbox-session-id': options.sessionId,
        },
        fetch: this.chatboxAIFetch.bind(this),
      })
      return provider
    } else {
      const provider = createOpenAICompatible({
        name: 'ChatboxAI',
        apiKey: this.options.licenseKey || '',
        baseURL: `${getChatboxAPIOrigin()}/gateway/openai/v1`,
        headers: {
          'Instance-Id': instanceId,
          'chatbox-session-id': options.sessionId || '',
        },
        fetch: this.chatboxAIFetch.bind(this),
      })
      return provider
    }
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
    }
  }

  getChatModel(options: CallChatCompletionOptions) {
    const provider = this.getProvider(options)
    if (this.options.model.apiStyle === 'google') {
      return (provider as GoogleGenerativeAIProvider).chat(this.options.model.modelId)
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
    callback?: (picBase64: string) => void
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
    callback?: (picBase64: string) => void
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
      if (params.aspectRatio && params.aspectRatio !== 'auto') {
        providerOptions.imageConfig = { aspectRatio: params.aspectRatio as GeminiAspectRatio }
      }

      const result = streamText({
        model,
        messages: [{ role: 'user', content: messageContent }],
        abortSignal: signal,
        providerOptions: {
          google: providerOptions,
        },
      })

      for await (const chunk of result.fullStream) {
        if (chunk.type === 'file' && chunk.file.mediaType?.startsWith('image/') && chunk.file.base64) {
          const dataUrl = `data:${chunk.file.mediaType};base64,${chunk.file.base64}`
          results.push(dataUrl)
          callback?.(dataUrl)
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
    callback?: (picBase64: string) => void
  ): Promise<string[]> {
    const concurrence: Promise<string>[] = []
    for (let i = 0; i < params.num; i++) {
      concurrence.push(
        this.callImageGeneration(params.prompt, params.images, params.aspectRatio, signal).then((picBase64) => {
          if (callback) {
            callback(picBase64)
          }
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
      signal,
    })
    const json = await res.json()
    if (!json['data'] || !json['data'][0]) {
      throw new Error('Invalid response format from image generation API')
    }
    return json['data'][0]['b64_json']
  }

  isSupportSystemMessage() {
    return ![
      'o1-mini',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-thinking-exp',
      'gemini-2.0-flash-exp-image-generation',
    ].includes(this.options.model.modelId)
  }

  public isSupportToolUse() {
    return true
  }
}
