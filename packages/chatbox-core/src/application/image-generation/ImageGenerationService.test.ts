import { AbortController as ReactNativeAbortController, AbortSignal as ReactNativeAbortSignal } from 'abort-controller'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlobStoragePort, ImageGenerationStoragePort } from '../../ports'
import type { ImageGeneration } from '../../types'
import { ImageGenerationService } from './ImageGenerationService'
import type { GenerateImageParams, ImageGenerationServiceOptions, ImageGenerationTaskResponse } from './types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const params: GenerateImageParams = {
  prompt: 'a blue bird',
  referenceImages: [],
  model: { provider: 'chatbox-ai', modelId: 'gpt-image-1' },
}
const done: ImageGenerationTaskResponse = {
  task_id: 'task-1',
  is_finished: true,
  items: [
    {
      uuid: 'item-1',
      status: 'completed',
      image_url: 'https://images.test/original',
      thumbnail_url: 'https://images.test/thumb',
    },
  ],
}
const pending: ImageGenerationTaskResponse = { task_id: 'task-1', is_finished: false, items: [] }

function fixture(overrides: Partial<ImageGenerationServiceOptions> = {}) {
  const records = new Map<string, ImageGeneration>()
  const blobs = new Map<string, string>()
  let nextId = 0
  const storage = {
    initialize: vi.fn(async () => {}),
    create: vi.fn(async (record: ImageGeneration) => {
      records.set(record.id, structuredClone(record))
    }),
    update: vi.fn(async (id: string, updates: Partial<ImageGeneration>) => {
      const previous = records.get(id)
      if (!previous) return null
      const record = { ...previous, ...structuredClone(updates) }
      records.set(id, record)
      return record
    }),
    getById: vi.fn(async (id: string) => records.get(id) ?? null),
    delete: vi.fn(async (id: string) => {
      records.delete(id)
    }),
    getPage: vi.fn(async (cursor: number, limit = 20) => {
      const items = [...records.values()].sort((a, b) => b.createdAt - a.createdAt)
      return {
        items: items.slice(cursor, cursor + limit),
        total: items.length,
        nextCursor: cursor + limit < items.length ? cursor + limit : null,
      }
    }),
    getTotal: vi.fn(async () => records.size),
  } satisfies ImageGenerationStoragePort
  const blobStorage = {
    get: vi.fn(async (key: string) => blobs.get(key) ?? null),
    set: vi.fn(async (key: string, data: string) => {
      blobs.set(key, data)
    }),
    remove: vi.fn(async (key: string) => {
      blobs.delete(key)
    }),
    keys: vi.fn(async () => [...blobs.keys()]),
  } satisfies BlobStoragePort
  const submit = vi.fn(async () => pending)
  const poll = vi.fn<ImageGenerationServiceOptions['asyncClient']['poll']>(async () => done)
  const paint = vi
    .fn<Awaited<ReturnType<ImageGenerationServiceOptions['createModel']>>['paint']>()
    .mockResolvedValue(['data:image/png;base64,AAAA'])
  const validateRequest = vi.fn(async () => {})
  const service = new ImageGenerationService({
    storage,
    blobStorage,
    asyncClient: { submit, poll },
    createModel: async () => ({ paint }),
    resolveReferenceImage: blobStorage.get,
    createId: () => `record-${++nextId}`,
    createImageKey: (id) => `picture:image-gen:${id}:${++nextId}`,
    pollIntervalMs: 0,
    validateRequest,
    ...overrides,
  })
  return { service, storage, blobStorage, records, blobs, submit, poll, paint, validateRequest }
}

async function existing(f: ReturnType<typeof fixture>, patch: Partial<ImageGeneration> = {}) {
  const record: ImageGeneration = {
    ...params,
    id: 'existing',
    createdAt: 1,
    generatedImages: [],
    status: 'error',
    ...patch,
  }
  await f.storage.create(record)
  return record
}

beforeEach(() => {
  vi.stubGlobal('AbortController', ReactNativeAbortController)
  vi.stubGlobal('AbortSignal', ReactNativeAbortSignal)
})
afterEach(() => vi.unstubAllGlobals())

