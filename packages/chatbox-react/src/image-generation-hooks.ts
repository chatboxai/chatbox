import type {
  ImageGeneration,
  ImageGenerationPage,
  ImageGenerationRecordEvent,
  ImageGenerationService,
} from '@chatbox/core/application/image-generation'
import { throwIfAborted } from '@chatbox/core/utils/abort'
import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

export const ImageGenerationQueryKeys = {
  record: (id: string | null) => ['image-generation', id] as const,
  history: ['image-generation-list'] as const,
}

export type InfiniteImageGenerationData = InfiniteData<ImageGenerationPage, number>
type ImageGenerationQuerySource = Pick<
  ImageGenerationService,
  'getRecord' | 'getPage' | 'subscribeRecords' | 'subscribe' | 'getSnapshot'
>

/** Keeps loaded history contiguous so its next offset follows local insertions and deletions. */
export function updateImageGenerationHistory(
  data: InfiniteImageGenerationData | undefined,
  event: ImageGenerationRecordEvent,
  pageSize = 20
): InfiniteImageGenerationData | undefined {
  if (!data?.pages.length) return data
  const previous = [...new Map(data.pages.flatMap((page) => page.items).map((record) => [record.id, record])).values()]
  const id = event.type === 'deleted' ? event.id : event.record.id
  const existing = previous.some((record) => record.id === id)
  const items = previous.flatMap((record) =>
    record.id !== id ? [record] : event.type === 'deleted' ? [] : [event.record]
  )
  if (event.type === 'created' && !existing) items.unshift(event.record)
  items.sort((left, right) => right.createdAt - left.createdAt)
  const previousTotal = data.pages[0]?.total ?? 0
  const total = Math.max(
    items.length,
    previousTotal + (event.type === 'created' && !existing ? 1 : event.type === 'deleted' ? -1 : 0)
  )
  const limit = Math.max(1, Math.floor(pageSize))
  const pages: ImageGenerationPage[] = []
  const pageParams: number[] = []
  for (let offset = 0; offset < items.length || offset === 0; offset += limit) {
    const pageItems = items.slice(offset, offset + limit)
    const next = offset + pageItems.length
    pages.push({ items: pageItems, total, nextCursor: next < total ? next : null })
    pageParams.push(offset)
  }
  return { pages, pageParams }
}

export class ImageGenerationQueryBridge {
  private readonly unsubscribe: () => void
  private historyPageSize = 20

  constructor(
    private readonly service: ImageGenerationQuerySource,
    private readonly queryClient: QueryClient
  ) {
    this.unsubscribe = service.subscribeRecords((event) => this.onRecord(event))
  }

  dispose(): void {
    this.unsubscribe()
  }

  recordOptions(id: string | null) {
    return queryOptions({
      queryKey: ImageGenerationQueryKeys.record(id),
      enabled: Boolean(id),
      staleTime: 300_000,
      queryFn: async ({ signal }): Promise<ImageGeneration | null> => {
        if (!id) return null
        let latest: ImageGenerationRecordEvent | undefined
        const unsubscribe = this.service.subscribeRecords((event) => {
          if ((event.type === 'deleted' ? event.id : event.record.id) === id) latest = event
        })
        try {
          const record = await this.service.getRecord(id)
          throwIfAborted(signal)
          return latest ? (latest.type === 'deleted' ? null : latest.record) : record
        } finally {
          unsubscribe()
        }
      },
    })
  }

  historyOptions(pageSize = 20) {
    this.historyPageSize = Math.max(1, Math.floor(pageSize))
    return infiniteQueryOptions({
      queryKey: ImageGenerationQueryKeys.history,
      initialPageParam: 0,
      getNextPageParam: (page: ImageGenerationPage) => page.nextCursor,
      staleTime: 300_000,
      structuralSharing: (_previous: unknown, incoming: unknown) => {
        const data = incoming as InfiniteImageGenerationData
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map(
              (record) =>
                this.queryClient.getQueryData<ImageGeneration | null>(ImageGenerationQueryKeys.record(record.id)) ??
                record
            ),
          })),
        }
      },
      queryFn: async ({ pageParam, signal }): Promise<ImageGenerationPage> => {
        const updates = new Map<string, ImageGeneration>()
        const unsubscribe = this.service.subscribeRecords((event) => {
          if (event.type === 'updated') updates.set(event.record.id, event.record)
        })
        try {
          const page = await this.service.getPage(pageParam, pageSize)
          throwIfAborted(signal)
          return { ...page, items: page.items.map((record) => updates.get(record.id) ?? record) }
        } finally {
          unsubscribe()
        }
      },
    })
  }

  private onRecord(event: ImageGenerationRecordEvent): void {
    const recordId = event.type === 'deleted' ? event.id : event.record.id
    this.queryClient.setQueryData<ImageGeneration | null>(
      ImageGenerationQueryKeys.record(recordId),
      event.type === 'deleted' ? null : event.record
    )
    if (event.type !== 'updated') {
      // An in-flight offset query was issued against the old ordering. Cancel before replacing loaded pages.
      void this.queryClient.cancelQueries({ queryKey: ImageGenerationQueryKeys.history })
    }
    this.queryClient.setQueryData<InfiniteImageGenerationData>(ImageGenerationQueryKeys.history, (data) =>
      updateImageGenerationHistory(data, event, this.historyPageSize)
    )
    if (event.type !== 'updated' && !this.queryClient.getQueryData(ImageGenerationQueryKeys.history)) {
      void this.queryClient.refetchQueries({ queryKey: ImageGenerationQueryKeys.history, type: 'active' })
    }
  }
}

const bridges = new WeakMap<ImageGenerationQuerySource, WeakMap<QueryClient, ImageGenerationQueryBridge>>()
export function getImageGenerationQueryBridge(
  service: ImageGenerationQuerySource,
  queryClient: QueryClient
): ImageGenerationQueryBridge {
  let clients = bridges.get(service)
  if (!clients) {
    clients = new WeakMap()
    bridges.set(service, clients)
  }
  let bridge = clients.get(queryClient)
  if (!bridge) {
    bridge = new ImageGenerationQueryBridge(service, queryClient)
    clients.set(queryClient, bridge)
  }
  return bridge
}

/** Create once in a host composition root, using the same QueryClient as ChatboxProvider. */
export function createImageGenerationHooks(service: ImageGenerationQuerySource, queryClient: QueryClient) {
  const bridge = getImageGenerationQueryBridge(service, queryClient)
  return {
    useRecord(id: string | null) {
      return useQuery(bridge.recordOptions(id), queryClient)
    },
    useRecords(pageSize = 20) {
      const result = useInfiniteQuery(bridge.historyOptions(pageSize), queryClient)
      return { ...result, records: result.data?.pages.flatMap((page) => page.items) ?? [] }
    },
    useRuntime() {
      return useSyncExternalStore(
        (listener) => service.subscribe(listener),
        () => service.getSnapshot(),
        () => service.getSnapshot()
      )
    },
  }
}
