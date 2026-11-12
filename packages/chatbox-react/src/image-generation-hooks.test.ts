import type {
  ImageGeneration,
  ImageGenerationPage,
  ImageGenerationRecordEvent,
} from '@chatbox/core/application/image-generation'
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query'
import { AbortController as ReactNativeAbortController, AbortSignal as ReactNativeAbortSignal } from 'abort-controller'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ImageGenerationQueryBridge,
  ImageGenerationQueryKeys,
  type InfiniteImageGenerationData,
  updateImageGenerationHistory,
} from './image-generation-hooks'

function record(id: number): ImageGeneration {
  return {
    id: String(id),
    createdAt: id,
    prompt: `Image ${id}`,
    model: { provider: 'openai', modelId: 'gpt-image' },
    referenceImages: [],
    generatedImages: [],
    status: 'done',
  }
}

function source(count = 5) {
  let records = Array.from({ length: count }, (_, index) => record(count - index))
  const listeners = new Set<(event: ImageGenerationRecordEvent) => void>()
  return {
    getRecord: vi.fn(async (id: string) => records.find((item) => item.id === id) ?? null),
    getPage: vi.fn(
      async (offset: number, limit = 2): Promise<ImageGenerationPage> => ({
        items: records.slice(offset, offset + limit),
        total: records.length,
        nextCursor: offset + limit < records.length ? offset + limit : null,
      })
    ),
    subscribeRecords(listener: (event: ImageGenerationRecordEvent) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribe: () => () => undefined,
    getSnapshot: () => ({ currentGeneratingId: null, phase: 'idle' as const }),
    emit(event: ImageGenerationRecordEvent) {
      records =
        event.type === 'deleted'
          ? records.filter((item) => item.id !== event.id)
          : event.type === 'created'
            ? [event.record, ...records]
            : records.map((item) => (item.id === event.record.id ? event.record : item))
      for (const listener of listeners) listener(event)
    },
  }
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

beforeEach(() => {
  vi.stubGlobal('AbortController', ReactNativeAbortController)
  vi.stubGlobal('AbortSignal', ReactNativeAbortSignal)
})

afterEach(() => vi.unstubAllGlobals())

describe('image history query bindings', () => {
  it('reads empty history and missing records with the React Native AbortSignal', async () => {
    expect(new AbortController().signal).not.toHaveProperty('throwIfAborted')
    const service = source(0)
    const queryClient = client()
    const bridge = new ImageGenerationQueryBridge(service, queryClient)
    try {
      await expect(queryClient.fetchInfiniteQuery(bridge.historyOptions())).resolves.toEqual({
        pages: [{ items: [], total: 0, nextCursor: null }],
        pageParams: [0],
      })
      expect(service.getPage).toHaveBeenCalledWith(0, 20)
      await expect(queryClient.fetchQuery(bridge.recordOptions('missing'))).resolves.toBeNull()
    } finally {
      bridge.dispose()
      queryClient.clear()
    }
  })

  it('aligns offsets after insertion, update, and deletions inside and outside loaded pages', () => {
    let data: InfiniteImageGenerationData | undefined = {
      pages: [
        { items: [record(5), record(4)], total: 5, nextCursor: 2 },
        { items: [record(3), record(2)], total: 5, nextCursor: 4 },
      ],
      pageParams: [0, 2],
    }
    data = updateImageGenerationHistory(data, { type: 'created', record: record(6) })
    expect(data?.pages.flatMap((page) => page.items.map((item) => item.id))).toEqual(['6', '5', '4', '3', '2'])
    expect(data?.pages.at(-1)?.nextCursor).toBe(5)
    expect(data?.pages.every((page) => page.total === 6)).toBe(true)
    data = updateImageGenerationHistory(data, { type: 'updated', record: { ...record(3), status: 'error' } })
    expect(data?.pages.flatMap((page) => page.items).find((item) => item.id === '3')?.status).toBe('error')
    data = updateImageGenerationHistory(data, { type: 'deleted', id: '4' })
    expect(data?.pages.at(-1)?.nextCursor).toBe(4)
    data = updateImageGenerationHistory(data, { type: 'deleted', id: '1' })
    expect(data?.pages.at(-1)?.nextCursor).toBeNull()
    expect(data?.pages[0]?.total).toBe(4)
  })

  it('loads the next contiguous records after cached deletion without losing the boundary record', async () => {
    const service = source()
    const queryClient = client()
    const bridge = new ImageGenerationQueryBridge(service, queryClient)
    const observer = new InfiniteQueryObserver(queryClient, bridge.historyOptions(2))
    const unsubscribe = observer.subscribe(() => undefined)
    await observer.refetch()
    service.emit({ type: 'deleted', id: '5' })
    await observer.fetchNextPage()
    expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items.map((item) => item.id))).toEqual([
      '4',
      '3',
      '2',
    ])
    expect(service.getPage).toHaveBeenLastCalledWith(1, 2)
    await observer.fetchNextPage()
    expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items.map((item) => item.id))).toEqual([
      '4',
      '3',
      '2',
      '1',
    ])
    unsubscribe()
    bridge.dispose()
    queryClient.clear()
  })

  it('preserves a progress update to an earlier page while the next page is loading', async () => {
    const service = source()
    const queryClient = client()
    const bridge = new ImageGenerationQueryBridge(service, queryClient)
    const observer = new InfiniteQueryObserver(queryClient, bridge.historyOptions(2))
    const unsubscribe = observer.subscribe(() => undefined)
    await observer.refetch()
    let finish: (page: ImageGenerationPage) => void = () => {
      throw new Error('Page query did not start')
    }
    service.getPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const loading = observer.fetchNextPage()
    service.emit({ type: 'updated', record: { ...record(5), status: 'error', error: 'failed' } })
    finish({ items: [record(3), record(2)], total: 5, nextCursor: 4 })
    await loading
    expect(observer.getCurrentResult().data?.pages[0]?.items[0]?.status).toBe('error')
    unsubscribe()
    bridge.dispose()
    queryClient.clear()
  })

  it('cancels an offset read against pre-insertion ordering and keeps new records visible', async () => {
    const service = source()
    const queryClient = client()
    const bridge = new ImageGenerationQueryBridge(service, queryClient)
    const observer = new InfiniteQueryObserver(queryClient, bridge.historyOptions(2))
    const unsubscribe = observer.subscribe(() => undefined)
    await observer.refetch()
    let finish: (page: ImageGenerationPage) => void = () => {
      throw new Error('Page query did not start')
    }
    service.getPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const loading = observer.fetchNextPage()
    service.emit({ type: 'created', record: record(6) })
    finish({ items: [record(3), record(2)], total: 5, nextCursor: 4 })
    await loading
    expect(
      queryClient
        .getQueryData<InfiniteImageGenerationData>(ImageGenerationQueryKeys.history)
        ?.pages.flatMap((page) => page.items.map((item) => item.id))
    ).toEqual(['6', '5', '4'])
    await observer.fetchNextPage()
    expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items.map((item) => item.id))).toEqual([
      '6',
      '5',
      '4',
      '3',
      '2',
    ])
    unsubscribe()
    bridge.dispose()
    queryClient.clear()
  })

  it('keeps configured page size after repeated delete/create mutations and bounds refetch I/O', async () => {
    const service = source(1000)
    const queryClient = client()
    const bridge = new ImageGenerationQueryBridge(service, queryClient)
    const observer = new InfiniteQueryObserver(queryClient, bridge.historyOptions(20))
    const unsubscribe = observer.subscribe(() => undefined)
    await observer.refetch()
    for (let id = 1000; id >= 982; id -= 1) service.emit({ type: 'deleted', id: String(id) })
    for (let id = 1001; id <= 1019; id += 1) service.emit({ type: 'created', record: record(id) })
    expect(observer.getCurrentResult().data?.pages).toHaveLength(1)
    expect(observer.getCurrentResult().data?.pages[0]?.items).toHaveLength(20)
    service.getPage.mockClear()
    await observer.refetch()
    expect(service.getPage).toHaveBeenCalledTimes(1)
    expect(service.getPage).toHaveBeenLastCalledWith(0, 20)
    expect(observer.getCurrentResult().data?.pages.flatMap((page) => page.items)).toHaveLength(20)
    unsubscribe()
    bridge.dispose()
    queryClient.clear()
  })

  it('keeps a late record read from reviving a deleted item', async () => {
    const service = source()
    const queryClient = client()
    const bridge = new ImageGenerationQueryBridge(service, queryClient)
    let finish: (value: ImageGeneration) => void = () => {
      throw new Error('Record query did not start')
    }
    service.getRecord.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const loading = queryClient.fetchQuery(bridge.recordOptions('5'))
    service.emit({ type: 'deleted', id: '5' })
    finish(record(5))
    await expect(loading).resolves.toBeNull()
    expect(queryClient.getQueryData(ImageGenerationQueryKeys.record('5'))).toBeNull()
    bridge.dispose()
    queryClient.clear()
  })

  it('reads persistent records into a fresh query cache after restart', async () => {
    const service = source()
    const queryClient = client()
    const bridge = new ImageGenerationQueryBridge(service, queryClient)
    const page = await queryClient.fetchInfiniteQuery(bridge.historyOptions(2))
    expect(page.pages[0]?.items.map((item) => item.id)).toEqual(['5', '4'])
    bridge.dispose()
    queryClient.clear()
    const restartedClient = client()
    const restartedBridge = new ImageGenerationQueryBridge(service, restartedClient)
    const restored = await restartedClient.fetchInfiniteQuery(restartedBridge.historyOptions(2))
    expect(restored.pages[0]?.items.map((item) => item.id)).toEqual(['5', '4'])
    restartedBridge.dispose()
    restartedClient.clear()
  })
})