describe('ImageGenerationService', () => {
  it.each(['user', 'background'] as const)(
    'classifies an ordinary native fetch error after %s cancellation and releases its lock',
    async (reason) => {
      const nativeError = new Error('fetch failed: FetchRequestCanceledException: Fetch request has been canceled')
      const onError = vi.fn()
      const f = fixture({ onError })
      f.paint.mockImplementationOnce(
        (_params, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(nativeError), { once: true })
          })
      )
      const handle = await f.service.start({ ...params, model: { provider: 'openai', modelId: 'gpt-image-1' } })
      await vi.waitFor(() => expect(f.paint).toHaveBeenCalledOnce())
      if (reason === 'user') await f.service.cancel()
      else {
        f.service.setForeground(false)
        await f.service.waitForIdle()
      }
      await expect(handle.completion).resolves.toMatchObject({
        status: 'error',
        error:
          reason === 'user'
            ? 'Image generation was cancelled.'
            : 'Image generation was interrupted. Resume the existing task or retry explicitly.',
      })
      expect(onError).not.toHaveBeenCalled()
      expect(f.service.getSnapshot()).toMatchObject({ currentGeneratingId: null, phase: 'idle' })
      f.service.setForeground(true)
      expect(f.submit).not.toHaveBeenCalled()
      await expect((await f.service.start(params)).completion).resolves.toMatchObject({ status: 'done' })
    }
  )

  it.each(['user', 'background'] as const)(
    'preserves the submitted task when %s cancellation rejects polling with a native Error',
    async (reason) => {
      const nativeError = new Error('fetch failed: FetchRequestCanceledException: Fetch request has been canceled')
      const onError = vi.fn()
      const f = fixture({ onError })
      f.poll.mockImplementationOnce(
        (_taskId, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(nativeError), { once: true })
          })
      )
      const handle = await f.service.start(params)
      await vi.waitFor(() => expect(f.poll).toHaveBeenCalledOnce())
      if (reason === 'user') await f.service.cancel()
      else {
        f.service.setForeground(false)
        await f.service.waitForIdle()
        expect(f.service.getSnapshot()).toEqual({ currentGeneratingId: handle.recordId, phase: 'paused' })
      }
      await expect(handle.completion).resolves.toBeNull()
      expect(await f.service.getRecord(handle.recordId)).toMatchObject({ status: 'generating', taskId: 'task-1' })
      expect(onError).not.toHaveBeenCalled()
      if (reason === 'user') await f.service.resume(handle.recordId)
      else {
        f.service.setForeground(true)
        await f.service.waitForIdle()
      }
      expect(await f.service.getRecord(handle.recordId)).toMatchObject({ status: 'done', taskId: 'task-1' })
      expect(f.submit).toHaveBeenCalledOnce()
      expect(f.poll).toHaveBeenCalledTimes(2)
    }
  )

  it('reports an ordinary native fetch error when its attempt was not canceled', async () => {
    const nativeError = new Error('fetch failed: FetchRequestCanceledException: Fetch request has been canceled')
    const onError = vi.fn()
    const f = fixture({ onError })
    f.paint.mockRejectedValueOnce(nativeError)
    const handle = await f.service.start({ ...params, model: { provider: 'openai', modelId: 'gpt-image-1' } })
    await expect(handle.completion).resolves.toMatchObject({ status: 'error', error: nativeError.message })
    expect(onError).toHaveBeenCalledExactlyOnceWith(nativeError)
  })

  it('persists source and caller retry metadata before the billable request and exposes completion', async () => {
    const f = fixture()
    const callback = deferred<void>()
    const source = { type: 'chatbox_cli' as const, sessionId: 'session', toolCallId: 'tool' }
    const starting = f.service.start(
      { ...params, source, parentIds: ['one', 'one'] },
      {
        onRecordCreated: async (record) => {
          expect(f.records.get(record.id)?.source).toEqual(source)
          expect(f.submit).not.toHaveBeenCalled()
          await callback.promise
        },
      }
    )
    await vi.waitFor(() => expect(f.records.size).toBe(1))
    await expect(f.service.start(params)).rejects.toThrow('Another image')
    callback.resolve()
    const handle = await starting
    expect(handle.monitoring).toEqual({ mode: 'polling', intervalMs: 0 })
    await expect(handle.completion).resolves.toMatchObject({
      status: 'done',
      source,
      parentIds: ['one'],
      generatedImageThumbnails: ['https://images.test/thumb'],
    })
    expect(f.service.getSnapshot().currentGeneratingId).toBeNull()
  })

  it('does not charge if durable creation or onRecordCreated fails', async () => {
    const f = fixture()
    f.storage.create.mockRejectedValueOnce(new Error('disk full'))
    await expect(f.service.start(params)).rejects.toThrow('disk full')
    await expect(
      f.service.start(params, {
        onRecordCreated: () => {
          throw new Error('caller failed')
        },
      })
    ).rejects.toThrow('caller failed')
    expect(f.submit).not.toHaveBeenCalled()
    expect([...f.records.values()][0].status).toBe('error')
    expect(f.service.getSnapshot().phase).toBe('idle')
  })

  it('holds its lock and marks cancellation when Stop wins durable creation', async () => {
    const f = fixture()
    const gate = deferred<void>()
    f.storage.create.mockImplementationOnce(async (record) => {
      await gate.promise
      f.records.set(record.id, record)
    })
    const starting = f.service.start(params)
    const rejected = expect(starting).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(f.storage.create).toHaveBeenCalled())
    f.service.cancel()
    await expect(f.service.start(params)).rejects.toThrow('Another image')
    gate.resolve()
    await rejected
    expect([...f.records.values()][0]).toMatchObject({ status: 'error', error: 'Image generation was cancelled.' })
    expect(f.submit).not.toHaveBeenCalled()
  })

  it('saves a late submission ID after Stop and resumes by GET without another POST', async () => {
    const f = fixture()
    const submitted = deferred<ImageGenerationTaskResponse>()
    f.submit.mockReturnValueOnce(submitted.promise)
    const handle = await f.service.start(params)
    await vi.waitFor(() => expect(f.submit).toHaveBeenCalledOnce())
    f.service.cancel()
    await expect(f.service.start(params)).rejects.toThrow('Another image')
    submitted.resolve(pending)
    await handle.completion
    expect(f.records.get(handle.recordId)?.taskId).toBe('task-1')
    expect(f.poll).not.toHaveBeenCalled()
    await expect(f.service.resume(handle.recordId)).resolves.toMatchObject({ status: 'done' })
    expect(f.submit).toHaveBeenCalledOnce()
  })

  it('retains task identity after its first persistence acknowledgement fails', async () => {
    const f = fixture()
    const update = f.storage.update.getMockImplementation()!
    f.storage.update.mockImplementation(async (id, patch) => {
      if (patch.taskId && !patch.error) throw new Error('task write failed')
      return update(id, patch)
    })
    const handle = await f.service.start(params)
    await expect(handle.completion).resolves.toMatchObject({
      taskId: 'task-1',
      status: 'error',
      error: 'task write failed',
    })
    expect(f.submit).toHaveBeenCalledOnce()
    expect(f.poll).not.toHaveBeenCalled()
  })

  it.each([
    { reason: 'user', failedWrites: 1 },
    { reason: 'background', failedWrites: 1 },
    { reason: 'user', failedWrites: 2 },
    { reason: 'background', failedWrites: 2 },
  ] as const)(
    'exposes the submitted task after $reason cancellation and $failedWrites failed writes',
    async ({ reason, failedWrites }) => {
      const f = fixture()
      const submitted = deferred<ImageGenerationTaskResponse>()
      f.submit.mockReturnValueOnce(submitted.promise)
      const update = f.storage.update.getMockImplementation()!
      let remainingFailures = failedWrites
      f.storage.update.mockImplementation(async (id, patch) => {
        if (patch.taskId && remainingFailures > 0) {
          remainingFailures -= 1
          throw new Error('task write failed')
        }
        return update(id, patch)
      })
      const changes: ImageGeneration[] = []
      f.service.subscribeRecords((event) => {
        if (event.type !== 'deleted') changes.push(event.record)
      })

      const handle = await f.service.start(params)
      await vi.waitFor(() => expect(f.submit).toHaveBeenCalledOnce())
      if (reason === 'user') void f.service.cancel()
      else f.service.setForeground(false)
      submitted.resolve(pending)

      const result = await handle.completion
      expect(result).toMatchObject({
        taskId: 'task-1',
        status: 'error',
        ...(failedWrites === 1 ? { error: 'task write failed' } : { errorCode: 'image_task_persistence_failed' }),
      })
      expect(changes.at(-1)).toEqual(result)
      expect(f.records.get(handle.recordId)?.taskId).toBe(failedWrites === 1 ? 'task-1' : undefined)
      expect(f.poll).not.toHaveBeenCalled()

      if (failedWrites === 2) {
        expect(f.service.getSnapshot()).toEqual({ currentGeneratingId: null, phase: 'idle' })
        await expect(f.service.start(params)).rejects.toThrow('submitted but could not be saved')
        await expect(f.service.retry(handle.recordId)).rejects.toThrow('submitted but could not be saved')
        f.service.setForeground(true)
        expect(f.poll).not.toHaveBeenCalled()
        await f.service.resume(handle.recordId)
      } else if (reason === 'background') {
        expect(f.service.getSnapshot()).toEqual({ currentGeneratingId: handle.recordId, phase: 'paused' })
        f.service.setForeground(true)
        await f.service.waitForIdle()
      } else {
        await f.service.resume(handle.recordId)
      }

      expect(f.records.get(handle.recordId)).toMatchObject({ taskId: 'task-1', status: 'done' })
      expect(f.poll).toHaveBeenCalledExactlyOnceWith('task-1', expect.any(AbortSignal))
      expect(f.submit).toHaveBeenCalledOnce()
      await expect((await f.service.start(params)).completion).resolves.toMatchObject({ status: 'done' })
    }
  )

  it('blocks missing references before both async and direct generation', async () => {
    const f = fixture()
    for (const provider of ['chatbox-ai', 'openrouter']) {
      const handle = await f.service.start({
        ...params,
        model: { ...params.model, provider },
        referenceImages: ['missing'],
      })
      await expect(handle.completion).resolves.toMatchObject({
        status: 'error',
        error: expect.stringContaining('could not be loaded'),
      })
    }
    expect(f.submit).not.toHaveBeenCalled()
    expect(f.paint).not.toHaveBeenCalled()
  })

  it('resolves URL and stored references and normalizes auto without mutating input', async () => {
    const f = fixture()
    f.blobs.set('stored', 'data:image/png;base64,AAAA')
    const request = { ...params, aspectRatio: 'auto', referenceImages: ['https://images.test/ref', 'stored'] }
    await (await f.service.start(request)).completion
    expect(f.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        aspect_ratio: undefined,
        images: [{ image_url: 'https://images.test/ref' }, { image_url: 'data:image/png;base64,AAAA' }],
      })
    )
    expect(request.aspectRatio).toBe('auto')
  })

  it('awaits slow progress persistence before polling and storing terminal state', async () => {
    const f = fixture()
    f.poll.mockResolvedValueOnce({ ...done, is_finished: false }).mockResolvedValueOnce({
      ...done,
      items: [
        ...done.items,
        { uuid: 'bad', status: 'failed', error_code: 'blocked', error_message: 'Content blocked' },
      ],
    })
    const gate = deferred<void>()
    const update = f.storage.update.getMockImplementation()!
    f.storage.update.mockImplementation(async (id, patch) => {
      if (patch.generatedImages && !patch.status) await gate.promise
      return update(id, patch)
    })
    const handle = await f.service.start({ ...params, imageGenerateNum: 2 })
    await vi.waitFor(() => expect(f.poll).toHaveBeenCalledOnce())
    expect(f.records.get(handle.recordId)?.status).toBe('generating')
    gate.resolve()
    await expect(handle.completion).resolves.toMatchObject({
      status: 'error',
      generatedImages: ['https://images.test/original'],
      errorCode: 'blocked',
      errorItemUuid: 'bad',
    })
    expect(f.poll).toHaveBeenCalledTimes(2)
  })

  it('revalidates retries, clears task errors and appends direct output to previous images', async () => {
    const f = fixture()
    await existing(f, {
      model: { provider: 'openrouter', modelId: 'image' },
      generatedImages: ['old'],
      taskId: 'old-task',
      error: 'old-error',
      errorCode: 1,
    })
    const handle = await f.service.retry('existing')
    await expect(handle.completion).resolves.toMatchObject({
      id: 'existing',
      status: 'done',
      generatedImages: ['old', expect.stringContaining('picture:image-gen:')],
      taskId: undefined,
      error: undefined,
      errorCode: undefined,
    })
    expect(f.validateRequest).toHaveBeenCalledOnce()
    f.validateRequest.mockRejectedValueOnce(new Error('Unsupported references'))
    await expect((await f.service.retry('existing')).completion).resolves.toMatchObject({
      status: 'error',
      error: 'Unsupported references',
    })
    expect(f.paint).toHaveBeenCalledOnce()
  })

  it('drains callbacks the provider did not await before writing its terminal status', async () => {
    const f = fixture()
    const gate = deferred<void>()
    f.blobStorage.set.mockImplementationOnce(async (key, data) => {
      await gate.promise
      f.blobs.set(key, data)
    })
    f.paint.mockImplementationOnce(async (_params, _signal, callback) => {
      void callback?.('data:image/png;base64,AAAA')
      return ['data:image/png;base64,AAAA']
    })
    const handle = await f.service.start({ ...params, model: { provider: 'openrouter', modelId: 'image' } })
    await vi.waitFor(() => expect(f.blobStorage.set).toHaveBeenCalledOnce())
    expect(f.records.get(handle.recordId)?.status).toBe('generating')
    gate.resolve()
    await expect(handle.completion).resolves.toMatchObject({
      status: 'done',
      generatedImages: [expect.stringContaining('picture:image-gen:')],
    })
    expect(f.blobStorage.set).toHaveBeenCalledOnce()
  })

  it('cleans unassociated generated blobs when Stop wins their write', async () => {
    const f = fixture()
    const gate = deferred<void>()
    f.blobStorage.set.mockImplementationOnce(async (key, data) => {
      await gate.promise
      f.blobs.set(key, data)
    })
    const handle = await f.service.start({ ...params, model: { provider: 'openrouter', modelId: 'image' } })
    await vi.waitFor(() => expect(f.blobStorage.set).toHaveBeenCalledOnce())
    f.service.cancel()
    gate.resolve()
    await handle.completion
    expect(f.blobs.size).toBe(0)
    expect(f.records.get(handle.recordId)?.generatedImages).toEqual([])
  })

  it('preserves a blob whose association committed despite a failed acknowledgement', async () => {
    const f = fixture()
    const update = f.storage.update.getMockImplementation()!
    f.storage.update.mockImplementation(async (id, patch) => {
      const updated = await update(id, patch)
      if (patch.generatedImages) throw new Error('lost acknowledgement')
      return updated
    })
    const handle = await f.service.start({ ...params, model: { provider: 'openrouter', modelId: 'image' } })
    await expect(handle.completion).resolves.toMatchObject({
      status: 'error',
      generatedImages: [expect.stringContaining('picture:image-gen:')],
    })
    expect(f.blobs.size).toBe(1)
    expect(f.blobStorage.remove).not.toHaveBeenCalled()
  })

  it('does not resurrect a deleted record when a submitted task returns late', async () => {
    const f = fixture()
    const submitted = deferred<ImageGenerationTaskResponse>()
    f.submit.mockReturnValueOnce(submitted.promise)
    const handle = await f.service.start(params)
    await vi.waitFor(() => expect(f.submit).toHaveBeenCalledOnce())
    await f.service.deleteRecord(handle.recordId)
    submitted.resolve(pending)
    await expect(handle.completion).resolves.toBeNull()
    expect(f.records.size).toBe(0)
    expect(f.poll).not.toHaveBeenCalled()
  })

  it('only cleans owned blobs with no record or active draft references', async () => {
    const f = fixture()
    const shared = 'picture:image-gen:shared'
    const draft = 'picture:image-creator-ref:draft'
    const unused = 'picture:image-gen:unused'
    const record = await existing(f, { generatedImages: [shared, draft, unused, 'unrelated'] })
    await f.storage.create({ ...record, id: 'other', generatedImages: [], referenceImages: [shared] })
    const release = f.service.protectReferences([draft])
    await f.service.deleteRecord('existing')
    expect(f.blobStorage.remove).toHaveBeenCalledExactlyOnceWith(unused)
    release()
  })

  it('skips cleanup if scanning references fails', async () => {
    const f = fixture()
    await existing(f, { generatedImages: ['picture:image-gen:protected'] })
    f.storage.getPage.mockRejectedValueOnce(new Error('read failed'))
    await f.service.deleteRecord('existing')
    expect(f.blobStorage.remove).not.toHaveBeenCalled()
  })

  it('reconciles cold start jobs and only resumes tasks after an explicit request', async () => {
    const f = fixture()
    await existing(f, { status: 'generating', taskId: 'task-1', generatedImages: ['old'] })
    await f.service.bootstrap()
    expect(f.records.get('existing')).toMatchObject({ status: 'error', taskId: 'task-1', generatedImages: ['old'] })
    expect(f.poll).not.toHaveBeenCalled()
    expect(f.submit).not.toHaveBeenCalled()
    await f.service.resume('existing')
    expect(f.poll).toHaveBeenCalledOnce()
    expect(f.submit).not.toHaveBeenCalled()
  })

  it('resumes background monitoring on foreground, while user Stop clears that intent', async () => {
    const f = fixture()
    f.poll.mockImplementationOnce(async () => {
      f.service.setForeground(false)
      return pending
    })
    const handle = await f.service.start(params)
    await handle.completion
    expect(f.service.getSnapshot().phase).toBe('paused')
    f.service.setForeground(true)
    await vi.waitFor(() => expect(f.service.getSnapshot().phase).toBe('idle'))
    expect(f.submit).toHaveBeenCalledOnce()
    expect(f.poll).toHaveBeenCalledTimes(2)

    f.poll.mockImplementationOnce(async () => {
      f.service.cancel()
      f.service.setForeground(false)
      return pending
    })
    await (await f.service.start(params)).completion
    f.service.setForeground(true)
    expect(f.service.getSnapshot().phase).toBe('idle')
    expect(f.poll).toHaveBeenCalledTimes(3)
  })
  it('keeps successful direct images when a later provider result fails and stores structured errors', async () => {
    const f = fixture()
    f.paint.mockImplementationOnce(async (_params, _signal, callback) => {
      await callback?.('data:image/png;base64,AAAA')
      throw Object.assign(new Error('Quota exhausted'), { code: 402 })
    })
    const handle = await f.service.start({
      ...params,
      model: { provider: 'openrouter', modelId: 'image' },
      imageGenerateNum: 2,
    })
    await expect(handle.completion).resolves.toMatchObject({
      status: 'error',
      errorCode: 402,
      generatedImages: [expect.stringContaining('picture:image-gen:')],
    })
  })

  it('cleans generated blobs whose association did not commit', async () => {
    const f = fixture()
    const update = f.storage.update.getMockImplementation()!
    f.storage.update.mockImplementation(async (id, patch) => {
      if (patch.generatedImages) throw new Error('association failed')
      return update(id, patch)
    })
    const handle = await f.service.start({ ...params, model: { provider: 'openrouter', modelId: 'image' } })
    await expect(handle.completion).resolves.toMatchObject({ status: 'error', generatedImages: [] })
    expect(f.blobs.size).toBe(0)
  })

  it('ignores a direct callback arriving after its attempt completed and was retried', async () => {
    const f = fixture()
    let lateCallback: ((data: string) => void | Promise<void>) | undefined
    f.paint.mockImplementationOnce(async (_params, _signal, callback) => {
      lateCallback = callback
      return ['data:image/png;base64,AAAA']
    })
    const handle = await f.service.start({ ...params, model: { provider: 'openrouter', modelId: 'image' } })
    await handle.completion
    await (await f.service.retry(handle.recordId)).completion
    await lateCallback?.('data:image/png;base64,LATE')
    expect(f.records.get(handle.recordId)?.generatedImages).toHaveLength(2)
    expect([...f.blobs.values()]).not.toContain('data:image/png;base64,LATE')
  })

  it('keeps Stop pending while a retry record update drains', async () => {
    const f = fixture()
    await existing(f)
    const gate = deferred<void>()
    const update = f.storage.update.getMockImplementation()!
    f.storage.update.mockImplementationOnce(async (id, patch) => {
      await gate.promise
      return update(id, patch)
    })
    const retry = f.service.retry('existing')
    const rejection = expect(retry).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(f.storage.update).toHaveBeenCalled())
    f.service.cancel()
    await expect(f.service.start(params)).rejects.toThrow('Another image')
    gate.resolve()
    await rejection
    expect(f.records.get('existing')?.status).toBe('error')
    expect(f.submit).not.toHaveBeenCalled()
  })
  it('drains a late submitted task ID before disposal completes', async () => {
    const f = fixture()
    const submitted = deferred<ImageGenerationTaskResponse>()
    f.submit.mockReturnValueOnce(submitted.promise)
    const handle = await f.service.start(params)
    await vi.waitFor(() => expect(f.submit).toHaveBeenCalledOnce())
    let disposed = false
    const draining = f.service.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    submitted.resolve(pending)
    await draining
    await handle.completion
    expect(f.records.get(handle.recordId)?.taskId).toBe('task-1')
    await expect(f.service.start(params)).rejects.toThrow('disposed')
  })

  it('releases a paused job when its record is deleted', async () => {
    const f = fixture()
    f.poll.mockImplementationOnce(async () => {
      f.service.setForeground(false)
      return pending
    })
    const handle = await f.service.start(params)
    await handle.completion
    expect(f.service.getSnapshot().phase).toBe('paused')
    await f.service.deleteRecord(handle.recordId)
    expect(f.service.getSnapshot().phase).toBe('idle')
    f.service.setForeground(true)
    expect(f.poll).toHaveBeenCalledOnce()
  })
  it('retains previous async output on a failed retry and replaces it when new images arrive', async () => {
    const f = fixture()
    await existing(f, { generatedImages: ['https://images.test/previous'], taskId: 'old-task' })
    f.poll.mockResolvedValueOnce({ ...done, items: [{ uuid: 'failed', status: 'failed' }] })
    await expect((await f.service.retry('existing')).completion).resolves.toMatchObject({
      status: 'error',
      generatedImages: ['https://images.test/previous'],
    })
    await expect((await f.service.retry('existing')).completion).resolves.toMatchObject({
      status: 'done',
      generatedImages: ['https://images.test/original'],
    })
  })

  it('allows recovery after a record deletion fails', async () => {
    const f = fixture()
    await existing(f, { taskId: 'task-1' })
    f.storage.delete.mockRejectedValueOnce(new Error('delete failed'))
    await expect(f.service.deleteRecord('existing')).rejects.toThrow('delete failed')
    await expect(f.service.resume('existing')).resolves.toMatchObject({ status: 'done' })
  })

  it('protects references of a pending create while another record is being deleted', async () => {
    const f = fixture()
    const key = 'picture:image-gen:source'
    await existing(f, { generatedImages: [key] })
    f.blobs.set(key, 'data:image/png;base64,AAAA')
    const gate = deferred<void>()
    const readPage = f.storage.getPage.getMockImplementation()!
    f.storage.getPage.mockImplementationOnce(async (cursor, limit) => {
      await gate.promise
      return readPage(cursor, limit)
    })
    const deleting = f.service.deleteRecord('existing')
    await vi.waitFor(() => expect(f.storage.getPage).toHaveBeenCalled())
    const creating = f.service.start({ ...params, referenceImages: [key] })
    gate.resolve()
    await deleting
    await (await creating).completion
    expect(f.blobStorage.remove).not.toHaveBeenCalledWith(key)
    expect(f.submit).toHaveBeenCalledOnce()
  })
  it('retains a submitted task after repeated persistence failures and only resumes its original GET task', async () => {
    const f = fixture()
    const update = f.storage.update.getMockImplementation()!
    let failTaskWrites = true
    f.storage.update.mockImplementation(async (id, patch) => {
      if (patch.taskId && failTaskWrites) throw new Error('disk full')
      return update(id, patch)
    })
    const changes: ImageGeneration[] = []
    f.service.subscribeRecords((event) => {
      if (event.type !== 'deleted') changes.push(event.record)
    })
    const handle = await f.service.start(params)
    await expect(handle.completion).resolves.toMatchObject({
      taskId: 'task-1',
      status: 'error',
      errorCode: 'image_task_persistence_failed',
    })
    expect(f.records.get(handle.recordId)?.taskId).toBeUndefined()
    await expect(f.service.getRecord(handle.recordId)).resolves.toMatchObject({ taskId: 'task-1' })
    await expect(f.service.getPage(0)).resolves.toMatchObject({ items: [{ taskId: 'task-1' }] })
    expect(changes.at(-1)?.taskId).toBe('task-1')
    await expect(f.service.retry(handle.recordId)).rejects.toThrow('submitted but could not be saved')
    await expect(f.service.start(params)).rejects.toThrow('submitted but could not be saved')
    await expect(f.service.resume(handle.recordId)).resolves.toMatchObject({ taskId: 'task-1', status: 'error' })
    expect(f.poll).not.toHaveBeenCalled()
    expect(f.submit).toHaveBeenCalledOnce()
    f.service.setForeground(false)
    f.service.setForeground(true)
    await f.service.cancel()
    expect(f.poll).not.toHaveBeenCalled()
    await expect(f.service.start(params)).rejects.toThrow('submitted but could not be saved')
    failTaskWrites = false
    await expect(f.service.resume(handle.recordId)).resolves.toMatchObject({ taskId: 'task-1', status: 'done' })
    expect(f.records.get(handle.recordId)?.taskId).toBe('task-1')
    expect(f.poll).toHaveBeenCalledExactlyOnceWith('task-1', expect.any(AbortSignal))
    expect(f.submit).toHaveBeenCalledOnce()
    await (await f.service.start(params)).completion
    expect(f.submit).toHaveBeenCalledTimes(2)
  })

  it('reclaims a deleted source image after its final draft lease is released', async () => {
    const f = fixture()
    const key = 'picture:image-gen:source'
    f.blobs.set(key, 'data:image/png;base64,AAAA')
    await existing(f, { generatedImages: [key] })
    const first = f.service.protectReferences([key])
    const second = f.service.protectReferences([key])
    await f.service.deleteRecord('existing')
    expect(f.blobs.has(key)).toBe(true)
    first()
    await f.service.waitForIdle()
    expect(f.blobs.has(key)).toBe(true)
    second()
    await f.service.waitForIdle()
    expect(f.blobs.has(key)).toBe(false)
    expect(f.blobStorage.remove).toHaveBeenCalledExactlyOnceWith(key)
    second()
    await f.service.waitForIdle()
    expect(f.blobStorage.remove).toHaveBeenCalledOnce()
  })

  it('keeps deferred images when a submission transfers them to its durable record', async () => {
    const f = fixture()
    const key = 'picture:image-gen:source'
    f.blobs.set(key, 'data:image/png;base64,AAAA')
    await existing(f, { generatedImages: [key] })
    const releaseDraft = f.service.protectReferences([key])
    const releaseSubmission = f.service.protectReferences([key])
    await f.service.deleteRecord('existing')
    releaseDraft()
    await f.service.waitForIdle()
    const handle = await f.service.start({ ...params, referenceImages: [key] }, { onRecordCreated: releaseSubmission })
    await handle.completion
    await f.service.waitForIdle()
    expect(f.blobs.has(key)).toBe(true)
    expect(f.blobStorage.remove).not.toHaveBeenCalledWith(key)
    await f.service.deleteRecord(handle.recordId)
    expect(f.blobs.has(key)).toBe(false)
  })

  it('emits a deletion only once for repeated requests and ignores absent records', async () => {
    const f = fixture()
    await existing(f)
    const events: string[] = []
    f.service.subscribeRecords((event) => {
      if (event.type === 'deleted') events.push(event.id)
    })
    await Promise.all([f.service.deleteRecord('existing'), f.service.deleteRecord('existing')])
    await f.service.deleteRecord('missing')
    expect(events).toEqual(['existing'])
    expect(f.storage.delete).toHaveBeenCalledExactlyOnceWith('existing')
  })

  it('clears an unsaved submission only when its record is explicitly deleted', async () => {
    const f = fixture()
    const update = f.storage.update.getMockImplementation()!
    f.storage.update.mockImplementation(async (id, patch) => {
      if (patch.taskId) throw new Error('disk full')
      return update(id, patch)
    })
    const handle = await f.service.start(params)
    await handle.completion
    await f.service.deleteRecord(handle.recordId)
    await expect(f.service.getRecord(handle.recordId)).resolves.toBeNull()
    await expect(f.service.getPage(0)).resolves.toMatchObject({ items: [], total: 0 })
    f.storage.update.mockImplementation(update)
    await expect((await f.service.start(params)).completion).resolves.toMatchObject({ status: 'done' })
    expect(f.submit).toHaveBeenCalledTimes(2)
  })
})
