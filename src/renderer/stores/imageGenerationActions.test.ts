import { beforeEach, describe, expect, it, vi } from 'vitest'

const submitImageGenerationMock = vi.fn()
const pollTaskUntilCompleteMock = vi.fn()
const pollImageTaskMock = vi.fn()
const createRecordMock = vi.fn()
const updateRecordMock = vi.fn()
const getImageGenerationByIdMock = vi.fn()
const setQueryDataMock = vi.fn()
const invalidateQueriesMock = vi.fn()
const getImageMock = vi.fn()
const setCurrentGeneratingIdMock = vi.fn()
const setCurrentRecordIdMock = vi.fn()
const trackEventMock = vi.fn()
const getImageModelCapabilitiesMock = vi.fn()
const getModelMock = vi.fn()
const addGeneratedImageMock = vi.fn()
const setBlobMock = vi.fn()
const removeBlobMock = vi.fn()
let currentGeneratingId: string | null = null

vi.mock('@shared/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/providers')>()
  return { ...actual, getModel: getModelMock }
})

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn(async () => ({
    storage: {
      getImage: getImageMock,
    },
  })),
}))

vi.mock('@/adapters/CurrentBlobStorage', () => ({
  currentBlobStorage: {
    set: setBlobMock,
    remove: removeBlobMock,
  },
}))

vi.mock('@/packages/remote', () => ({
  IMAGE_GENERATION_POLL_INTERVAL_MS: 2000,
  submitImageGeneration: submitImageGenerationMock,
  pollTaskUntilComplete: pollTaskUntilCompleteMock,
  pollImageTask: pollImageTaskMock,
}))

vi.mock('@/packages/image-model-catalog', () => ({
  getImageModelCapabilities: getImageModelCapabilitiesMock,
}))

vi.mock('./imageGenerationStore', () => ({
  IMAGE_GEN_LIST_QUERY_KEY: 'image-gen-list',
  IMAGE_GEN_QUERY_KEY: 'image-gen',
  createRecord: createRecordMock,
  updateRecord: updateRecordMock,
  addGeneratedImage: addGeneratedImageMock,
  imageGenerationStore: {
    getState: () => ({
      currentGeneratingId,
      currentRecordId: null,
      setCurrentGeneratingId: setCurrentGeneratingIdMock,
      setCurrentRecordId: setCurrentRecordIdMock,
    }),
  },
}))

vi.mock('./queryClient', () => ({
  queryClient: {
    setQueryData: setQueryDataMock,
    invalidateQueries: invalidateQueriesMock,
  },
}))

vi.mock('./settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      licenseKey: 'license-key',
      getSettings: () => ({ providers: {} }),
    }),
  },
}))

vi.mock('@/utils/track', () => ({
  trackEvent: trackEventMock,
}))

