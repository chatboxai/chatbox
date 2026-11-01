import type { ModelInterface } from '../../models/types'
import type { BlobStoragePort, ImageGenerationStoragePort } from '../../ports'
import type { ImageGeneration, ImageGenerationModel, ImageGenerationSource } from '../../types'

export interface GenerateImageParams {
  prompt: string
  referenceImages: string[]
  model: ImageGenerationModel
  dalleStyle?: 'vivid' | 'natural'
  imageGenerateNum?: number
  aspectRatio?: string
  parentIds?: string[]
  source?: ImageGenerationSource
}

export interface ImageGenerationTaskResponse {
  task_id: string
  is_finished: boolean
  items: {
    uuid: string
    status: 'pending' | 'processing' | 'completed' | 'failed'
    image_url?: string
    thumbnail_url?: string
    error_code?: string
    error_message?: string
  }[]
}

export interface ImageGenerationSubmission {
  model: string
  prompt: string
  response_format: 'b64_json'
  style: 'vivid' | 'natural'
  aspect_ratio?: string
  quantity: number
  images?: { image_url: string }[]
}

export interface ImageGenerationAsyncClient {
  /** Submission must remain observable after local cancellation so its task ID can be saved. */
  submit(params: ImageGenerationSubmission): Promise<ImageGenerationTaskResponse>
  poll(taskId: string, signal: AbortSignal): Promise<ImageGenerationTaskResponse>
}

export interface ImageGenerationSnapshot {
  currentGeneratingId: string | null
  phase: 'idle' | 'preparing' | 'generating' | 'stopping' | 'paused'
}

export type ImageGenerationRecordEvent =
  | { type: 'created' | 'updated'; record: ImageGeneration }
  | { type: 'deleted'; id: string }

export interface ImageGenerationHandle {
  recordId: string
  startedAt: number
  monitoring: { mode: 'polling'; intervalMs: number } | { mode: 'direct' }
  completion: Promise<ImageGeneration | null>
}

export interface StartImageGenerationOptions {
  /** Runs after the record is durable, before any potentially billable provider request. */
  onRecordCreated?: (record: ImageGeneration) => void | Promise<void>
}

export interface ImageGenerationServiceOptions {
  storage: ImageGenerationStoragePort
  blobStorage: BlobStoragePort
  asyncClient: ImageGenerationAsyncClient
  createModel(model: ImageGenerationModel): Promise<Pick<ModelInterface, 'paint'>>
  resolveReferenceImage(key: string): Promise<string | null>
  validateRequest?(params: GenerateImageParams, signal: AbortSignal): Promise<void>
  createId?(): string
  createImageKey?(recordId: string): string
  now?(): number
  pollIntervalMs?: number
  onGenerate?(params: GenerateImageParams, path: 'async' | 'direct'): void
  onError?(error: unknown): void
}
