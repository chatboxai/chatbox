import { z } from 'zod'

// Image generation record status
export const ImageGenerationStatusSchema = z.enum(['pending', 'generating', 'done', 'error'])
export type ImageGenerationStatus = z.infer<typeof ImageGenerationStatusSchema>

// Model info for image generation
export const ImageGenerationModelSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
})
export type ImageGenerationModel = z.infer<typeof ImageGenerationModelSchema>

// Image generation record schema
export const ImageGenerationSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  referenceImages: z.array(z.string()), // storage keys
  generatedImages: z.array(z.string()), // storage keys
  createdAt: z.number(),
  model: ImageGenerationModelSchema,
  dalleStyle: z.enum(['vivid', 'natural']).optional(),
  imageGenerateNum: z.number().optional(),
  taskId: z.string().optional(),
  aspectRatio: z.string().optional(),
  status: ImageGenerationStatusSchema,
  parentIds: z.array(z.string()).optional(), // for tracking iteration DAG (multiple parents possible)
  error: z.string().optional(),
  errorCode: z.number().optional(), // ChatboxAI API error code
})
export type ImageGeneration = z.infer<typeof ImageGenerationSchema>

// Pagination result
export interface ImageGenerationPage {
  items: ImageGeneration[]
  nextCursor: number | null
  total: number
}
