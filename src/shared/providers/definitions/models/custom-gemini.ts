import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { CallChatCompletionOptions } from '../../../models/types'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import { normalizeGeminiHost } from '../../../utils/llm_utils'
import { GeminiModel, type GeminiModelOptions } from './gemini-base'

interface Options extends GeminiModelOptions {
  apiKey: string
  apiHost: string
  useProxy?: boolean
}

export default class CustomGemini extends GeminiModel<Options> {
  public name = 'Custom Gemini'

  protected getRequestHeaders(_options?: CallChatCompletionOptions): Record<string, string> | undefined {
    return undefined
  }

  protected getProvider(options?: CallChatCompletionOptions) {
    return createGoogleGenerativeAI({
      apiKey: this.options.apiKey,
      baseURL: normalizeGeminiHost(this.options.apiHost).apiHost,
      fetch: createFetchWithProxy(this.options.useProxy, this.dependencies),
      headers: this.getRequestHeaders(options),
    })
  }

  async listModels() {
    try {
      const { apiHost } = normalizeGeminiHost(this.options.apiHost)
      return await this.fetchModels({
        url: `${apiHost}/models?key=${this.options.apiKey}`,
        method: 'GET',
        useProxy: this.options.useProxy,
        headers: {},
      })
    } catch (error) {
      console.error('Failed to fetch Gemini models:', error)
      return []
    }
  }
}