vi.mock('@/lib/utils', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('@/platform', () => ({
  default: {
    getConfig: vi.fn().mockResolvedValue({ uuid: 'config-1' }),
    getImageGenerationStorage: () => ({
      getById: getImageGenerationByIdMock,
    }),
  },
}))

vi.mock('@/storage', () => ({
  default: {},
}))

vi.mock('@/storage/StoreStorage', () => ({
  StorageKeyGenerator: {
    picture: vi.fn(() => 'generated-blob-key'),
  },
}))

describe('imageGenerationActions reference image payload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getModelMock.mockReset()
    getImageModelCapabilitiesMock.mockReset().mockResolvedValue(undefined)
    addGeneratedImageMock.mockResolvedValue({ id: 'record-1', generatedImages: ['generated-blob-key'] })
    setBlobMock.mockResolvedValue(undefined)
    removeBlobMock.mockResolvedValue(undefined)
    currentGeneratingId = null
    setCurrentGeneratingIdMock.mockImplementation((id: string | null) => {
      currentGeneratingId = id
    })

    createRecordMock.mockResolvedValue({ id: 'record-1', createdAt: 1_000 })
    updateRecordMock.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({ id, ...patch }))
    submitImageGenerationMock.mockResolvedValue({
      task_id: 'task-1',
      items: [{ status: 'pending' }],
    })
    pollTaskUntilCompleteMock.mockResolvedValue({
      items: [
        {
          status: 'completed',
          image_url: 'https://example.com/output.png',
          thumbnail_url: 'https://example.com/output.png?thumbnail=512x512',
        },
      ],
    })
    getImageMock.mockResolvedValue('data:image/png;base64,AAAA')
    getImageGenerationByIdMock.mockResolvedValue({
      id: 'record-1',
      prompt: 'make an image',
      referenceImages: [],
      generatedImages: [],
      createdAt: 1_000,
      model: { provider: 'chatbox-ai', modelId: 'gpt-image-1' },
      imageGenerateNum: 1,
      status: 'generating',
      taskId: 'task-1',
      source: {
        type: 'chatbox_cli',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
      },
    })
  })

  it('sends reference images as image_url entries for both URLs and stored images', async () => {
    const { createAndGenerate } = await import('./imageGenerationActions')

    await createAndGenerate({
      prompt: 'make a variation',
      referenceImages: ['https://example.com/reference.png', 'storage-key-1'],
      model: {
        provider: 'chatbox-ai',
        modelId: 'gpt-image-1',
      },
      imageGenerateNum: 1,
    })

    await vi.waitFor(() => {
      expect(submitImageGenerationMock).toHaveBeenCalledTimes(1)
    })

    expect(submitImageGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ image_url: 'https://example.com/reference.png' }, { image_url: 'data:image/png;base64,AAAA' }],
      }),
      'license-key'
    )
    expect(trackEventMock).toHaveBeenCalledWith('generate_image', expect.objectContaining({ has_reference: true }))
  })

  it('exposes a completion promise for background task consumers', async () => {
    const { startImageGeneration } = await import('./imageGenerationActions')

    const handle = await startImageGeneration({
      prompt: 'make an image',
      referenceImages: [],
      model: {
        provider: 'chatbox-ai',
        modelId: 'gpt-image-1',
      },
      imageGenerateNum: 1,
    })

    expect(handle).toMatchObject({
      recordId: 'record-1',
      startedAt: 1_000,
      monitoring: { mode: 'polling', intervalMs: 2_000 },
    })

    await expect(handle.completion).resolves.toMatchObject({
      id: 'record-1',
      status: 'done',
      generatedImages: ['https://example.com/output.png'],
    })
  })

  it('persists caller retry metadata before starting the provider request', async () => {
    let releasePersistence: (() => void) | undefined
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve
    })
    const onRecordCreated = vi.fn(async () => persistenceGate)
    const { startImageGeneration } = await import('./imageGenerationActions')

    const handlePromise = startImageGeneration(
      {
        prompt: 'make an image',
        referenceImages: [],
        model: {
          provider: 'chatbox-ai',
          modelId: 'gpt-image-1',
        },
      },
      { onRecordCreated }
    )

    await vi.waitFor(() => expect(onRecordCreated).toHaveBeenCalledOnce())
    expect(submitImageGenerationMock).not.toHaveBeenCalled()

    releasePersistence?.()
    await handlePromise
    await vi.waitFor(() => expect(submitImageGenerationMock).toHaveBeenCalledOnce())
  })

  it('claims the generation lock before creating the durable record', async () => {
    let resolveRecord: ((record: { id: string; createdAt: number }) => void) | undefined
    createRecordMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecord = resolve
        })
    )
    const { startImageGeneration } = await import('./imageGenerationActions')
    const params = {
      prompt: 'make an image',
      referenceImages: [],
      model: { provider: 'chatbox-ai', modelId: 'gpt-image-1' },
    }

    const firstStart = startImageGeneration(params)
    await vi.waitFor(() => expect(currentGeneratingId).not.toBeNull())
    await expect(startImageGeneration(params)).rejects.toThrow('Another image is being generated')
    expect(createRecordMock).toHaveBeenCalledOnce()

    resolveRecord?.({ id: 'record-1', createdAt: 1_000 })
    const handle = await firstStart
    await handle.completion
  })

  it('marks a record cancelled when Stop wins the durable-create race', async () => {
    let resolveRecord: ((record: { id: string; createdAt: number }) => void) | undefined
    createRecordMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecord = resolve
        })
    )
    const onRecordCreated = vi.fn()
    const { cancelGeneration, startImageGeneration } = await import('./imageGenerationActions')

    const start = startImageGeneration(
      {
        prompt: 'make an image',
        referenceImages: ['temporary-reference'],
        model: { provider: 'openrouter', modelId: 'seedream' },
      },
      { onRecordCreated }
    )
    await vi.waitFor(() => expect(currentGeneratingId).not.toBeNull())

    cancelGeneration()
    resolveRecord?.({ id: 'record-cancelled', createdAt: 1_000 })

    await expect(start).rejects.toThrow('Image generation was cancelled')
    expect(onRecordCreated).toHaveBeenCalledWith({ id: 'record-cancelled', createdAt: 1_000 })
    expect(updateRecordMock).toHaveBeenCalledWith(
      'record-cancelled',
      expect.objectContaining({ status: 'error', error: 'Image generation was cancelled.' })
    )
    expect(currentGeneratingId).toBeNull()
    expect(getModelMock).not.toHaveBeenCalled()
  })

  it('returns the terminal record when resuming an existing backend task', async () => {
    pollImageTaskMock.mockResolvedValueOnce({
      is_finished: true,
      items: [
        {
          status: 'completed',
          image_url: 'https://example.com/resumed.png',
          thumbnail_url: 'https://example.com/resumed-thumbnail.png',
        },
      ],
    })
    updateRecordMock.mockResolvedValueOnce({
      id: 'record-1',
      prompt: 'make an image',
      referenceImages: [],
      generatedImages: ['https://example.com/resumed.png'],
      generatedImageThumbnails: ['https://example.com/resumed-thumbnail.png'],
      createdAt: 1_000,
      model: { provider: 'chatbox-ai', modelId: 'gpt-image-1' },
      imageGenerateNum: 1,
      status: 'done',
      taskId: 'task-1',
      source: {
        type: 'chatbox_cli',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
      },
    })

    const { resumeGeneration } = await import('./imageGenerationActions')

    await expect(resumeGeneration('record-1')).resolves.toMatchObject({
      id: 'record-1',
      status: 'done',
      source: {
        type: 'chatbox_cli',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
      },
    })
  })

  it('stores structured error codes from Chatbox AI image generation failures', async () => {
    const { BaseError } = await import('@shared/models/errors')
    class StructuredImageGenerationError extends BaseError {
      public code = 20004
    }
    submitImageGenerationMock.mockRejectedValueOnce(new StructuredImageGenerationError('license not found'))

    const { createAndGenerate } = await import('./imageGenerationActions')

    await createAndGenerate({
      prompt: 'make an image',
      referenceImages: [],
      model: {
        provider: 'chatbox-ai',
        modelId: 'gpt-image-1',
      },
      imageGenerateNum: 1,
    })

    await vi.waitFor(() => {
      expect(updateRecordMock).toHaveBeenCalledWith(
        'record-1',
        expect.objectContaining({
          status: 'error',
          error: 'license not found',
          errorCode: 20004,
        })
      )
    })
  })

  it('stores thumbnail URLs separately from original image URLs', async () => {
    const { createAndGenerate } = await import('./imageGenerationActions')

    await createAndGenerate({
      prompt: 'make an image',
      referenceImages: [],
      model: {
        provider: 'chatbox-ai',
        modelId: 'gpt-image-1',
      },
      imageGenerateNum: 1,
    })

    await vi.waitFor(() => {
      expect(updateRecordMock).toHaveBeenCalledWith(
        'record-1',
        expect.objectContaining({
          generatedImages: ['https://example.com/output.png'],
          generatedImageThumbnails: ['https://example.com/output.png?thumbnail=512x512'],
          status: 'done',
        })
      )
    })
  })

  it('stores failed item error messages from async image generation results', async () => {
    pollTaskUntilCompleteMock.mockResolvedValueOnce({
      task_id: 'task-1',
      is_finished: true,
      items: [
        {
          uuid: 'item-1',
          status: 'failed',
          created_at: '2026-05-08T15:23:34.442+08:00',
          error_code: 'image_content_moderation_blocked',
          error_message: 'Content rejected by content moderation',
        },
      ],
    })

    const { createAndGenerate } = await import('./imageGenerationActions')

    await createAndGenerate({
      prompt: 'make an image',
      referenceImages: [],
      model: {
        provider: 'chatbox-ai',
        modelId: 'gpt-image-1',
      },
      imageGenerateNum: 1,
    })

    await vi.waitFor(() => {
      expect(updateRecordMock).toHaveBeenCalledWith(
        'record-1',
        expect.objectContaining({
          status: 'error',
          error: 'Content rejected by content moderation',
          errorCode: 'image_content_moderation_blocked',
          errorItemUuid: 'item-1',
        })
      )
    })
  })

  it('blocks OpenRouter when a required stored reference cannot be resolved', async () => {
    const paintMock = vi.fn()
    getImageMock.mockResolvedValueOnce(undefined)
    getModelMock.mockReturnValue({ paint: paintMock })

    const { createAndGenerate } = await import('./imageGenerationActions')
    await createAndGenerate({
      prompt: 'edit the image',
      referenceImages: ['missing-storage-key'],
      model: { provider: 'openrouter', modelId: 'edit-model' },
      imageGenerateNum: 1,
    })

    await vi.waitFor(() => {
      expect(updateRecordMock).toHaveBeenCalledWith(
        'record-1',
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining('A reference image could not be loaded'),
        })
      )
    })
    expect(getImageMock).toHaveBeenCalledWith('missing-storage-key')
    expect(getModelMock).not.toHaveBeenCalled()
    expect(paintMock).not.toHaveBeenCalled()
    expect(trackEventMock).not.toHaveBeenCalled()
  })

  it('blocks OpenRouter when any selected reference cannot be resolved', async () => {
    const paintMock = vi.fn()
    getImageMock.mockImplementation(async (key: string) =>
      key === 'stored-reference' ? 'data:image/png;base64,AAAA' : undefined
    )
    getModelMock.mockReturnValue({ paint: paintMock })

    const { createAndGenerate } = await import('./imageGenerationActions')
    await createAndGenerate({
      prompt: 'edit the image',
      referenceImages: ['https://example.com/reference.png', 'stored-reference', 'missing-storage-key'],
      model: { provider: 'openrouter', modelId: 'edit-model' },
      imageGenerateNum: 1,
    })

    await vi.waitFor(() => {
      expect(updateRecordMock).toHaveBeenCalledWith(
        'record-1',
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining('A reference image could not be loaded'),
        })
      )
    })
    expect(getModelMock).not.toHaveBeenCalled()
    expect(paintMock).not.toHaveBeenCalled()
    expect(trackEventMock).not.toHaveBeenCalled()
  })

  it('validates catalog capabilities for a new prompt-only request before calling the provider', async () => {
    getImageModelCapabilitiesMock.mockResolvedValueOnce({ aspectRatio: null, inputReferences: { min: 1 } })
    const { startImageGeneration } = await import('./imageGenerationActions')
    const handle = await startImageGeneration({
      prompt: 'edit an image',
      referenceImages: [],
      model: { provider: 'openrouter', modelId: 'edit-model' },
    })
    const record = await handle.completion
    expect(record).toMatchObject({
      status: 'error',
      error: expect.stringContaining('requires at least 1 reference image'),
    })
    expect(getModelMock).not.toHaveBeenCalled()
    expect(currentGeneratingId).toBeNull()
  })

  it('reloads OpenRouter capabilities before retrying and blocks an unsupported request', async () => {
    getImageGenerationByIdMock.mockResolvedValueOnce({
      id: 'record-openrouter',
      prompt: 'make an image',
      referenceImages: [],
      generatedImages: [],
      createdAt: 1_000,
      model: { provider: 'openrouter', modelId: 'seedream' },
      imageGenerateNum: 1,
      aspectRatio: '4:3',
      status: 'error',
    })
    getImageModelCapabilitiesMock.mockResolvedValueOnce({
      aspectRatio: { values: ['1:1', '16:9'] },
      inputReferences: null,
    })

    const { retryGeneration } = await import('./imageGenerationActions')
    await retryGeneration('record-openrouter')

    await vi.waitFor(() => {
      expect(updateRecordMock).toHaveBeenCalledWith(
        'record-openrouter',
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining('Choose Auto or one of: 1:1, 16:9'),
        })
      )
    })
    expect(getModelMock).not.toHaveBeenCalled()
  })

  it('claims the generation lock before loading retry capabilities', async () => {
    let resolveCatalog: ((models: undefined) => void) | undefined
    getImageGenerationByIdMock.mockResolvedValueOnce({
      id: 'record-openrouter',
      prompt: 'make an image',
      referenceImages: [],
      generatedImages: [],
      createdAt: 1_000,
      model: { provider: 'openrouter', modelId: 'seedream' },
      imageGenerateNum: 1,
      status: 'error',
    })
    getImageModelCapabilitiesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCatalog = resolve
        })
    )
    getModelMock.mockReturnValue({ paint: vi.fn().mockResolvedValue([]) })

    const { retryGeneration } = await import('./imageGenerationActions')
    const firstRetry = retryGeneration('record-openrouter')

    await vi.waitFor(() => expect(getImageModelCapabilitiesMock).toHaveBeenCalledOnce())
    await expect(retryGeneration('record-openrouter')).rejects.toThrow('Another image is being generated')
    expect(getImageGenerationByIdMock).toHaveBeenCalledTimes(1)

    resolveCatalog?.(undefined)
    await firstRetry
    await vi.waitFor(() => expect(currentGeneratingId).toBeNull())
  })

  it('settles a cancelled retry before releasing its generation lock', async () => {
    let resolveCatalog: ((models: undefined) => void) | undefined
    getImageGenerationByIdMock.mockResolvedValueOnce({
      id: 'record-openrouter',
      prompt: 'make an image',
      referenceImages: [],
      generatedImages: [],
      createdAt: 1_000,
      model: { provider: 'openrouter', modelId: 'seedream' },
      imageGenerateNum: 1,
      status: 'error',
    })
    getImageModelCapabilitiesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCatalog = resolve
        })
    )

    const { cancelGeneration, retryGeneration, startImageGeneration } = await import('./imageGenerationActions')
    const cancelledRetry = retryGeneration('record-openrouter')
    await vi.waitFor(() => expect(getImageModelCapabilitiesMock).toHaveBeenCalledOnce())

    cancelGeneration()
    expect(currentGeneratingId).toBe('record-openrouter')
    await expect(
      startImageGeneration({
        prompt: 'a new image',
        referenceImages: [],
        model: { provider: 'chatbox-ai', modelId: 'gpt-image-1' },
      })
    ).rejects.toThrow('Another image is being generated')

    resolveCatalog?.(undefined)
    await cancelledRetry
    await vi.waitFor(() => expect(currentGeneratingId).toBeNull())

    expect(getModelMock).not.toHaveBeenCalled()
    expect(updateRecordMock).toHaveBeenCalledWith(
      'record-openrouter',
      expect.objectContaining({ status: 'error', error: 'Image generation was cancelled.' })
    )
    expect(currentGeneratingId).toBeNull()

    const activeHandle = await startImageGeneration({
      prompt: 'a new image',
      referenceImages: [],
      model: { provider: 'chatbox-ai', modelId: 'gpt-image-1' },
    })
    await activeHandle.completion
  })

  it('retains completed output while a retry appends a new direct result', async () => {
    const record = {
      id: 'record-openrouter',
      prompt: 'make an image',
      referenceImages: [],
      generatedImages: ['picture:image-gen:old-output'],
      createdAt: 1_000,
      model: { provider: 'openrouter', modelId: 'seedream' },
      imageGenerateNum: 1,
      status: 'error',
    }
    getImageGenerationByIdMock.mockResolvedValue(record)
    getImageModelCapabilitiesMock.mockResolvedValue(undefined)
    getModelMock.mockReturnValue({
      paint: vi.fn().mockResolvedValue(['data:image/png;base64,NEW']),
    })

    const { retryGeneration } = await import('./imageGenerationActions')
    await retryGeneration('record-openrouter')

    await vi.waitFor(() => expect(addGeneratedImageMock).toHaveBeenCalledOnce())
    const pendingUpdate = updateRecordMock.mock.calls.find(
      ([id, patch]) => id === 'record-openrouter' && patch.status === 'pending'
    )?.[1]
    expect(pendingUpdate).not.toHaveProperty('generatedImages')
    expect(pendingUpdate).not.toHaveProperty('generatedImageThumbnails')
    expect(removeBlobMock).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(currentGeneratingId).toBeNull())
  })

  it('removes a generated blob when Stop wins before the record association', async () => {
    let finishBlobWrite: (() => void) | undefined
    setBlobMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishBlobWrite = resolve
        })
    )
    const paintMock = vi.fn(
      async (
        _params: unknown,
        _signal: AbortSignal,
        onImage: (picBase64: string) => Promise<void>
      ): Promise<string[]> => {
        await onImage('data:image/png;base64,OUTPUT')
        return ['data:image/png;base64,OUTPUT']
      }
    )
    getModelMock.mockReturnValue({ paint: paintMock })

    const { cancelGeneration, startImageGeneration } = await import('./imageGenerationActions')
    const handle = await startImageGeneration({
      prompt: 'make an image',
      referenceImages: [],
      model: { provider: 'openrouter', modelId: 'seedream' },
    })
    await vi.waitFor(() => expect(setBlobMock).toHaveBeenCalledOnce())

    cancelGeneration()
    finishBlobWrite?.()

    await expect(handle.completion).resolves.toMatchObject({
      id: 'record-1',
      status: 'error',
      error: 'Image generation was cancelled.',
    })
    expect(removeBlobMock).toHaveBeenCalledWith('generated-blob-key')
    expect(addGeneratedImageMock).not.toHaveBeenCalled()
    expect(currentGeneratingId).toBeNull()
  })

  it('removes a generated blob when its record association fails', async () => {
    addGeneratedImageMock.mockRejectedValueOnce(new Error('record write failed'))
    const paintMock = vi.fn(
      async (
        _params: unknown,
        _signal: AbortSignal,
        onImage: (picBase64: string) => Promise<void>
      ): Promise<string[]> => {
        await onImage('data:image/png;base64,OUTPUT')
        return ['data:image/png;base64,OUTPUT']
      }
    )
    getModelMock.mockReturnValue({ paint: paintMock })

    const { startImageGeneration } = await import('./imageGenerationActions')
    const handle = await startImageGeneration({
      prompt: 'make an image',
      referenceImages: [],
      model: { provider: 'openrouter', modelId: 'seedream' },
    })

    await expect(handle.completion).resolves.toMatchObject({
      id: 'record-1',
      status: 'error',
      error: 'record write failed',
    })
    expect(removeBlobMock).toHaveBeenCalledWith('generated-blob-key')
    expect(currentGeneratingId).toBeNull()
  })

  it('keeps a generated blob when a failed association was committed', async () => {
    addGeneratedImageMock.mockRejectedValueOnce(new Error('record write result lost'))
    getImageGenerationByIdMock.mockResolvedValueOnce({
      id: 'record-1',
      generatedImages: ['generated-blob-key'],
    })
    const paintMock = vi.fn(
      async (
        _params: unknown,
        _signal: AbortSignal,
        onImage: (picBase64: string) => Promise<void>
      ): Promise<string[]> => {
        await onImage('data:image/png;base64,OUTPUT')
        return ['data:image/png;base64,OUTPUT']
      }
    )
    getModelMock.mockReturnValue({ paint: paintMock })

    const { startImageGeneration } = await import('./imageGenerationActions')
    const handle = await startImageGeneration({
      prompt: 'make an image',
      referenceImages: [],
      model: { provider: 'openrouter', modelId: 'seedream' },
    })

    await handle.completion
    expect(removeBlobMock).not.toHaveBeenCalled()
    expect(currentGeneratingId).toBeNull()
  })
})
