import { BaseError } from '@shared/models/errors'
import { getModel } from '@shared/providers'
import { validateImageGenerationRequest } from '@shared/providers/definitions/image-models'
import type { ImageGeneration, ImageGenerationModel, ImageGenerationSource } from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { normalizePlausibleModel, normalizePlausibleProvider } from '@/analytics/plausible'
import { getLogger } from '@/lib/utils'
import { getImageModelCapabilities } from '@/packages/image-model-catalog'
import {
  IMAGE_GENERATION_POLL_INTERVAL_MS,
  type ImageGenerationTaskResponse,
  pollImageTask,
  pollTaskUntilComplete,
  submitImageGeneration,
} from '@/packages/remote'
import platform from '@/platform'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { trackEvent } from '@/utils/track'
import {
  addGeneratedImage,
  createRecord,
  IMAGE_GEN_LIST_QUERY_KEY,
  IMAGE_GEN_QUERY_KEY,
  imageGenerationStore,
  updateRecord,
} from './imageGenerationStore'
import { queryClient } from './queryClient'
import { settingsStore } from './settingsStore'

const log = getLogger('image-generation-actions')

const STARTING_GENERATION_ID = '__starting-image-generation__'

interface GenerationAttempt {
  recordId: string
  controller: AbortController
  canResume: boolean
}

let activeGenerationAttempt: GenerationAttempt | null = null

function generationAbortedError(): DOMException {
  return new DOMException('Image generation was cancelled.', 'AbortError')
}

function acquireGenerationLock(generationId: string): GenerationAttempt {
  const store = imageGenerationStore.getState()
  if (activeGenerationAttempt !== null || store.currentGeneratingId !== null) {
    throw new Error('Another image is being generated. Please wait.')
  }

  const attempt = {
    recordId: generationId,
    controller: new AbortController(),
    canResume: false,
  }
  activeGenerationAttempt = attempt
  store.setCurrentGeneratingId(generationId)
  return attempt
}

function assertGenerationLock(attempt: GenerationAttempt): void {
  if (
    activeGenerationAttempt !== attempt ||
    imageGenerationStore.getState().currentGeneratingId !== attempt.recordId ||
    attempt.controller.signal.aborted
  ) {
    throw generationAbortedError()
  }
}

function bindGenerationRecord(attempt: GenerationAttempt, recordId: string): void {
  assertGenerationLock(attempt)
  attempt.recordId = recordId
  imageGenerationStore.getState().setCurrentGeneratingId(recordId)
}

function releaseGenerationLock(attempt: GenerationAttempt): void {
  if (activeGenerationAttempt !== attempt) return

  activeGenerationAttempt = null
  const store = imageGenerationStore.getState()
  if (store.currentGeneratingId === attempt.recordId) {
    store.setCurrentGeneratingId(null)
  }
}

function getLicenseKey(): string {
  const licenseKey = settingsStore.getState().licenseKey
  if (!licenseKey) {
    throw new Error('License key is required for image generation')
  }
  return licenseKey
}

function shouldUseAsyncPath(provider: string): boolean {
  return provider === ModelProviderEnum.ChatboxAI
}

function getErrorRecordUpdate(
  error: unknown
): Pick<ImageGeneration, 'status' | 'error' | 'errorCode' | 'errorItemUuid'> {
  const normalizedError = error instanceof Error ? error : new Error(`${error}`)
  return {
    status: 'error',
    error: normalizedError.message,
    errorCode: error instanceof BaseError ? error.code : undefined,
    errorItemUuid: undefined,
  }
}

async function markGenerationCancelled(recordId: string): Promise<ImageGeneration | null> {
  const updatedRecord = await updateRecord(recordId, {
    status: 'error',
    error: 'Image generation was cancelled.',
    errorCode: undefined,
    errorItemUuid: undefined,
  })
  if (updatedRecord) {
    queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
  }
  return updatedRecord
}

