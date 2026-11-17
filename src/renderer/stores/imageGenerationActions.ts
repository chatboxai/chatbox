import {
  type GenerateImageParams,
  type ImageGenerationHandle,
  ImageGenerationService,
  type StartImageGenerationOptions,
} from '@chatbox/core/application/image-generation'
import { getImageGenerationQueryBridge, type ImageGenerationQueryBridge } from '@chatbox/react'
import { getModel } from '@shared/providers'
import { validateImageGenerationRequest } from '@shared/providers/definitions/image-models'
import type { ImageGeneration } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { normalizePlausibleModel, normalizePlausibleProvider } from '@/analytics/plausible'
import { getLogger } from '@/lib/utils'
import { getImageModelCapabilities } from '@/packages/image-model-catalog'
import { pollImageTask, submitImageGeneration } from '@/packages/remote'
import platform from '@/platform'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { trackEvent } from '@/utils/track'
import { imageGenerationStore } from './imageGenerationStore'
import { queryClient } from './queryClient'
import { settingsStore } from './settingsStore'

export type { GenerateImageParams, ImageGenerationHandle, StartImageGenerationOptions }

const log = getLogger('image-generation-actions')
let service: ImageGenerationService | undefined
let queries: ImageGenerationQueryBridge | undefined

function getLicenseKey(): string {
  const licenseKey = settingsStore.getState().licenseKey
  if (!licenseKey) throw new Error('License key is required for image generation')
  return licenseKey
}

/** The renderer facade and CLI share the same application-owned image jobs. */
export function getImageGenerationService(): ImageGenerationService {
  if (!service) {
    const instance = new ImageGenerationService({
      storage: platform.getImageGenerationStorage(),
      blobStorage: currentBlobStorage,
      asyncClient: {
        submit: (params) => submitImageGeneration(params, getLicenseKey()),
        poll: (taskId, signal) => pollImageTask(taskId, getLicenseKey(), signal),
      },
      createModel: async (model) =>
        getModel(
          { provider: model.provider, modelId: model.modelId },
          settingsStore.getState().getSettings(),
          await platform.getConfig(),
          await createModelDependencies()
        ),
      resolveReferenceImage: async (key) => (await createModelDependencies()).storage.getImage(key),
      validateRequest: async (params, signal) => {
        if (params.model.provider === 'chatbox-ai') getLicenseKey()
        const capabilities = await getImageModelCapabilities(
          params.model,
          settingsStore.getState().getSettings(),
          signal
        )
        validateImageGenerationRequest({
          modelId: params.model.modelId,
          capabilities,
          aspectRatio: params.aspectRatio,
          referenceCount: params.referenceImages.length,
        })
      },
      createImageKey: (recordId) => StorageKeyGenerator.picture(`image-gen:${recordId}`),
      onGenerate: (params, path) =>
        trackEvent('generate_image', {
          provider: normalizePlausibleProvider(params.model.provider),
          model: normalizePlausibleModel(params.model.provider, params.model.modelId),
          num_images: params.imageGenerateNum || 1,
          has_reference: params.referenceImages.length > 0,
          ...(path === 'direct' ? { path } : {}),
        }),
      onError: (error) => log.error('Image generation failed:', error),
    })
    instance.subscribe(() => {
      imageGenerationStore.getState().setCurrentGeneratingId(instance.getSnapshot().currentGeneratingId)
    })
    instance.subscribeRecords((event) => {
      if (event.type === 'deleted') {
        if (imageGenerationStore.getState().currentRecordId === event.id) {
          imageGenerationStore.getState().setCurrentRecordId(null)
        }
      }
    })
    queries = getImageGenerationQueryBridge(instance, queryClient)
    service = instance
  }
  return service
}

export function getImageGenerationQueries(): ImageGenerationQueryBridge {
  getImageGenerationService()
  if (!queries) throw new Error('Image generation queries are unavailable.')
  return queries
}

export function isGenerating(): boolean {
  return getImageGenerationService().getSnapshot().currentGeneratingId !== null
}

export async function startImageGeneration(
  params: GenerateImageParams,
  options: StartImageGenerationOptions = {}
): Promise<ImageGenerationHandle> {
  const handle = await getImageGenerationService().start(params, options)
  imageGenerationStore.getState().setCurrentRecordId(handle.recordId)
  return handle
}

export async function createAndGenerate(
  params: GenerateImageParams,
  options?: StartImageGenerationOptions
): Promise<string> {
  return (await startImageGeneration(params, options)).recordId
}

export function cancelGeneration(): void {
  getImageGenerationService().cancel()
}

export async function loadRecord(recordId: string): Promise<ImageGeneration | null> {
  const record = await getImageGenerationService().getRecord(recordId)
  if (record) imageGenerationStore.getState().setCurrentRecordId(record.id)
  return record
}

export function clearCurrentRecord(): void {
  imageGenerationStore.getState().setCurrentRecordId(null)
}

export function resumeGeneration(recordId: string): Promise<ImageGeneration | null> {
  return getImageGenerationService().resume(recordId)
}

export async function retryGeneration(recordId: string): Promise<void> {
  await getImageGenerationService().retry(recordId)
}
