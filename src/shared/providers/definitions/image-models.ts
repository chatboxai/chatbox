export type ImageModelFamily = 'gemini' | 'openai' | 'dall-e-2' | 'dall-e-3'

type ImageSize = `${number}x${number}`

type ImageModelCapabilities = {
  ratioOptions: string[]
  openaiSizes?: Partial<Record<string, ImageSize>>
}

const GPT_IMAGE_SIZES: Record<string, ImageSize> = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
}

const IMAGE_MODEL_CAPABILITIES: Record<ImageModelFamily | 'default', ImageModelCapabilities> = {
  openai: {
    ratioOptions: ['auto', '1:1', '3:2', '2:3'],
    openaiSizes: GPT_IMAGE_SIZES,
  },
  'dall-e-2': {
    ratioOptions: ['auto', '1:1'],
    openaiSizes: { '1:1': '1024x1024' },
  },
  'dall-e-3': {
    ratioOptions: ['auto', '1:1', '7:4', '4:7'],
    openaiSizes: {
      '1:1': '1024x1024',
      '3:2': '1792x1024',
      '2:3': '1024x1792',
      '7:4': '1792x1024',
      '4:7': '1024x1792',
    },
  },
  gemini: {
    ratioOptions: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9'],
    openaiSizes: GPT_IMAGE_SIZES,
  },
  default: {
    ratioOptions: ['auto', '1:1', '3:2', '2:3'],
    openaiSizes: GPT_IMAGE_SIZES,
  },
}

export function getImageModelFamily(modelId: string): ImageModelFamily | 'default' {
  const normalizedModelId = modelId.toLowerCase()
  if (normalizedModelId.includes('gemini') && normalizedModelId.includes('image')) return 'gemini'
  if (normalizedModelId.includes('dall-e-2')) return 'dall-e-2'
  if (normalizedModelId.includes('dall-e-3')) return 'dall-e-3'
  if (normalizedModelId.startsWith('gpt-image')) return 'openai'
  return 'default'
}

export function isGeminiImageModel(modelId: string): boolean {
  return getImageModelFamily(modelId) === 'gemini'
}

export function getRatioOptionsForModel(modelId: string): string[] {
  return IMAGE_MODEL_CAPABILITIES[getImageModelFamily(modelId)].ratioOptions
}

export function getOpenAIImageSizeForRatio(modelId: string, aspectRatio: string): ImageSize | undefined {
  return IMAGE_MODEL_CAPABILITIES[getImageModelFamily(modelId)].openaiSizes?.[aspectRatio]
}