async function persistGeneratedImage(
  recordId: string,
  picBase64: string,
  attempt: GenerationAttempt
): Promise<ImageGeneration> {
  const storageKey = StorageKeyGenerator.picture(`image-gen:${recordId}`)
  let associationAttempted = false
  let associationCompleted = false

  try {
    await currentBlobStorage.set(storageKey, picBase64)
    assertGenerationLock(attempt)

    associationAttempted = true
    const updatedRecord = await addGeneratedImage(recordId, storageKey)
    if (!updatedRecord) {
      throw new Error('Image generation record no longer exists.')
    }
    associationCompleted = true
    assertGenerationLock(attempt)
    queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], updatedRecord)
    return updatedRecord
  } catch (error) {
    let shouldRemoveBlob = !associationAttempted
    if (associationAttempted && !associationCompleted) {
      try {
        const record = await platform.getImageGenerationStorage().getById(recordId)
        shouldRemoveBlob = !record?.generatedImages.includes(storageKey)
      } catch (reconciliationError) {
        log.error('Failed to reconcile a generated image after its record update failed:', reconciliationError)
      }
    }

    if (shouldRemoveBlob) {
      try {
        await currentBlobStorage.remove(storageKey)
      } catch (cleanupError) {
        log.error('Failed to clean up an unlinked generated image:', cleanupError)
      }
    }
    throw error
  }
}

function getFailedImageGenerationError(
  result: ImageGenerationTaskResponse,
  fallback: string
): Pick<ImageGeneration, 'error' | 'errorCode' | 'errorItemUuid'> {
  const failedItem = result.items.find((item) => item.status === 'failed')
  return {
    error: failedItem?.error_message || fallback,
    errorCode: failedItem?.error_code,
    errorItemUuid: failedItem?.uuid,
  }
}

function getCompletedImages(result: ImageGenerationTaskResponse): {
  imageUrls: string[]
  thumbnailUrls: string[]
} {
  const completedItems = result.items.filter(
    (item): item is typeof item & { image_url: string } => item.status === 'completed' && !!item.image_url
  )

  return {
    imageUrls: completedItems.map((item) => item.image_url),
    thumbnailUrls: completedItems.map((item) => item.thumbnail_url || item.image_url),
  }
}

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

export function isGenerating(): boolean {
  return imageGenerationStore.getState().currentGeneratingId !== null
}

export interface ImageGenerationHandle {
  recordId: string
  startedAt: number
  monitoring: { mode: 'polling'; intervalMs: number } | { mode: 'direct' }
  completion: Promise<ImageGeneration | null>
}

export interface StartImageGenerationOptions {
  /**
   * Runs after the local record is durable and before any potentially billable
   * provider request starts. Callers can use this to persist their own retry key.
   */
  onRecordCreated?: (record: ImageGeneration) => void | Promise<void>
}

/**
 * Starts image generation without waiting for the provider task to finish.
 * Callers that need background-task notifications can observe `completion`;
 * existing UI callers can keep using `createAndGenerate` and only consume the id.
 */
export async function startImageGeneration(
  params: GenerateImageParams,
  options: StartImageGenerationOptions = {}
): Promise<ImageGenerationHandle> {
  const attempt = acquireGenerationLock(STARTING_GENERATION_ID)
  const store = imageGenerationStore.getState()
  let record: ImageGeneration | undefined

  try {
    // Normalize: 'auto' means no aspect ratio constraint
    if (params.aspectRatio === 'auto') {
      params = { ...params, aspectRatio: undefined }
    }

    record = await createRecord({
      prompt: params.prompt,
      referenceImages: params.referenceImages,
      model: params.model,
      dalleStyle: params.dalleStyle,
      imageGenerateNum: params.imageGenerateNum,
      parentIds: params.parentIds,
      aspectRatio: params.aspectRatio,
      source: params.source,
    })

    try {
      await options.onRecordCreated?.(record)
    } catch (error) {
      await updateRecord(record.id, getErrorRecordUpdate(error))
      throw error
    }
    bindGenerationRecord(attempt, record.id)
    assertGenerationLock(attempt)

    store.setCurrentRecordId(record.id)
    queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, record.id], record)

    const generateFn = shouldUseAsyncPath(params.model.provider) ? generateImages : generateImagesDirect
    const generation = generateFn(record.id, params, attempt).finally(() => {
      releaseGenerationLock(attempt)
      queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
    })

    return {
      recordId: record.id,
      startedAt: record.createdAt,
      monitoring: shouldUseAsyncPath(params.model.provider)
        ? { mode: 'polling', intervalMs: IMAGE_GENERATION_POLL_INTERVAL_MS }
        : { mode: 'direct' },
      completion: generation,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError' && record) {
      try {
        await markGenerationCancelled(record.id)
      } finally {
        releaseGenerationLock(attempt)
      }
      throw error
    }
    releaseGenerationLock(attempt)
    throw error
  }
}

