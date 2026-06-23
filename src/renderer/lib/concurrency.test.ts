import { describe, expect, it } from 'vitest'
import { type AttemptResult, concurrencyLadder, mapWithConcurrency, runWithConcurrencyFallback } from './concurrency'

const tick = () => new Promise((r) => setTimeout(r, 1))

describe('mapWithConcurrency', () => {
  it('returns results in input order', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10)
    expect(out).toEqual([10, 20, 30, 40])
  })

  it('never runs more than `limit` tasks at once', async () => {
    let inFlight = 0
    let maxInFlight = 0
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async (n) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await tick()
        inFlight -= 1
        return n
      }
    )
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('handles empty input', async () => {
    expect(await mapWithConcurrency([], 5, async (n) => n)).toEqual([])
  })
})

describe('concurrencyLadder', () => {
  it('default 10 -> [10, 3, 1]', () => {
    expect(concurrencyLadder(10)).toEqual([10, 3, 1])
  })
  it('collapses when configured is already small', () => {
    expect(concurrencyLadder(5)).toEqual([5, 3, 1])
    expect(concurrencyLadder(3)).toEqual([3, 1])
    expect(concurrencyLadder(2)).toEqual([2, 1])
    expect(concurrencyLadder(1)).toEqual([1])
  })
  it('clamps invalid input to at least 1', () => {
    expect(concurrencyLadder(0)).toEqual([1])
    expect(concurrencyLadder(-4)).toEqual([1])
  })
})

describe('runWithConcurrencyFallback', () => {
  it('returns all successes when nothing fails (single pass)', async () => {
    const levels: number[] = []
    const out = await runWithConcurrencyFallback(['a', 'b', 'c'], concurrencyLadder(10), async (id) => {
      levels.push(0)
      return { ok: true, result: id.toUpperCase() } as AttemptResult<string>
    })
    expect(out).toEqual([
      { id: 'a', ok: true, result: 'A' },
      { id: 'b', ok: true, result: 'B' },
      { id: 'c', ok: true, result: 'C' },
    ])
    // each id attempted exactly once (no retry pass)
    expect(levels.length).toBe(3)
  })

  it('retries only the failed ids at the next level and keeps earlier successes', async () => {
    const attemptsById: Record<string, number> = {}
    // 'b' fails on the first pass (level 10) but succeeds on the retry (level 3)
    const out = await runWithConcurrencyFallback(['a', 'b', 'c'], concurrencyLadder(10), async (id) => {
      attemptsById[id] = (attemptsById[id] ?? 0) + 1
      if (id === 'b' && attemptsById.b === 1) return { ok: false, error: 'rate limited' }
      return { ok: true, result: `${id}:${attemptsById[id]}` }
    })
    expect(attemptsById).toEqual({ a: 1, b: 2, c: 1 }) // only b retried
    expect(out.find((r) => r.id === 'b')).toEqual({ id: 'b', ok: true, result: 'b:2' })
    expect(out.every((r) => r.ok)).toBe(true)
  })

  it('reports permanent failures after exhausting the ladder, with the last error', async () => {
    const attempts: Record<string, number> = {}
    const out = await runWithConcurrencyFallback(['x'], concurrencyLadder(10), async (id) => {
      attempts[id] = (attempts[id] ?? 0) + 1
      return { ok: false, error: `fail#${attempts[id]}` }
    })
    expect(attempts.x).toBe(3) // 10 -> 3 -> 1, three passes
    expect(out).toEqual([{ id: 'x', ok: false, error: 'fail#3' }])
  })
})
