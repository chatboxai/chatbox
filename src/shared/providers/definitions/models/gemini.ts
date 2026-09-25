import { createGoogle } from '@ai-sdk/google'
import { normalizeGeminiHost } from '../../../utils/llm_utils'
import { GeminiModel, type GeminiModelOptions } from './gemini-base'

interface Options extends GeminiModelOptions {
  geminiAPIKey: string
  geminiAPIHost: string
}

export default class Gemini extends GeminiModel<Options> {
  public name = 'Google Gemini'

  protected getProvider() {
    return createGoogle({
      apiKey: this.options.geminiAPIKey,
      baseURL: normalizeGeminiHost(this.options.geminiAPIHost).apiHost,
    })
  }

  async listModels() {
    return this.fetchModels({
      url: `${this.options.geminiAPIHost}/v1beta/models?key=${this.options.geminiAPIKey}`,
      method: 'GET',
      headers: {},
    })
  }
}