export async function createAndGenerate(
  params: GenerateImageParams,
  options: StartImageGenerationOptions = {}
): Promise<string> {
  const handle = await startImageGeneration(params, options)
  return handle.recordId
}

async function generateImages(
  recordId: string,
  params: GenerateImageParams,
  attempt: GenerationAttempt
): Promise<ImageGeneration | null> {
  const licenseKey = getLicenseKey()
  const num = params.imageGenerateNum || 1
  const signal = attempt.controller.signal

  try {
    assertGenerationLock(attempt)

    // Update status to generating
    let currentRecord = await updateRecord(recordId, { status: 'generating' })
    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }

    // Prepare reference images - convert storage keys to base64 data URLs if needed
    const dependencies = await createModelDependencies()
    const referenceImageData: Array<{ image_url: string }> = []

    for (const keyOrUrl of params.referenceImages) {
      if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
        referenceImageData.push({ image_url: keyOrUrl })
      } else {
        const imageData = await dependencies.storage.getImage(keyOrUrl)
        if (imageData) {
          log.debug('Reference image from storage key:', keyOrUrl, 'data length:', imageData.length)
          referenceImageData.push({ image_url: imageData })
        }
      }
    }
    assertGenerationLock(attempt)

    trackEvent('generate_image', {
      provider: normalizePlausibleProvider(params.model.provider),
      model: normalizePlausibleModel(params.model.provider, params.model.modelId),
      num_images: num,
      has_reference: params.referenceImages.length > 0,
    })

    // Single submit with quantity
    const submission = await submitImageGeneration(
      {
        model: params.model.modelId,
        prompt: params.prompt,
        response_format: 'b64_json',
        style: params.dalleStyle || 'vivid',
        aspect_ratio: params.aspectRatio,
        quantity: num,
        images: referenceImageData.length > 0 ? referenceImageData : undefined,
      },
      licenseKey
    )

    log.debug('Submitted image generation task:', submission.task_id, 'items:', submission.items.length)

    // Store task ID for resume capability
    currentRecord = await updateRecord(recordId, { taskId: submission.task_id })
    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }
    attempt.canResume = currentRecord !== null
    assertGenerationLock(attempt)

    // Poll until all items are finished, progressively updating as images complete
    let lastCompletedCount = 0
    const finalResult = await pollTaskUntilComplete(submission.task_id, licenseKey, {
      signal,
      onPoll: async (response) => {
        assertGenerationLock(attempt)
        const completedImages = getCompletedImages(response)
        if (completedImages.imageUrls.length > lastCompletedCount) {
          lastCompletedCount = completedImages.imageUrls.length
          currentRecord = await updateRecord(recordId, {
            generatedImages: completedImages.imageUrls,
            generatedImageThumbnails: completedImages.thumbnailUrls,
          })
          if (currentRecord) {
            queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
          }
        }
      },
    })
    assertGenerationLock(attempt)

    // Final update: set status based on results
    const completedImages = getCompletedImages(finalResult)
    const completedUrls = completedImages.imageUrls
    const hasError = finalResult.items.some((item) => item.status === 'failed')

    if (completedUrls.length > 0) {
      const failedError = getFailedImageGenerationError(finalResult, 'Some images failed to generate')
      currentRecord = await updateRecord(recordId, {
        generatedImages: completedUrls,
        generatedImageThumbnails: completedImages.thumbnailUrls,
        status: hasError && completedUrls.length < num ? 'error' : 'done',
        error: hasError && completedUrls.length < num ? failedError.error : undefined,
        errorCode: hasError && completedUrls.length < num ? failedError.errorCode : undefined,
        errorItemUuid: hasError && completedUrls.length < num ? failedError.errorItemUuid : undefined,
      })
    } else {
      currentRecord = await updateRecord(recordId, {
        status: 'error',
        ...getFailedImageGenerationError(finalResult, 'All images failed to generate'),
      })
    }

    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }

    log.debug('Image generation completed:', recordId, 'urls:', completedUrls.length)
    return currentRecord
  } catch (err: unknown) {
    // Don't report abort errors as failures
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug('Image generation aborted:', recordId)
      return attempt.canResume ? null : await markGenerationCancelled(recordId)
    }

    log.error('Image generation failed:', err)

    const updatedRecord = await updateRecord(recordId, getErrorRecordUpdate(err))
    if (updatedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
    }
    return updatedRecord
  }
}

