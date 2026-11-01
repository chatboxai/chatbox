import { v4 as uuid } from 'uuid'
import type { ImageGeneration, ImageGenerationPage } from '../../types'
import type {
  GenerateImageParams,
  ImageGenerationHandle,
  ImageGenerationRecordEvent,
  ImageGenerationServiceOptions,
  ImageGenerationSnapshot,
  ImageGenerationTaskResponse,
  StartImageGenerationOptions,
} from './types'

export const IMAGE_GENERATION_POLL_INTERVAL_MS = 2000
const CANCELLED = 'Image generation was cancelled.'
const INTERRUPTED = 'Image generation was interrupted. Resume the existing task or retry explicitly.'
const UNSAVED_TASK =
  'An image task was submitted but could not be saved. Resume the existing task before generating again.'

interface Attempt {
  recordId: string
  controller: AbortController
  taskId?: string
  reason?: 'user' | 'background' | 'disposed' | 'deleted'
  callbacks: Promise<unknown>[]
}

function aborted(): Error {
  const error = new Error(CANCELLED)
  error.name = 'AbortError'
  return error
}

function errorUpdate(error: unknown): Partial<ImageGeneration> {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  return {
    status: 'error',
    error: error instanceof Error ? error.message : String(error),
    errorCode: typeof code === 'number' || typeof code === 'string' ? code : undefined,
    errorItemUuid: undefined,
  }
}

function completedImages(result: ImageGenerationTaskResponse) {
  const completed = result.items.filter(
    (item): item is typeof item & { image_url: string } => item.status === 'completed' && !!item.image_url
  )
  return {
    generatedImages: completed.map((item) => item.image_url),
    generatedImageThumbnails: completed.map((item) => item.thumbnail_url || item.image_url),
  }
}

function terminalUpdate(result: ImageGenerationTaskResponse, expected: number): Partial<ImageGeneration> {
  const images = completedImages(result)
  const failed = result.items.find((item) => item.status === 'failed')
  const isError = images.generatedImages.length === 0 || (!!failed && images.generatedImages.length < expected)
  return {
    ...(images.generatedImages.length ? images : {}),
    status: isError ? 'error' : 'done',
    error: isError
      ? failed?.error_message ||
        (images.generatedImages.length ? 'Some images failed to generate' : 'All images failed to generate')
      : undefined,
    errorCode: isError ? failed?.error_code : undefined,
    errorItemUuid: isError ? failed?.uuid : undefined,
  }
}

/** Owns durable image jobs independently of the currently visible screen. */
export class ImageGenerationService {
  private attempt: Attempt | null = null
  private snapshot: ImageGenerationSnapshot = { currentGeneratingId: null, phase: 'idle' }
  private readonly listeners = new Set<() => void>()
  private readonly idleWaiters = new Set<() => void>()
  private readonly recordListeners = new Set<(event: ImageGenerationRecordEvent) => void>()
  private readonly protectedReferences = new Map<symbol, readonly string[]>()
  private readonly deleted = new Set<string>()
  private readonly unpersistedTasks = new Map<string, ImageGeneration>()
  private readonly deferredCleanup = new Set<string>()
  private cleanupScheduled = false
  private writeTail: Promise<unknown> = Promise.resolve()
  private initialized: Promise<void> | undefined
  private foreground = true
  private disposed = false
  private backgroundRecordId: string | null = null

  constructor(private readonly options: ImageGenerationServiceOptions) {}

  getSnapshot = (): ImageGenerationSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeRecords = (listener: (event: ImageGenerationRecordEvent) => void): (() => void) => {
    this.recordListeners.add(listener)
    return () => this.recordListeners.delete(listener)
  }

  protectReferences(keys: readonly string[]): () => void {
    if (!keys.length) return () => {}
    const token = Symbol('image-draft')
    const references = [...keys]
    this.protectedReferences.set(token, references)
    return () => {
      if (!this.protectedReferences.delete(token)) return
      if (references.some((key) => this.deferredCleanup.has(key))) this.scheduleCleanup()
    }
  }

  private emit(event: ImageGenerationRecordEvent): void {
    for (const listener of this.recordListeners) {
      try {
        listener(event)
      } catch (error) {
        this.options.onError?.(error)
      }
    }
  }

