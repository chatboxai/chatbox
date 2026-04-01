import { getModel } from '@shared/providers'
import type { ImageGeneration, ImageGenerationModel } from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { getLogger } from '@/lib/utils'
import { pollImageTask, pollTaskUntilComplete, submitImageGeneration } from '@/packages/remote'
import platform from '@/platform'
import storage from '@/storage'
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

// AbortController for cancelling in-flight polling
let currentAbortController: AbortController | null = null

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

export interface GenerateImageParams {
  prompt: string
  referenceImages: string[]
  model: ImageGenerationModel
  dalleStyle?: 'vivid' | 'natural'
  imageGenerateNum?: number
  aspectRatio?: string
  parentIds?: string[]
}

export function isGenerating(): boolean {
  return imageGenerationStore.getState().currentGeneratingId !== null
}

export async function createAndGenerate(params: GenerateImageParams): Promise<string> {
  const store = imageGenerationStore.getState()

  // Normalize: 'auto' means no aspect ratio constraint
  if (params.aspectRatio === 'auto') {
    params = { ...params, aspectRatio: undefined }
  }

  if (store.currentGeneratingId !== null) {
    throw new Error('Another image is being generated. Please wait.')
  }

  const record = await createRecord({
    prompt: params.prompt,
    referenceImages: params.referenceImages,
    model: params.model,
    dalleStyle: params.dalleStyle,
    imageGenerateNum: params.imageGenerateNum,
    parentIds: params.parentIds,
    aspectRatio: params.aspectRatio,
  })

  store.setCurrentGeneratingId(record.id)
  store.setCurrentRecordId(record.id)
  queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, record.id], record)

  const generateFn = shouldUseAsyncPath(params.model.provider) ? generateImages : generateImagesDirect
  void generateFn(record.id, params).finally(() => {
    imageGenerationStore.getState().setCurrentGeneratingId(null)
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
  })

  return record.id
}

