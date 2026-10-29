import { createOpenAI } from '@ai-sdk/openai'
import type { ImageModel } from 'ai'
import { getOpenAIImageSizeForRatio } from '../image-models'

export function getOpenAIImageGenerationOptions(
  modelId: string,
  aspectRatio?: string
): { size?: `${number}x${number}` } {
  if (!aspectRatio || aspectRatio === 'auto') return {}
  const size = getOpenAIImageSizeForRatio(modelId, aspectRatio)
  return size ? { size } : {}
}

export function compatibleImageApiHeaders(apiHost: string): Record<string, string> | undefined {
  if (apiHost.includes('openrouter.ai')) {
    return {
      'HTTP-Referer': 'https://chatboxai.app',
      'X-Title': 'Chatbox AI',
    }
  }
  if (apiHost.includes('aihubmix.com')) {
    return {
      'APP-Code': 'VAFU9221',
    }
  }
  return undefined
}

export function createOpenAICompatibleImageModel(options: {
  apiKey: string
  apiHost: string
  modelId: string
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}): ImageModel {
  const provider = createOpenAI({
    apiKey: options.apiKey,
    baseURL: options.apiHost,
    fetch: options.fetch,
    headers: options.headers ?? compatibleImageApiHeaders(options.apiHost),
  })
  return provider.image(options.modelId)
}
