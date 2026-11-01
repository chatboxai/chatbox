import { z } from 'zod'

// 客户端本地图片生成记录的整体状态，用于历史记录持久化和 UI 展示。
// 这不是后端异步任务 item.status；后端 pending/processing/completed/failed 会在
// imageGenerationActions.ts 中折叠成这里的 generating/done/error。
export const ImageGenerationStatusSchema = z.enum(['pending', 'generating', 'done', 'error'])
export type ImageGenerationStatus = z.infer<typeof ImageGenerationStatusSchema>

/** Model-advertised constraints. Null means unsupported; omitted capabilities are unknown. */
export interface ImageModelCapabilities {
  aspectRatio: { values?: string[] } | null
  inputReferences: { min?: number; max?: number } | null
}

// Model info for image generation
export const ImageGenerationModelSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
})
export type ImageGenerationModel = z.infer<typeof ImageGenerationModelSchema>

export const ImageGenerationSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chatbox_cli'),
    sessionId: z.string(),
    toolCallId: z.string(),
  }),
])
export type ImageGenerationSource = z.infer<typeof ImageGenerationSourceSchema>

// Image generation record schema
export const ImageGenerationSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  referenceImages: z.array(z.string()), // storage keys
  generatedImages: z.array(z.string()), // storage keys
  generatedImageThumbnails: z.array(z.string()).optional(), // thumbnail URLs aligned with generatedImages
  createdAt: z.number(),
  model: ImageGenerationModelSchema,
  dalleStyle: z.enum(['vivid', 'natural']).optional(),
  imageGenerateNum: z.number().optional(),
  status: ImageGenerationStatusSchema,
  parentIds: z.array(z.string()).optional(), // for tracking iteration DAG (multiple parents possible)
  error: z.string().optional(),
  // 数字 code 来自 ChatboxAI API 错误；字符串 code 来自异步生图 item.error_code。
  errorCode: z.union([z.number(), z.string()]).optional(),
  // 异步生图失败时后端返回的 item.uuid，用于排查具体失败图片。
  errorItemUuid: z.string().optional(),
  taskId: z.string().optional(), // Backend task ID for polling
  aspectRatio: z.string().optional(), // Store aspect ratio for record
  source: ImageGenerationSourceSchema.optional(), // Originating workflow for reconnecting completion callbacks
})
export type ImageGeneration = z.infer<typeof ImageGenerationSchema>

// Pagination result
export interface ImageGenerationPage {
  items: ImageGeneration[]
  nextCursor: number | null
  total: number
}