  private setState(currentGeneratingId: string | null, phase: ImageGenerationSnapshot['phase']): void {
    this.snapshot = { currentGeneratingId, phase }
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        this.options.onError?.(error)
      }
    }
  }

  private initialize(): Promise<void> {
    this.initialized ??= this.options.storage.initialize().catch((error: unknown) => {
      this.initialized = undefined
      throw error
    })
    return this.initialized
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation)
    this.writeTail = result.catch(() => undefined)
    return result
  }

  private assert(attempt: Attempt): void {
    if (this.attempt !== attempt || attempt.controller.signal.aborted || this.deleted.has(attempt.recordId)) {
      throw aborted()
    }
  }

  private acquire(recordId: string, resumeUnpersisted = false): Attempt {
    if (this.disposed) throw new Error('Image generation service is disposed.')
    if (this.unpersistedTasks.size && !(resumeUnpersisted && this.unpersistedTasks.has(recordId))) {
      throw new Error(UNSAVED_TASK)
    }
    if (this.attempt || this.backgroundRecordId) throw new Error('Another image is being generated. Please wait.')
    const attempt: Attempt = { recordId, controller: new AbortController(), callbacks: [] }
    this.attempt = attempt
    this.setState(recordId, 'preparing')
    return attempt
  }

  private release(attempt: Attempt): void {
    if (this.attempt !== attempt) return
    this.attempt = null
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
    if (
      attempt.reason === 'background' &&
      attempt.taskId &&
      !this.deleted.has(attempt.recordId) &&
      !this.unpersistedTasks.has(attempt.recordId) &&
      !this.disposed
    ) {
      this.backgroundRecordId = attempt.recordId
      this.setState(attempt.recordId, 'paused')
      if (this.foreground) this.continueForeground()
    } else {
      this.setState(null, 'idle')
    }
  }

  private update(id: string, updates: Partial<ImageGeneration>, attempt?: Attempt): Promise<ImageGeneration | null> {
    return this.serialize(async () => {
      if (this.deleted.has(id)) return null
      if (attempt) this.assert(attempt)
      const record = await this.options.storage.update(id, updates)
      if (record) {
        if (record.taskId && record.taskId === this.unpersistedTasks.get(id)?.taskId) this.unpersistedTasks.delete(id)
        this.emit({ type: 'updated', record })
      }
      return record
    })
  }

  async getRecord(id: string): Promise<ImageGeneration | null> {
    await this.initialize()
    return this.unpersistedTasks.get(id) ?? this.options.storage.getById(id)
  }

  async getPage(cursor: number, limit?: number): Promise<ImageGenerationPage> {
    await this.initialize()
    const page = await this.options.storage.getPage(cursor, limit)
    return { ...page, items: page.items.map((record) => this.unpersistedTasks.get(record.id) ?? record) }
  }

  /** Cold-start reconciliation never automatically sends or resumes a provider request. */
  async bootstrap(): Promise<void> {
    await this.initialize()
    let cursor: number | null = 0
    while (cursor !== null) {
      const page: ImageGenerationPage = await this.options.storage.getPage(cursor, 100)
      for (const record of page.items) {
        if ((record.status === 'pending' || record.status === 'generating') && this.attempt?.recordId !== record.id) {
          await this.update(record.id, {
            status: 'error',
            error: INTERRUPTED,
            errorCode: undefined,
            errorItemUuid: undefined,
          })
        }
      }
      cursor = page.nextCursor
    }
  }

  async start(params: GenerateImageParams, options: StartImageGenerationOptions = {}): Promise<ImageGenerationHandle> {
    const attempt = this.acquire('__starting-image-generation__')
    const releaseReferences = this.protectReferences(params.referenceImages)
    let record: ImageGeneration | undefined
    try {
      if (!params.prompt.trim()) throw new Error('Enter a prompt before generating an image.')
      if (!params.model.provider || !params.model.modelId) throw new Error('Select an image model before generating.')
      const normalized = {
        ...params,
        model: { ...params.model },
        referenceImages: [...params.referenceImages],
        parentIds: params.parentIds ? [...new Set(params.parentIds)] : undefined,
        aspectRatio: params.aspectRatio === 'auto' ? undefined : params.aspectRatio,
      }
      await this.initialize()
      record = {
        ...normalized,
        id: this.options.createId?.() ?? uuid(),
        createdAt: this.options.now?.() ?? Date.now(),
        status: 'pending',
        generatedImages: [],
      }
      const created = record
      await this.serialize(() => this.options.storage.create(created))
      this.emit({ type: 'created', record })
      await options.onRecordCreated?.(record)
      this.assert(attempt)
      attempt.recordId = record.id
      this.setState(record.id, 'preparing')
      return this.handle(record, attempt, this.generate(record, attempt))
    } catch (error) {
      try {
        if (record) await this.update(record.id, errorUpdate(error))
      } finally {
        this.release(attempt)
      }
      throw error
    } finally {
      releaseReferences()
    }
  }

  async createAndGenerate(params: GenerateImageParams, options?: StartImageGenerationOptions): Promise<string> {
    return (await this.start(params, options)).recordId
  }

  private handle(
    record: ImageGeneration,
    attempt: Attempt,
    completion: Promise<ImageGeneration | null>
  ): ImageGenerationHandle {
    const settled = completion.finally(() => this.release(attempt))
    // UI callers may consume only the ID; a persistence failure still remains observable to completion consumers.
    void settled.catch((error: unknown) => this.options.onError?.(error))
    return {
      recordId: record.id,
      startedAt: record.createdAt,
      monitoring:
        record.model.provider === 'chatbox-ai'
          ? { mode: 'polling', intervalMs: this.options.pollIntervalMs ?? IMAGE_GENERATION_POLL_INTERVAL_MS }
          : { mode: 'direct' },
      completion: settled,
    }
  }

  private async references(params: GenerateImageParams, attempt: Attempt): Promise<string[]> {
    const references: string[] = []
    for (const key of params.referenceImages) {
      this.assert(attempt)
      const data = /^(https?:\/\/|data:)/.test(key) ? key : await this.options.resolveReferenceImage(key)
      if (!data)
        throw new Error('A reference image could not be loaded. Remove it and add the image again before generating.')
      references.push(data)
    }
    this.assert(attempt)
    return references
  }

  private async generate(record: ImageGeneration, attempt: Attempt): Promise<ImageGeneration | null> {
    try {
      await this.update(record.id, { status: 'generating' }, attempt)
      const references = await this.references(record, attempt)
      await this.options.validateRequest?.(record, attempt.controller.signal)
      this.assert(attempt)
      this.setState(record.id, 'generating')
      if (record.model.provider === 'chatbox-ai') {
        this.options.onGenerate?.(record, 'async')
        const submission = await this.options.asyncClient.submit({
          model: record.model.modelId,
          prompt: record.prompt,
          response_format: 'b64_json',
          style: record.dalleStyle || 'vivid',
          aspect_ratio: record.aspectRatio,
          quantity: record.imageGenerateNum || 1,
          images: references.length ? references.map((image_url) => ({ image_url })) : undefined,
        })
        attempt.taskId = submission.task_id
        if (!this.deleted.has(record.id)) {
          this.unpersistedTasks.set(record.id, {
            ...record,
            taskId: submission.task_id,
            status: 'generating',
          })
        }
        // A local stop cannot discard the identity of an already submitted billable task.
        await this.update(record.id, { taskId: submission.task_id })
        this.assert(attempt)
        return await this.monitor(record, attempt)
      }
      const model = await this.options.createModel(record.model)
      this.assert(attempt)
      this.options.onGenerate?.(record, 'direct')
      let callbackCount = 0
      let acceptsCallbacks = true
      const results = await model
        .paint(
          {
            prompt: record.prompt,
            images: references.length ? references.map((imageUrl) => ({ imageUrl })) : undefined,
            num: record.imageGenerateNum || 1,
            aspectRatio: record.aspectRatio,
          },
          attempt.controller.signal,
          (data) => {
            if (!acceptsCallbacks) return
            callbackCount += 1
            const pending = this.persistImage(record.id, data, attempt).then(() => undefined)
            attempt.callbacks.push(pending)
            void pending.catch(() => undefined)
            return pending
          }
        )
        .finally(() => {
          acceptsCallbacks = false
        })
      await Promise.all(attempt.callbacks)
      this.assert(attempt)
      for (const data of results.slice(callbackCount)) await this.persistImage(record.id, data, attempt)
      const successful = results.length >= (record.imageGenerateNum || 1)
      return await this.update(
        record.id,
        {
          status: successful ? 'done' : 'error',
          error: successful
            ? undefined
            : results.length
              ? 'Some images failed to generate'
              : 'All images failed to generate',
          errorCode: undefined,
          errorItemUuid: undefined,
        },
        attempt
      )
    } catch (error) {
      await Promise.allSettled(attempt.callbacks)
      return this.fail(record.id, attempt, error)
    }
  }

  private persistImage(recordId: string, data: string, attempt: Attempt): Promise<ImageGeneration | null> {
    return this.serialize(async () => {
      this.assert(attempt)
      const key = this.options.createImageKey?.(recordId) ?? `picture:image-gen:${recordId}:${uuid()}`
      let associationAttempted = false
      try {
        await this.options.blobStorage.set(key, data)
        this.assert(attempt)
        const record = await this.options.storage.getById(recordId)
        this.assert(attempt)
        if (!record) throw new Error('Image generation record no longer exists.')
        associationAttempted = true
        const updated = await this.options.storage.update(recordId, {
          generatedImages: [...record.generatedImages, key],
        })
        if (!updated) throw new Error('Image generation record no longer exists.')
        this.emit({ type: 'updated', record: updated })
        return updated
      } catch (error) {
        try {
          const linked =
            associationAttempted && (await this.options.storage.getById(recordId))?.generatedImages.includes(key)
          if (!linked) await this.options.blobStorage.remove(key)
        } catch (cleanupError) {
          this.options.onError?.(cleanupError)
        }
        throw error
      }
    })
  }

  private async monitor(record: ImageGeneration, attempt: Attempt): Promise<ImageGeneration | null> {
    const taskId = attempt.taskId
    if (!taskId) throw new Error('No task ID found for this record')
    let completedCount = 0
    while (true) {
      this.assert(attempt)
      const response = await this.options.asyncClient.poll(taskId, attempt.controller.signal)
      this.assert(attempt)
      if (response.is_finished)
        return this.update(record.id, terminalUpdate(response, record.imageGenerateNum || 1), attempt)
      const images = completedImages(response)
      if (images.generatedImages.length > completedCount) {
        completedCount = images.generatedImages.length
        await this.update(record.id, images, attempt)
      }
      await this.waitForPoll(attempt.controller.signal)
    }
  }

  private waitForPoll(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        reject(aborted())
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, this.options.pollIntervalMs ?? IMAGE_GENERATION_POLL_INTERVAL_MS)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  private fail(recordId: string, attempt: Attempt, error: unknown): Promise<ImageGeneration | null> {
    if (this.deleted.has(recordId)) return Promise.resolve(null)
    if (
      !this.unpersistedTasks.has(recordId) &&
      (attempt.controller.signal.aborted || (error instanceof Error && error.name === 'AbortError'))
    ) {
      if (attempt.taskId) return Promise.resolve(null)
      return this.update(recordId, {
        status: 'error',
        error: attempt.reason === 'background' ? INTERRUPTED : CANCELLED,
        errorCode: undefined,
        errorItemUuid: undefined,
      })
    }
    this.options.onError?.(error)
    // Retain a known task ID even when the first persistence acknowledgement failed.
    return this.update(recordId, {
      ...errorUpdate(error),
      ...(attempt.taskId ? { taskId: attempt.taskId } : {}),
    }).catch((persistenceError: unknown) => {
      const submitted = this.unpersistedTasks.get(recordId)
      if (!submitted || this.deleted.has(recordId)) throw persistenceError
      const recoverable: ImageGeneration = {
        ...submitted,
        status: 'error',
        error: UNSAVED_TASK,
        errorCode: 'image_task_persistence_failed',
        errorItemUuid: undefined,
      }
      this.unpersistedTasks.set(recordId, recoverable)
      this.options.onError?.(persistenceError)
      this.emit({ type: 'updated', record: recoverable })
      return recoverable
    })
  }

  waitForIdle(): Promise<void> {
    if (!this.attempt) return this.writeTail.then(() => undefined)
    return new Promise((resolve) => this.idleWaiters.add(resolve))
  }

  cancel(): Promise<void> {
    this.backgroundRecordId = null
    if (this.attempt) {
      this.attempt.reason = 'user'
      this.setState(this.attempt.recordId, 'stopping')
      this.attempt.controller.abort()
    } else {
      this.setState(null, 'idle')
    }
    return this.waitForIdle()
  }

  async resume(recordId: string): Promise<ImageGeneration | null> {
    const attempt = this.acquire(recordId, true)
    let record: ImageGeneration | null = null
    try {
      record = await this.getRecord(recordId)
      this.assert(attempt)
      if (!record) throw new Error('Record not found')
      if (!record.taskId) throw new Error('No task ID found for this record')
      attempt.taskId = record.taskId
      await this.update(
        recordId,
        {
          taskId: record.taskId,
          status: 'generating',
          error: undefined,
          errorCode: undefined,
          errorItemUuid: undefined,
        },
        attempt
      )
      this.setState(recordId, 'generating')
      return await this.monitor(record, attempt)
    } catch (error) {
      if (!record?.taskId) throw error
      return await this.fail(recordId, attempt, error)
    } finally {
      this.release(attempt)
    }
  }

  async retry(recordId: string): Promise<ImageGenerationHandle> {
    const attempt = this.acquire(recordId)
    try {
      const record = await this.getRecord(recordId)
      this.assert(attempt)
      if (!record) throw new Error('Record not found')
      const updated = await this.update(
        recordId,
        {
          taskId: undefined,
          status: 'pending',
          error: undefined,
          errorCode: undefined,
          errorItemUuid: undefined,
        },
        attempt
      )
      this.assert(attempt)
      if (!updated) throw new Error('Record not found')
      return this.handle(updated, attempt, this.generate(updated, attempt))
    } catch (error) {
      try {
        if (error instanceof Error && error.name === 'AbortError') await this.fail(recordId, attempt, error)
      } finally {
        this.release(attempt)
      }
      throw error
    }
  }

  setForeground(foreground: boolean): void {
    this.foreground = foreground
    if (!foreground && this.attempt && !this.attempt.reason) {
      this.attempt.reason = 'background'
      this.setState(this.attempt.recordId, 'stopping')
      this.attempt.controller.abort()
    } else if (foreground) {
      this.continueForeground()
    }
  }

  private continueForeground(): void {
    if (this.attempt || !this.backgroundRecordId || this.disposed) return
    const recordId = this.backgroundRecordId
    this.backgroundRecordId = null
    void this.resume(recordId).catch((error: unknown) => this.options.onError?.(error))
  }

  async deleteRecord(id: string): Promise<void> {
    this.deleted.add(id)
    if (this.backgroundRecordId === id) {
      this.backgroundRecordId = null
      if (!this.attempt) this.setState(null, 'idle')
    }
    if (this.attempt?.recordId === id) {
      this.attempt.reason = 'deleted'
      this.attempt.controller.abort()
    }
    try {
      await this.initialize()
      await this.serialize(async () => {
        const record = await this.options.storage.getById(id)
        if (!record) {
          this.unpersistedTasks.delete(id)
          return
        }
        await this.options.storage.delete(id)
        this.unpersistedTasks.delete(id)
        this.emit({ type: 'deleted', id })
        for (const key of [...record.referenceImages, ...record.generatedImages]) {
          if (key.startsWith('picture:image-gen:') || key.startsWith('picture:image-creator-ref:')) {
            this.deferredCleanup.add(key)
          }
        }
        await this.cleanupCandidates()
      })
    } catch (error) {
      this.deleted.delete(id)
      throw error
    }
  }

  private scheduleCleanup(): void {
    if (this.cleanupScheduled || !this.deferredCleanup.size) return
    this.cleanupScheduled = true
    void this.serialize(async () => {
      this.cleanupScheduled = false
      await this.cleanupCandidates()
    }).catch((error: unknown) => this.options.onError?.(error))
  }

  private async cleanupCandidates(): Promise<void> {
    if (!this.deferredCleanup.size) return
    const references = new Set<string>()
    let cursor: number | null = 0
    try {
      while (cursor !== null) {
        const page: ImageGenerationPage = await this.options.storage.getPage(cursor, 100)
        for (const record of page.items) {
          for (const key of [...record.referenceImages, ...record.generatedImages]) references.add(key)
        }
        cursor = page.nextCursor
      }
    } catch (error) {
      this.options.onError?.(error)
      return
    }
    for (const key of this.deferredCleanup) {
      if (references.has(key)) {
        this.deferredCleanup.delete(key)
        continue
      }
      if ([...this.protectedReferences.values()].some((keys) => keys.includes(key))) continue
      try {
        await this.options.blobStorage.remove(key)
        this.deferredCleanup.delete(key)
      } catch (error) {
        this.options.onError?.(error)
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.backgroundRecordId = null
    if (this.attempt) {
      this.attempt.reason = 'disposed'
      this.attempt.controller.abort()
    }
    this.listeners.clear()
    this.recordListeners.clear()
    await this.waitForIdle()
    this.protectedReferences.clear()
    this.scheduleCleanup()
    await this.waitForIdle()
  }
}