async function generateImagesDirect(
  recordId: string,
  params: GenerateImageParams,
  attempt: GenerationAttempt,
  existingGeneratedImageCount = 0
): Promise<ImageGeneration | null> {
  const num = params.imageGenerateNum || 1
  const signal = attempt.controller.signal

  try {
    assertGenerationLock(attempt)

    let currentRecord = await updateRecord(recordId, { status: 'generating' })
    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }

    const dependencies = await createModelDependencies()

    // Prepare reference images: storage keys → base64 data URLs
    const images: { imageUrl: string }[] = []
    let unresolvedReferenceCount = 0
    for (const keyOrUrl of params.referenceImages) {
      if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
        images.push({ imageUrl: keyOrUrl })
        continue
      }
      const imageData = await dependencies.storage.getImage(keyOrUrl)
      if (imageData) {
        images.push({ imageUrl: imageData })
      } else {
        unresolvedReferenceCount += 1
      }
    }
    assertGenerationLock(attempt)

    if (unresolvedReferenceCount > 0) {
      throw new Error('A reference image could not be loaded. Remove it and add the image again before generating.')
    }

    const globalSettings = settingsStore.getState().getSettings()
    const capabilities = await getImageModelCapabilities(params.model, globalSettings, signal)
    assertGenerationLock(attempt)
    validateImageGenerationRequest({
      modelId: params.model.modelId,
      capabilities,
      aspectRatio: params.aspectRatio,
      referenceCount: images.length,
    })

    // Build model instance via provider registry
    const configs = await platform.getConfig()
    const sessionSettings = {
      provider: params.model.provider,
      modelId: params.model.modelId,
    }
    const model = getModel(sessionSettings, globalSettings, configs, dependencies)
    assertGenerationLock(attempt)

    trackEvent('generate_image', {
      provider: normalizePlausibleProvider(params.model.provider),
      model: normalizePlausibleModel(params.model.provider, params.model.modelId),
      num_images: num,
      has_reference: params.referenceImages.length > 0,
      path: 'direct',
    })

    // Call model.paint() with progressive callback
    const resultDataUrls = await model.paint(
      {
        prompt: params.prompt,
        images: images.length > 0 ? images : undefined,
        num,
        aspectRatio: params.aspectRatio,
      },
      signal,
      async (picBase64: string) => {
        await persistGeneratedImage(recordId, picBase64, attempt)
      }
    )
    assertGenerationLock(attempt)

    // Final status based on how many images we got
    if (resultDataUrls.length > 0) {
      // Ensure all returned images are stored (in case callback wasn't called for some)
      const record = await platform.getImageGenerationStorage().getById(recordId)
      assertGenerationLock(attempt)
      const existingCount = record?.generatedImages.length || 0
      const persistedDuringAttempt = Math.max(0, existingCount - existingGeneratedImageCount)
      if (persistedDuringAttempt < resultDataUrls.length) {
        for (let i = persistedDuringAttempt; i < resultDataUrls.length; i++) {
          await persistGeneratedImage(recordId, resultDataUrls[i], attempt)
        }
      }

      currentRecord = await updateRecord(recordId, {
        status: resultDataUrls.length < num ? 'error' : 'done',
        error: resultDataUrls.length < num ? 'Some images failed to generate' : undefined,
      })
    } else {
      currentRecord = await updateRecord(recordId, {
        status: 'error',
        error: 'All images failed to generate',
      })
    }

    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }

    log.debug('Direct image generation completed:', recordId, 'images:', resultDataUrls.length)
    return currentRecord
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug('Direct image generation aborted:', recordId)
      return await markGenerationCancelled(recordId)
    }

    log.error('Direct image generation failed:', err)

    const updatedRecord = await updateRecord(recordId, getErrorRecordUpdate(err))
    if (updatedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
    }
    return updatedRecord
  }
}

