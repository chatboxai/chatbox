import { z } from 'zod'
import type { RequestAdapter } from '../../types/adapters'
import type { ImageGenerationAsyncClient } from './types'

type ImageRequestSignal = NonNullable<Parameters<RequestAdapter['fetchWithOptions']>[1]>['signal']

export interface ImageCompletionRequest {
  model: string
  prompt: string
  response_format: 'b64_json'
  style?: string
  aspect_ratio?: string
  quantity?: number
  images?: Array<{ image_url: string }>
}

export const ImageGenerationItemSchema = z.object({
  uuid: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  created_at: z.string(),
  image_url: z.string().optional(),
  thumbnail_url: z.string().optional(),
  generated_at: z.string().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
})

export const ImageGenerationTaskResponseSchema = z.object({
  items: z.array(ImageGenerationItemSchema),
  is_finished: z.boolean(),
  task_id: z.string(),
})

export type ImageGenerationItem = z.infer<typeof ImageGenerationItemSchema>
export type ImageGenerationAPIResponse = z.infer<typeof ImageGenerationTaskResponseSchema>

export interface ImageGenerationAsyncClientOptions {
  request: Pick<RequestAdapter, 'fetchWithOptions'>
  getLicenseKey(): string | Promise<string>
  getHeaders?(): Record<string, string> | Promise<Record<string, string>>
  apiOrigin?: string
}

/** Shared ChatboxAI protocol; the service owns polling and local cancellation. */
export function createImageGenerationAsyncClient(options: ImageGenerationAsyncClientOptions) {
  const origin = (options.apiOrigin ?? 'https://api.chatboxai.app').replace(/\/+$/, '')
  const headers = async () => ({
    ...(await options.getHeaders?.()),
    Authorization: `Bearer ${await options.getLicenseKey()}`,
    'Content-Type': 'application/json',
  })
  return {
    async submit(params: ImageCompletionRequest): Promise<ImageGenerationAPIResponse> {
      const response = await options.request.fetchWithOptions(
        `${origin}/api/images/async_generations`,
        { method: 'POST', headers: await headers(), body: JSON.stringify(params) },
        { parseChatboxRemoteError: true, retry: 2 }
      )
      if (!response.ok) throw new Error(`Image submission failed (${response.status})`)
      return ImageGenerationTaskResponseSchema.parse(await response.json())
    },
    async poll(taskId: string, signal?: AbortSignal): Promise<ImageGenerationAPIResponse> {
      const response = await options.request.fetchWithOptions(
        `${origin}/api/images/async_generations/${encodeURIComponent(taskId)}`,
        // Keep the host's signal unchanged across the native and DOM type declarations.
        { method: 'GET', headers: await headers(), signal: signal as ImageRequestSignal },
        { parseChatboxRemoteError: true, retry: 2 }
      )
      if (!response.ok) throw new Error(`Image status request failed (${response.status})`)
      return ImageGenerationTaskResponseSchema.parse(await response.json())
    },
  } satisfies ImageGenerationAsyncClient
}
