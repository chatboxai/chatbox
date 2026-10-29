import type { ImageGenerationServiceOptions } from '@chatbox/core/application/image-generation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  options: undefined as ImageGenerationServiceOptions | undefined,
  service: {
    subscribe: vi.fn(),
    subscribeRecords: vi.fn(),
    getSnapshot: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    getRecord: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(),
  },
  bridge: {},
  setCurrentRecordId: vi.fn(),
  setCurrentGeneratingId: vi.fn(),
  submit: vi.fn(),
  poll: vi.fn(),
  getModel: vi.fn(),
  getImage: vi.fn(),
  capabilities: vi.fn(),
  track: vi.fn(),
  storage: {},
  blobs: {},
  config: { uuid: 'config' },
  settings: { providers: {} },
}))

vi.mock('@chatbox/core/application/image-generation', () => ({
  ImageGenerationService: class {
    constructor(options: ImageGenerationServiceOptions) {
      mocks.options = options
      Object.assign(this, mocks.service)
    }
  },
}))
vi.mock('@chatbox/react', () => ({ getImageGenerationQueryBridge: () => mocks.bridge }))
vi.mock('@shared/providers', () => ({ getModel: mocks.getModel }))
vi.mock('@/adapters', () => ({ createModelDependencies: async () => ({ storage: { getImage: mocks.getImage } }) }))
vi.mock('@/adapters/CurrentBlobStorage', () => ({ currentBlobStorage: mocks.blobs }))
vi.mock('@/packages/image-model-catalog', () => ({ getImageModelCapabilities: mocks.capabilities }))
vi.mock('@/packages/remote', () => ({ submitImageGeneration: mocks.submit, pollImageTask: mocks.poll }))
vi.mock('@/platform', () => ({
  default: { getConfig: async () => mocks.config, getImageGenerationStorage: () => mocks.storage },
}))
vi.mock('@/storage/StoreStorage', () => ({ StorageKeyGenerator: { picture: (key: string) => `picture:${key}:uuid` } }))
vi.mock('./imageGenerationStore', () => ({
  imageGenerationStore: {
    getState: () => ({
      currentRecordId: null,
      setCurrentRecordId: mocks.setCurrentRecordId,
      setCurrentGeneratingId: mocks.setCurrentGeneratingId,
    }),
  },
}))
vi.mock('./queryClient', () => ({ queryClient: {} }))
vi.mock('./settingsStore', () => ({
  settingsStore: { getState: () => ({ licenseKey: 'license', getSettings: () => mocks.settings }) },
}))
vi.mock('@/analytics/plausible', () => ({
  normalizePlausibleProvider: (provider: string) => provider,
  normalizePlausibleModel: (_provider: string, model: string) => model,
}))
vi.mock('@/utils/track', () => ({ trackEvent: mocks.track }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: vi.fn() }) }))

import {
  cancelGeneration,
  clearCurrentRecord,
  createAndGenerate,
  getImageGenerationQueries,
  getImageGenerationService,
  isGenerating,
  loadRecord,
  resumeGeneration,
  retryGeneration,
  startImageGeneration,
} from './imageGenerationActions'

const params = { prompt: 'bird', referenceImages: [], model: { provider: 'chatbox-ai', modelId: 'gpt-image-1' } }

describe('renderer image-generation facade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.service.getSnapshot.mockReturnValue({ currentGeneratingId: null, phase: 'idle' })
    mocks.service.start.mockResolvedValue({ recordId: 'record', startedAt: 123, completion: Promise.resolve(null) })
  })

  it('shares one service and query bridge for renderer and CLI entry points', () => {
    expect(getImageGenerationService()).toBe(getImageGenerationService())
    expect(getImageGenerationQueries()).toBe(mocks.bridge)
    expect(mocks.options?.storage).toBe(mocks.storage)
    expect(mocks.options?.blobStorage).toBe(mocks.blobs)
  })

  it('forwards source, the durable-record callback and completion without changing the CLI contract', async () => {
    const onRecordCreated = vi.fn()
    const source = { type: 'chatbox_cli' as const, sessionId: 'session', toolCallId: 'tool' }
    const handle = await startImageGeneration({ ...params, source }, { onRecordCreated })
    expect(mocks.service.start).toHaveBeenCalledWith({ ...params, source }, { onRecordCreated })
    expect(mocks.setCurrentRecordId).toHaveBeenCalledWith('record')
    expect(handle.completion).toBeInstanceOf(Promise)
    await expect(createAndGenerate(params)).resolves.toBe('record')
  })

  it('delegates stop, retry, resume, loading and browsing without replacing the active job', async () => {
    getImageGenerationService()
    mocks.service.getRecord.mockResolvedValue({ id: 'history' })
    mocks.service.resume.mockResolvedValue({ id: 'task', status: 'done' })
    cancelGeneration()
    await retryGeneration('retry')
    await expect(resumeGeneration('task')).resolves.toEqual({ id: 'task', status: 'done' })
    await loadRecord('history')
    clearCurrentRecord()
    expect(mocks.service.cancel).toHaveBeenCalledOnce()
    expect(mocks.service.retry).toHaveBeenCalledWith('retry')
    expect(mocks.setCurrentRecordId.mock.calls).toEqual([['history'], [null]])
    mocks.service.getSnapshot.mockReturnValue({ currentGeneratingId: 'task', phase: 'generating' })
    expect(isGenerating()).toBe(true)
  })

  it('adapts shared requests to current host credentials and forwards the poll signal', async () => {
    getImageGenerationService()
    const request = {
      model: 'image',
      prompt: 'bird',
      response_format: 'b64_json' as const,
      style: 'vivid' as const,
      quantity: 1,
    }
    await mocks.options?.asyncClient.submit(request)
    const signal = new AbortController().signal
    await mocks.options?.asyncClient.poll('task', signal)
    expect(mocks.submit).toHaveBeenCalledWith(request, 'license')
    expect(mocks.poll).toHaveBeenCalledWith('task', 'license', signal)
  })

  it('uses the renderer model factory, storage resolver and current catalog validation', async () => {
    getImageGenerationService()
    await mocks.options?.createModel(params.model)
    expect(mocks.getModel).toHaveBeenCalledWith(
      params.model,
      mocks.settings,
      mocks.config,
      expect.objectContaining({ storage: expect.objectContaining({ getImage: mocks.getImage }) })
    )
    await mocks.options?.resolveReferenceImage('reference')
    expect(mocks.getImage).toHaveBeenCalledWith('reference')
    const signal = new AbortController().signal
    await mocks.options?.validateRequest?.(params, signal)
    expect(mocks.capabilities).toHaveBeenCalledWith(params.model, mocks.settings, signal)
    mocks.options?.onGenerate?.(params, 'direct')
    expect(mocks.track).toHaveBeenCalledWith(
      'generate_image',
      expect.objectContaining({ path: 'direct', num_images: 1 })
    )
  })
})
