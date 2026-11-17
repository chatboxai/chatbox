import { expect, it, vi } from 'vitest'
import { ThreadLinks } from '../session/thread-links'
import { ThreadLinksCache } from './thread-links-cache'

it('coalesces one revision/thread load and preserves a committed local graph', async () => {
  const cache = new ThreadLinksCache()
  const load = vi.fn(async () => ThreadLinks.from('t', []))
  const [first, second] = await Promise.all([cache.get('s', 't', 1, load), cache.get('s', 't', 1, load)])
  expect(first).toBe(second)
  expect(load).toHaveBeenCalledTimes(1)
  const next = ThreadLinks.from('t', [])
  cache.committed('s', 1, 2, new Map([['t', next]]))
  expect(await cache.get('s', 't', 2, load)).toBe(next)
  expect(load).toHaveBeenCalledTimes(1)
})

it('invalidates for an external revision and does not publish a late stale load', async () => {
  const cache = new ThreadLinksCache()
  let complete!: (links: ThreadLinks) => void
  const old = cache.get(
    's',
    't',
    1,
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  await Promise.resolve()
  const fresh = await cache.get('s', 't', 2, async () => ThreadLinks.from('t', []))
  complete(ThreadLinks.from('t', []))
  expect(await old).not.toBe(fresh)
  expect(
    await cache.get('s', 't', 2, async () => {
      throw new Error('must be cached')
    })
  ).toBe(fresh)
})

it('retries failed loads and discards graphs after an unobserved local predecessor', async () => {
  const cache = new ThreadLinksCache()
  await expect(
    cache.get('s', 't', 1, async () => {
      throw new Error('read failed')
    })
  ).rejects.toThrow('read failed')
  const first = await cache.get('s', 't', 1, async () => ThreadLinks.from('t', []))
  cache.committed('s', 2, 3, new Map([['t', first]]))
  const reload = vi.fn(async () => ThreadLinks.from('t', []))
  expect(await cache.get('s', 't', 3, reload)).not.toBe(first)
  expect(reload).toHaveBeenCalledTimes(1)
})

it('bounds resident graphs and clears in-flight publication on replacement', async () => {
  const cache = new ThreadLinksCache(2)
  const a = await cache.get('s', 'a', 1, async () => ThreadLinks.from('t', []))
  await cache.get('s', 'b', 1, async () => ThreadLinks.from('t', []))
  await cache.get('s', 'c', 1, async () => ThreadLinks.from('t', []))
  expect(cache.peek('s', 'a', 1)).toBeNull()
  expect(cache.peek('s', 'b', 1)).not.toBeNull()
  let finish!: (links: ThreadLinks) => void
  const pending = cache.get(
    's',
    'd',
    1,
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await Promise.resolve()
  cache.clear()
  finish(ThreadLinks.from('a', []))
  await pending
  expect(cache.peek('s', 'd', 1)).toBeNull()
  expect(await cache.get('s', 'a', 1, async () => ThreadLinks.from('t', []))).not.toBe(a)
})

it('lets a foreground caller recover from a canceled shared prefetch', async () => {
  const cache = new ThreadLinksCache()
  let cancel!: (error: unknown) => void
  const prefetch = cache.get(
    's',
    't',
    1,
    () =>
      new Promise((_resolve, reject) => {
        cancel = reject
      })
  )
  await Promise.resolve()
  const own = ThreadLinks.from('t', [])
  const load = vi.fn(async () => own)
  const foreground = cache.get('s', 't', 1, load)
  cancel(new DOMException('canceled', 'AbortError'))
  await expect(prefetch).rejects.toThrow('canceled')
  expect(await foreground).toBe(own)
  expect(load).toHaveBeenCalledTimes(1)
})

it('keeps committed graphs when a stale load finishes after the commit', async () => {
  const cache = new ThreadLinksCache()
  let finish!: (links: ThreadLinks) => void
  const stale = cache.get(
    's',
    't',
    1,
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await Promise.resolve()
  const committed = ThreadLinks.from('t', [])
  cache.committed('s', 1, 2, new Map([['t', committed]]))
  finish(ThreadLinks.from('t', []))
  await stale
  expect(cache.peek('s', 't', 2)).toBe(committed)
})
