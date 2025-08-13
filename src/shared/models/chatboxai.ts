import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { getChatboxAPIOrigin } from '../request/chatboxai_pool'
import type { ChatboxAILicenseDetail, ProviderModelInfo } from '../types'
import type { ModelDependencies } from '../types/adapters'
import AbstractAISDKModel from './abstract-ai-sdk'
import type { CallChatCompletionOptions, ModelInterface } from './types'

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
  maxTokens?: number
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
      maxTokens: this.options.maxTokens,
    }
  }

  getChatModel(options: CallChatCompletionOptions) {
    const provider = this.getProvider(options)
    if (this.options.model.apiStyle === 'google') {
      return (provider as GoogleGenerativeAIProvider).chat(this.options.model.modelId, {
        structuredOutputs: false,
      })
    } else {
      return provider.languageModel(this.options.model.modelId)
    }
  }

  public async paint(
    prompt: string,
    num: number,
    callback?: (picBase64: string) => any,
    signal?: AbortSignal
  ): Promise<string[]> {
    const concurrence: Promise<string>[] = []
    for (let i = 0; i < num; i++) {
      concurrence.push(
        this.callImageGeneration(prompt, signal).then((picBase64) => {
          if (callback) {
            callback(picBase64)
          }
          return picBase64
        })
      )
    }
    return await Promise.all(concurrence)
  }

  private async callImageGeneration(prompt: string, signal?: AbortSignal): Promise<string> {
    const license = this.options.licenseKey || ''
    const instanceId = (this.options.licenseInstances ? this.options.licenseInstances[license] : '') || ''
    const res = await this.chatboxAIFetch(`${getChatboxAPIOrigin()}/api/ai/paint`, {
      headers: {
        Authorization: `Bearer ${license}`,
        'Instance-Id': instanceId,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({
        prompt,
        response_format: 'b64_json',
        style: this.options.dalleStyle,
        uuid: this.config.uuid,
        language: this.options.language,
      }),
      signal,
    })
    const json = await res.json()
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
