import { createOpenAI } from '@ai-sdk/openai'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { fetchRemoteModels } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  apiKey: string
  apiHost: string
  apiPath: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
  useProxy?: boolean
}

type FetchFunction = typeof globalThis.fetch

// Eden AI's Responses endpoint is OpenAI-compatible (stateful alternative to chat
// completions). Unlike OpenAI's `https://api.openai.com` host, Eden AI keeps the
// version segment in the path (`https://api.edenai.run/v3/responses`), so we route
// requests explicitly to `${apiHost}${apiPath}` instead of using the shared
// `normalizeOpenAIResponsesHostAndPath` helper (which would append `/v1`).
// Docs: https://www.edenai.co/docs/api-reference/responses/create-response
export default class EdenAIResponses extends AbstractAISDKModel {
  public name = 'Eden AI Responses'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      stream: this.options.stream,
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider(_options: CallChatCompletionOptions, fetchFunction?: FetchFunction) {
    return createOpenAI({
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: fetchFunction,
    })
  }

  protected getChatModel(options: CallChatCompletionOptions) {
    const { apiHost, apiPath } = this.options
    const provider = this.getProvider(options, (_input, init) =>
      createFetchWithProxy(this.options.useProxy, this.dependencies)(`${apiHost}${apiPath}`, init)
    )
    return wrapLanguageModel({
      model: provider.responses(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  public listModels() {
    return fetchRemoteModels(
      {
        apiHost: this.options.apiHost,
        apiKey: this.options.apiKey,
        useProxy: this.options.useProxy,
      },
      this.dependencies
    )
  }

  protected getImageModel() {
    return null
  }
}
