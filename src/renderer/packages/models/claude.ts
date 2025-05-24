import { apiRequest } from '@/utils/request'
import { createAnthropic } from '@ai-sdk/anthropic'
import { ModelMeta } from 'src/shared/types'
import AbstractAISDKModel from './abstract-ai-sdk'
import { ModelHelpers } from './types'
import { ApiError } from './errors'

// https://docs.anthropic.com/en/docs/about-claude/models/overview
const modelConfig: ModelMeta = {
  'claude-opus-4-0': {
    contextWindow: 200_000,
    maxOutput: 32_000,
    vision: true,
    functionCalling: true,
    reasoning: true,
  },
  'claude-sonnet-4-0': {
    contextWindow: 200_000,
    maxOutput: 64_000,
    vision: true,
    functionCalling: true,
    reasoning: true,
  },
  'claude-3-7-sonnet-latest': {
    contextWindow: 200_000,
    maxOutput: 8192,
    vision: true,
    functionCalling: true,
  },
  'claude-3-5-sonnet-latest': {
    contextWindow: 200_000,
    maxOutput: 8192,
    vision: true,
  },
  'claude-3-5-haiku-latest': {
    contextWindow: 200_000,
    vision: true,
  },
  'claude-3-opus-latest': {
    contextWindow: 200_000,
    maxOutput: 8192,
    vision: true,
  },
}

export const claudeModels = Object.keys(modelConfig)

const helpers: ModelHelpers = {
  isModelSupportVision: (model: string) => {
    return true
  },
  isModelSupportToolUse: (model: string) => {
    return true
  },
}

interface Options {
  claudeApiKey: string
  claudeApiHost: string
  claudeModel: string
}

export default class Claude extends AbstractAISDKModel {
  public name = 'Claude'
  public static helpers = helpers

  constructor(public options: Options) {
    super()
  }

  protected getChatModel() {
    let host = this.options.claudeApiHost
    if (host === 'https://api.anthropic.com') {
      host = `${host}/v1`
    }
    const provider = createAnthropic({
      baseURL: host,
      apiKey: this.options.claudeApiKey,
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    return provider.languageModel(this.options.claudeModel)
  }

  isSupportToolUse() {
    return helpers.isModelSupportToolUse(this.options.claudeModel)
  }

  // https://docs.anthropic.com/en/docs/api/models
  public async listModels(): Promise<string[]> {
    type Response = {
      data: { id: string; type: string }[]
    }
    const url = `${this.options.claudeApiHost}/models?limit=990`
    const res = await apiRequest.get(url, {
      'anthropic-version': '2023-06-01',
      'x-api-key': this.options.claudeApiKey,
    })
    const json: Response = await res.json()
    if (!json['data']) {
      throw new ApiError(JSON.stringify(json))
    }
    return json['data'].filter((item) => item.type === 'model').map((item) => item.id)
  }
}
