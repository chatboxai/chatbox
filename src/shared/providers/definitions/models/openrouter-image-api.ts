import { z } from 'zod'
import { ApiError } from '../../../models/errors'
import type { ModelDependencies } from '../../../types/adapters'
import type { ImageModelCapabilities } from '../../../types/image-generation'

const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1'

export interface OpenRouterImageModelInfo {
  modelId: string
  nickname: string
  capabilities: ImageModelCapabilities
}

function getOpenRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://chatboxai.app',
    'X-Title': 'Chatbox AI',
  }
}

const OpenRouterImageParameterSchema = z
  .object({
    values: z.array(z.string()).optional(),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  })
  .passthrough()

const OpenRouterImageModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().optional(),
      supported_parameters: z.record(z.string(), OpenRouterImageParameterSchema).optional().default({}),
    })
  ),
})

export async function fetchOpenRouterImageModels(
  apiKey: string,
  dependencies: ModelDependencies
): Promise<OpenRouterImageModelInfo[]> {
  const response = await dependencies.request.apiRequest({
    url: `${OPENROUTER_API_BASE_URL}/images/models`,
    method: 'GET',
    headers: getOpenRouterHeaders(apiKey),
    useProxy: false,
  })
  const parsed = OpenRouterImageModelsResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new ApiError('Invalid OpenRouter image model response')
  }

  return parsed.data.data.map((model) => {
    const aspectRatio = model.supported_parameters.aspect_ratio
    const inputReferences = model.supported_parameters.input_references
    return {
      modelId: model.id,
      nickname: model.name || model.id,
      capabilities: {
        aspectRatio: aspectRatio ? { values: aspectRatio.values } : null,
        inputReferences: inputReferences ? { min: inputReferences.min, max: inputReferences.max } : null,
      },
    }
  })
}
