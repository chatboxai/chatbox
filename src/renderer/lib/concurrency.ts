// Small dependency-free concurrency helpers used by the AI-manager bulk summary tool.

/**
 * Map over `items` running at most `limit` async calls concurrently.
 * Results are returned in input order. Never rejects on its own — `fn` should
 * resolve (not throw) for per-item failures it wants to handle.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  if (items.length === 0) return results
  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  let cursor = 0
  const worker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/**
 * Build a strictly-decreasing concurrency ladder from `configured` down through
 * the fallback levels (3, then 1). Default 10 -> [10, 3, 1]; e.g. 3 -> [3, 1];
 * 1 -> [1]. Each level is a separate retry pass over the still-failing items.
 */
export function concurrencyLadder(configured: number, fallbacks: number[] = [3, 1]): number[] {
  const start = Math.max(1, Math.floor(configured) || 1)
  return [start, ...fallbacks].reduce<number[]>((acc, n) => {
    const last = acc[acc.length - 1]
    if (last === undefined || n < last) acc.push(Math.max(1, Math.floor(n)))
    return acc
  }, [])
}

export interface AttemptResult<R> {
  ok: boolean
  result?: R
  error?: string
}

/**
 * Run `attempt` over `ids` at the first concurrency level; items that fail are
 * retried at each subsequent (lower) level. Successes from earlier passes are
 * kept. Returns one entry per id, in the original order.
 */
export async function runWithConcurrencyFallback<R>(
  ids: string[],
  levels: number[],
  attempt: (id: string) => Promise<AttemptResult<R>>
): Promise<Array<{ id: string } & AttemptResult<R>>> {
  const successById = new Map<string, AttemptResult<R>>()
  const lastErrorById = new Map<string, string>()
  let pending = [...ids]
  for (const level of levels) {
    if (pending.length === 0) break
    const wave = await mapWithConcurrency(pending, level, (id) => attempt(id))
    const stillPending: string[] = []
    pending.forEach((id, i) => {
      const r = wave[i]
      if (r.ok) {
        successById.set(id, r)
        lastErrorById.delete(id)
      } else {
        stillPending.push(id)
        lastErrorById.set(id, r.error ?? 'unknown error')
      }
    })
    pending = stillPending
  }
  return ids.map((id) => {
    const ok = successById.get(id)
    return ok ? { id, ...ok } : { id, ok: false, error: lastErrorById.get(id) ?? 'failed' }
  })
}
