import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { ChatboxAILicenseDetail, ProviderModelInfo } from 'src/shared/types'
import * as remote from '../remote'
import { afetch } from '../request'
import AbstractAISDKModel from './abstract-ai-sdk'
import { CallChatCompletionOptions, ModelInterface } from './types'

interface Options {
  licenseKey?: string
  model: ProviderModelInfo
  licenseInstances?: {
    [key: string]: string
  }
  licenseDetail?: ChatboxAILicenseDetail
  language: string
  dalleStyle: 'vivid' | 'natural'
  temperature: number
}

interface Config {
  uuid: string
}

async function chatboxAIFetch(url: RequestInfo | URL, options?: RequestInit) {
  return afetch(url, options, {
    parseChatboxRemoteError: true,
  })
}

export default class ChatboxAI extends AbstractAISDKModel implements ModelInterface {
  public name = 'ChatboxAI'

  constructor(public options: Options, public config: Config) {
    super(options)
  }

  getChatModel(options: CallChatCompletionOptions) {
    const license = this.options.licenseKey || ''
    const instanceId = (this.options.licenseInstances ? this.options.licenseInstances[license] : '') || ''
    if (this.options.model.modelId.startsWith('gemini')) {
      const provider = createGoogleGenerativeAI({
        apiKey: this.options.licenseKey || '',
        baseURL: `${remote.API_ORIGIN}/gateway/google-ai-studio/v1beta`,
        headers: {
          'Instance-Id': instanceId,
          Authorization: `Bearer ${this.options.licenseKey || ''}`,
        },
        fetch: chatboxAIFetch,
      })
      return provider.chat(this.options.model.modelId, {
        structuredOutputs: false,
      })
    } else {
      const provider = createOpenAICompatible({
        name: 'ChatboxAI',
        apiKey: this.options.licenseKey || '',
        baseURL: `${remote.API_ORIGIN}/gateway/openai/v1`,
        headers: {
          'Instance-Id': instanceId,
        },
        fetch: chatboxAIFetch,
      })
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
    const res = await chatboxAIFetch(`${remote.API_ORIGIN}/api/ai/paint`, {
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

  public isSupportVision() {
    return true
  }

  public isSupportToolUse() {
    return true
  }
}
