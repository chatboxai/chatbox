import { fetchWithProxy } from '@/utils/request'
import { createOpenAI } from '@ai-sdk/openai'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import { ProviderModelInfo } from 'src/shared/types'
import AbstractAISDKModel from './abstract-ai-sdk'
import { normalizeOpenAIApiHostAndPath } from './llm_utils'
import { fetchRemoteModels } from './openai-compatible'
import { CallChatCompletionOptions } from './types'

interface Options {
  apiKey: string
  apiHost: string
  model: ProviderModelInfo
  dalleStyle: 'vivid' | 'natural'
  temperature: number
  topP?: number
  injectDefaultMetadata: boolean
  useProxy: boolean
}

export default class OpenAI extends AbstractAISDKModel {
  public name = 'OpenAI'
  public options: Options

  constructor(options: Options) {
    super(options)
    const { apiHost } = normalizeOpenAIApiHostAndPath(options)
    this.options = { ...options, apiHost }
  }

  private getProvider() {
    return createOpenAI({
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: this.options.useProxy ? fetchWithProxy : undefined,
      headers: this.options.apiHost.includes('openrouter.ai')
        ? {
            'HTTP-Referer': 'https://chatboxai.app',
            'X-Title': 'Chatbox AI',
          }
        : undefined,
    })
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
    return provider.image('dall-e-3')
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const isModelSupportReasoning = this.isSupportReasoning()
    let providerOptions = {}
    if (isModelSupportReasoning) {
      providerOptions = {
        openai: options.providerOptions?.openai || {},
      }
    }
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      providerOptions,
    }
  }

  public listModels() {
    return fetchRemoteModels({
      apiHost: this.options.apiHost,
      apiKey: this.options.apiKey,
      useProxy: this.options.useProxy,
    })
  }
}
