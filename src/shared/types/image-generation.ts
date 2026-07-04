import { z } from 'zod'

// 客户端本地图片生成记录的整体状态，用于历史记录持久化和 UI 展示。
// 这不是后端异步任务 item.status；后端 pending/processing/completed/failed 会在
// imageGenerationActions.ts 中折叠成这里的 generating/done/error。
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
  status: ImageGenerationStatusSchema,
  parentIds: z.array(z.string()).optional(), // for tracking iteration DAG (multiple parents possible)
  error: z.string().optional(),
  // Numeric codes come from CodedError; string codes come from async image generation item.error_code.
  errorCode: z.union([z.number(), z.string()]).optional(),
  // 异步生图失败时后端返回的 item.uuid，用于排查具体失败图片。
  errorItemUuid: z.string().optional(),
  taskId: z.string().optional(), // Backend task ID for polling
  aspectRatio: z.string().optional(), // Store aspect ratio for record
})
export type ImageGeneration = z.infer<typeof ImageGenerationSchema>

// Pagination result
export interface ImageGenerationPage {
  items: ImageGeneration[]
  nextCursor: number | null
  total: number
}