async function generateImages(recordId: string, params: GenerateImageParams): Promise<void> {
  const licenseKey = getLicenseKey()
  const num = params.imageGenerateNum || 1

  // Create AbortController for this generation
  currentAbortController = new AbortController()
  const signal = currentAbortController.signal

  try {
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

    trackEvent('generate_image', {
      provider: params.model.provider,
      model: params.model.modelId,
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

    // Poll until all items are finished, progressively updating as images complete
    let lastCompletedCount = 0
    const finalResult = await pollTaskUntilComplete(submission.task_id, licenseKey, {
      signal,
      onPoll: async (response) => {
        const completedUrls = response.items
          .filter((item) => item.status === 'completed' && item.image_url)
          .map((item) => item.image_url!)
        if (completedUrls.length > lastCompletedCount) {
          lastCompletedCount = completedUrls.length
          currentRecord = await updateRecord(recordId, { generatedImages: completedUrls })
          if (currentRecord) {
            queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
          }
        }
      },
    })

    // Final update: set status based on results
    const completedUrls = finalResult.items
      .filter((item) => item.status === 'completed' && item.image_url)
      .map((item) => item.image_url!)
    const hasError = finalResult.items.some((item) => item.status === 'failed')

    if (completedUrls.length > 0) {
      currentRecord = await updateRecord(recordId, {
        generatedImages: completedUrls,
        status: hasError && completedUrls.length < num ? 'error' : 'done',
        error: hasError && completedUrls.length < num ? 'Some images failed to generate' : undefined,
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

    log.debug('Image generation completed:', recordId, 'urls:', completedUrls.length)
  } catch (err: unknown) {
    // Don't report abort errors as failures
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug('Image generation aborted:', recordId)
      return
    }

    const error = !(err instanceof Error) ? new Error(`${err}`) : err
    log.error('Image generation failed:', error)

    const updatedRecord = await updateRecord(recordId, {
      status: 'error',
      error: error.message,
    })
    if (updatedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
    }
  } finally {
    currentAbortController = null
  }
}

async function generateImagesDirect(recordId: string, params: GenerateImageParams): Promise<void> {
  const num = params.imageGenerateNum || 1

  currentAbortController = new AbortController()
  const signal = currentAbortController.signal

  try {
    let currentRecord = await updateRecord(recordId, { status: 'generating' })
    if (currentRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], currentRecord)
    }

    // Build model instance via provider registry
    const dependencies = await createModelDependencies()
    const globalSettings = settingsStore.getState().getSettings()
    const configs = await platform.getConfig()
    const sessionSettings = {
      provider: params.model.provider,
      modelId: params.model.modelId,
    }
    const model = getModel(sessionSettings, globalSettings, configs, dependencies)

    // Prepare reference images: storage keys → base64 data URLs
    const images: { imageUrl: string }[] = []
    for (const keyOrUrl of params.referenceImages) {
      if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
        images.push({ imageUrl: keyOrUrl })
        continue
      }
      const imageData = await dependencies.storage.getImage(keyOrUrl)
      if (imageData) {
        images.push({ imageUrl: imageData })
      }
    }

    trackEvent('generate_image', {
      provider: params.model.provider,
      model: params.model.modelId,
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
        const storageKey = StorageKeyGenerator.picture(`image-gen:${recordId}`)
        await storage.setBlob(storageKey, picBase64)
        const updated = await addGeneratedImage(recordId, storageKey)
        if (updated) {
          queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, recordId], updated)
        }
      }
    )

    // Final status based on how many images we got
    if (resultDataUrls.length > 0) {
      // Ensure all returned images are stored (in case callback wasn't called for some)
      const record = await platform.getImageGenerationStorage().getById(recordId)
      const existingCount = record?.generatedImages.length || 0
      if (existingCount < resultDataUrls.length) {
        for (let i = existingCount; i < resultDataUrls.length; i++) {
          const storageKey = StorageKeyGenerator.picture(`image-gen:${recordId}`)
          await storage.setBlob(storageKey, resultDataUrls[i])
          await addGeneratedImage(recordId, storageKey)
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
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug('Direct image generation aborted:', recordId)
      return
    }

    const error = !(err instanceof Error) ? new Error(`${err}`) : err
    log.error('Direct image generation failed:', error)

    const updatedRecord = await updateRecord(recordId, {
      status: 'error',
      error: error.message,
    })
    if (updatedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
    }
  } finally {
    currentAbortController = null
  }
}

export function cancelGeneration(): void {
  const store = imageGenerationStore.getState()
  if (store.currentGeneratingId) {
    // Abort in-flight polling requests
    if (currentAbortController) {
      currentAbortController.abort()
      currentAbortController = null
    }

    // Keep status as 'generating' so "Resume Generation" button appears
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

export async function resumeGeneration(recordId: string): Promise<void> {
  const store = imageGenerationStore.getState()

  if (store.currentGeneratingId !== null) {
    throw new Error('Another image is being generated. Please wait.')
  }

  const record = await platform.getImageGenerationStorage().getById(recordId)
  if (!record) {
    throw new Error('Record not found')
  }

  if (!record.taskId) {
    throw new Error('No task ID found for this record')
  }

  const licenseKey = getLicenseKey()
  store.setCurrentGeneratingId(recordId)

  // Create AbortController for resume operation
  currentAbortController = new AbortController()
  const signal = currentAbortController.signal

  try {
    // Check current status, then poll if not finished
    const currentStatus = await pollImageTask(record.taskId, licenseKey, signal)

    let finalResult = currentStatus
    if (!currentStatus.is_finished) {
      finalResult = await pollTaskUntilComplete(record.taskId, licenseKey, { signal })
    }

    // Collect successful image URLs into generatedImages
    const completedUrls: string[] = []
    let hasError = false

    for (const item of finalResult.items) {
      if (item.status === 'completed' && item.image_url) {
        completedUrls.push(item.image_url)
      } else if (item.status === 'failed') {
        hasError = true
        log.error('Image generation item failed on resume:', item.uuid)
      }
    }

    const expectedNum = record.imageGenerateNum || 1

    const updatedRecord = await updateRecord(recordId, {
      generatedImages: completedUrls,
      status: completedUrls.length >= expectedNum ? 'done' : hasError ? 'error' : 'done',
      error: hasError && completedUrls.length < expectedNum ? 'Some images failed to generate' : undefined,
    })

    if (updatedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, updatedRecord.id], updatedRecord)
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug('Resume generation aborted:', recordId)
      return
    }

    const error = !(err instanceof Error) ? new Error(`${err}`) : err
    log.error('Resume generation failed:', error)

    const failedRecord = await updateRecord(recordId, {
      status: 'error',
      error: error.message,
    })
    if (failedRecord) {
      queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, failedRecord.id], failedRecord)
    }
  } finally {
    currentAbortController = null
    imageGenerationStore.getState().setCurrentGeneratingId(null)
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
  }
}

export async function retryGeneration(recordId: string): Promise<void> {
  const store = imageGenerationStore.getState()

  if (store.currentGeneratingId !== null) {
    throw new Error('Another image is being generated. Please wait.')
  }

  const record = await platform.getImageGenerationStorage().getById(recordId)
  if (!record) {
    throw new Error('Record not found')
  }

  // Clear previous task data before retry to avoid confusion
  // This is intentional: retry means start fresh, not resume
  log.debug('Retrying generation, clearing previous task data:', {
    recordId,
    previousTaskId: record.taskId,
  })

  await updateRecord(recordId, {
    taskId: undefined,
    generatedImages: [],
    status: 'pending',
    error: undefined,
  })

  store.setCurrentGeneratingId(recordId)

  const params: GenerateImageParams = {
    prompt: record.prompt,
    referenceImages: record.referenceImages,
    model: record.model,
    dalleStyle: record.dalleStyle,
    imageGenerateNum: record.imageGenerateNum,
    aspectRatio: record.aspectRatio,
  }

  const generateFn = shouldUseAsyncPath(params.model.provider) ? generateImages : generateImagesDirect
  void generateFn(recordId, params).finally(() => {
    imageGenerationStore.getState().setCurrentGeneratingId(null)
    queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
  })
}
