import { FeaturedCopilotClient } from '@chatbox/core/application/copilots'
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query'
import { describe, expect, test, vi } from 'vitest'
import { createCopilotQueryDefinitions, flattenFeaturedCopilots } from './copilot-query-options'

describe('Copilot query definitions', () => {
  test('overlapping pages retain unique stable list entries', () => {
    const first = { id: 'first', name: 'First', prompt: 'First' }
    const second = { id: 'second', name: 'Second', prompt: 'Second' }
    expect(
      flattenFeaturedCopilots([
        { data: [first], next_cursor: 'next' },
        { data: [{ ...first, name: 'Moved while paging' }, second], next_cursor: null },
      ])
    ).toEqual([first, second])
  })
  test('isolates language, tag and submitted search caches and keeps the cursor within its query', async () => {
    const request = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'first', name: 'First', prompt: 'First' }], next_cursor: 'next' })
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'second', name: 'Second', prompt: 'Second' }], next_cursor: null })
      )
    const client = new FeaturedCopilotClient({
      request,
      apiOrigin: 'https://api.example.com',
      deviceId: async () => 'device',
    })
    const definitions = createCopilotQueryDefinitions(client)
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = definitions.list('en', 'Writing', 'story')
    await queries.fetchInfiniteQuery({ ...options, pages: 2 })
    expect(queries.getQueryData(options.queryKey)).toMatchObject({ pageParams: [undefined, 'next'] })
    for (const alternate of [
      definitions.list('zh-Hans', 'Writing', 'story'),
      definitions.list('en', 'Music', 'story'),
      definitions.list('en', 'Writing', 'poem'),
    ]) {
      expect(queries.getQueryData(alternate.queryKey)).toBeUndefined()
    }
    expect(request.mock.calls[1][1]?.body).toBe(
      JSON.stringify({ lang: 'en', limit: 18, cursor: 'next', tag: 'Writing', search: 'story' })
    )
    expect(options.staleTime).toBe(60_000)
    expect(definitions.tags('en').staleTime).toBe(3_600_000)
    queries.clear()
  })

  test('deduplicates concurrent next-page requests and stops at the final page', async () => {
    const first = { id: 'first', name: 'First', prompt: 'First' }
    const second = { id: 'second', name: 'Second', prompt: 'Second' }
    let finishNextPage: ((response: Response) => void) | undefined
    const request = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json({ data: [first], next_cursor: 'next' }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishNextPage = resolve
          })
      )
    const client = new FeaturedCopilotClient({
      request,
      apiOrigin: 'https://api.example.com',
      deviceId: async () => 'device',
    })
    const queries = new QueryClient()
    const options = { ...createCopilotQueryDefinitions(client).list('en'), retry: false }
    await queries.fetchInfiniteQuery(options)
    const observer = new InfiniteQueryObserver(queries, options)
    const unsubscribe = observer.subscribe(() => undefined)
    try {
      const pending = observer.fetchNextPage({ cancelRefetch: false })
      const repeated = observer.fetchNextPage({ cancelRefetch: false })
      expect(request).toHaveBeenCalledTimes(2)
      finishNextPage?.(Response.json({ data: [first, second], has_more: false }))
      await Promise.all([pending, repeated])
      const result = observer.getCurrentResult()
      expect(result.hasNextPage).toBe(false)
      expect(flattenFeaturedCopilots(result.data?.pages ?? [])).toEqual([first, second])
      expect(result.data?.pageParams).toEqual([undefined, 'next'])
      await observer.fetchNextPage({ cancelRefetch: false })
      expect(request).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
      queries.clear()
    }
  })

  test('query cancellation aborts the network request', async () => {
    let signal: AbortSignal | null | undefined
    const request = vi.fn((_input: string, init?: RequestInit) => {
      signal = init?.signal
      return new Promise<Response>(() => undefined)
    })
    const client = new FeaturedCopilotClient({
      request,
      apiOrigin: 'https://api.example.com',
      deviceId: async () => 'device',
    })
    const options = createCopilotQueryDefinitions(client).list('en')
    const queries = new QueryClient()
    const pending = queries.fetchInfiniteQuery(options).catch(() => undefined)
    await queries.cancelQueries({ queryKey: options.queryKey })
    expect(signal?.aborted).toBe(true)
    await pending
    queries.clear()
  })
})