export function cancelGeneration(): void {
  const store = imageGenerationStore.getState()
  const attempt = activeGenerationAttempt
  if (attempt) {
    attempt.controller.abort()
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
  } else if (store.currentGeneratingId) {
    store.setCurrentGeneratingId(null)
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
  }
}

export async function loadRecord(recordId: string): Promise<ImageGeneration | null> {
  const record = await platform.getImageGenerationStorage().getById(recordId)
  if (record) {
    imageGenerationStore.getState().setCurrentRecordId(record.id)
  }
  return record
}

export function clearCurrentRecord(): void {
  imageGenerationStore.getState().setCurrentRecordId(null)
}

export async function resumeGeneration(recordId: string): Promise<ImageGeneration | null> {
  const attempt = acquireGenerationLock(recordId)
  let shouldPersistFailure = false

  try {
    const record = await platform.getImageGenerationStorage().getById(recordId)
    assertGenerationLock(attempt)
    if (!record) {
      throw new Error('Record not found')
    }

    if (!record.taskId) {
      throw new Error('No task ID found for this record')
    }

    const licenseKey = getLicenseKey()
    const signal = attempt.controller.signal
    shouldPersistFailure = true

    // Check current status, then poll if not finished
    const currentStatus = await pollImageTask(record.taskId, licenseKey, signal)
    assertGenerationLock(attempt)

    let finalResult = currentStatus
    if (!currentStatus.is_finished) {
      finalResult = await pollTaskUntilComplete(record.taskId, licenseKey, { signal })
      assertGenerationLock(attempt)
    }

    // Collect successful original and thumbnail URLs into the local record.
    const completedImages = getCompletedImages(finalResult)
    const completedUrls = completedImages.imageUrls
    const hasError = finalResult.items.some((item) => item.status === 'failed')

    for (const item of finalResult.items) {
      if (item.status === 'failed') {
        log.error('Image generation item failed on resume:', item.uuid, item.error_message)
      }
    }

    const expectedNum = record.imageGenerateNum || 1

    const updatedRecord = await updateRecord(recordId, {
      generatedImages: completedUrls,
      generatedImageThumbnails: completedImages.thumbnailUrls,
      status: completedUrls.length >= expectedNum ? 'done' : hasError ? 'error' : 'done',
      ...(hasError && completedUrls.length < expectedNum
        ? getFailedImageGenerationError(finalResult, 'Some images failed to generate')
        : { error: undefined, errorCode: undefined, errorItemUuid: undefined }),
    })

    if (updatedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
    }
    return updatedRecord
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug('Resume generation aborted:', recordId)
      return null
    }
    if (!shouldPersistFailure) throw err

    log.error('Resume generation failed:', err)

    const failedRecord = await updateRecord(recordId, getErrorRecordUpdate(err))
    if (failedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, failedRecord.id], failedRecord)
    }
    return failedRecord
  } finally {
    releaseGenerationLock(attempt)
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
  }
}

export async function retryGeneration(recordId: string): Promise<void> {
  const attempt = acquireGenerationLock(recordId)
  try {
    const record = await platform.getImageGenerationStorage().getById(recordId)
    assertGenerationLock(attempt)
    if (!record) {
      throw new Error('Record not found')
    }

    log.debug('Retrying generation with completed outputs retained:', {
      recordId,
      previousTaskId: record.taskId,
    })

    await updateRecord(recordId, {
      taskId: undefined,
      status: 'pending',
      error: undefined,
      errorCode: undefined,
      errorItemUuid: undefined,
    })
    assertGenerationLock(attempt)

    const params: GenerateImageParams = {
      prompt: record.prompt,
      referenceImages: record.referenceImages,
      model: record.model,
      dalleStyle: record.dalleStyle,
      imageGenerateNum: record.imageGenerateNum,
      aspectRatio: record.aspectRatio,
    }

    const generation = shouldUseAsyncPath(params.model.provider)
      ? generateImages(recordId, params, attempt)
      : generateImagesDirect(recordId, params, attempt, record.generatedImages.length)
    void generation.finally(() => {
      releaseGenerationLock(attempt)
      queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      try {
        await markGenerationCancelled(recordId)
      } finally {
        releaseGenerationLock(attempt)
      }
      return
    }
    releaseGenerationLock(attempt)
    throw error
  }
}
