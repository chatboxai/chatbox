import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { getChatboxAPIOrigin } from './chatbox-api-origin'
import {
  type ApiOriginProbeFetch,
  type ApiOriginsStorage,
  isChatboxAPI,
  reportChatboxAPINetworkError,
  resetChatboxAPIOriginProbingForTest,
  startChatboxAPIOriginProbing,
  testApiOrigins,
} from './chatboxai_pool'
import { createAfetch } from './request'

const platformInfo = { type: 'desktop', platform: 'darwin', os: 'macos', version: '1.0.0' }

const PRIMARY = 'https://api.chatboxai.app'
const FALLBACK = 'https://api.chatbox.run'
/** Same deployment as the primary; never probed. */
const PRIMARY_ALIAS = 'https://chatboxai.app'
/** The response `/api/api_origins` currently returns in production. */
const SERVER_ORIGINS = [PRIMARY_ALIAS, PRIMARY]

function originsResponse(origins: string[] = [FALLBACK, PRIMARY]) {
  return new Response(JSON.stringify({ data: { api_origins: origins } }), { status: 200 })
}

/** Probe fetch where only the origins currently in `reachable` answer. */
function reachableOnly(...reachable: string[]) {
  const fetchMock = vi.fn<ApiOriginProbeFetch>(async (input) => {
    if (reachable.some((origin) => input.startsWith(`${origin}/`))) return originsResponse()
    throw new TypeError('fetch failed')
  })
  return Object.assign(fetchMock, { reachable })
}

function memoryStorage(initial: Record<string, unknown> = {}): ApiOriginsStorage & { values: Map<string, unknown> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value)
    },
  }
}

function probedOrigins(fetchMock: Mock<ApiOriginProbeFetch>) {
  return fetchMock.mock.calls.map(([url]) => new URL(String(url)).origin)
}

/** Lets the startup probe (including one-second retries of failed origins) finish. */
async function settle() {
  await vi.advanceTimersByTimeAsync(10_000)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  resetChatboxAPIOriginProbingForTest()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Chatbox API origin probing', () => {
  it('keeps the primary origin when it fails once and then succeeds', async () => {
    let primaryCalls = 0
    const fetchMock = vi.fn<ApiOriginProbeFetch>(async (input) => {
      if (input.startsWith(`${PRIMARY}/`) && ++primaryCalls === 1) throw new TypeError('fetch failed')
      return originsResponse()
    })
    startChatboxAPIOriginProbing({ fetch: fetchMock })
    await settle()

    expect(probedOrigins(fetchMock)).toEqual([PRIMARY, PRIMARY])
    expect(getChatboxAPIOrigin({})).toBe(PRIMARY)
  })

  it('switches to the next origin when the primary stays down', async () => {
    const fetchMock = reachableOnly(FALLBACK)
    const storage = memoryStorage()
    startChatboxAPIOriginProbing({ fetch: fetchMock, storage })
    await settle()

    expect(probedOrigins(fetchMock)).toEqual([PRIMARY, PRIMARY, FALLBACK])
    expect(getChatboxAPIOrigin({})).toBe(FALLBACK)
    expect(storage.values.get('api_origins')).toMatchObject({ origin: FALLBACK })
  })

  it('switches back to the primary within 5 minutes after it recovers', async () => {
    const fetchMock = reachableOnly(FALLBACK)
    startChatboxAPIOriginProbing({ fetch: fetchMock })
    await settle()
    expect(getChatboxAPIOrigin({})).toBe(FALLBACK)

    fetchMock.reachable.push(PRIMARY)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    expect(getChatboxAPIOrigin({})).toBe(PRIMARY)
  })

  it('re-probes hourly while on the primary origin', async () => {
    const fetchMock = reachableOnly(PRIMARY)
    startChatboxAPIOriginProbing({ fetch: fetchMock })
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a non-2xx response', () => new Response(JSON.stringify({ data: { api_origins: [PRIMARY] } }), { status: 503 })],
    ['a non-JSON body', () => new Response('<html>ok</html>', { status: 200 })],
    ['a missing data.api_origins', () => new Response(JSON.stringify({ data: {} }), { status: 200 })],
    [
      'a non-array data.api_origins',
      () => new Response(JSON.stringify({ data: { api_origins: PRIMARY } }), { status: 200 }),
    ],
  ])('does not count the primary as up on %s', async (_, invalidResponse) => {
    const fetchMock = vi.fn<ApiOriginProbeFetch>(async (input) =>
      input.startsWith(`${PRIMARY}/`) ? invalidResponse() : originsResponse()
    )
    startChatboxAPIOriginProbing({ fetch: fetchMock })
    await settle()

    expect(probedOrigins(fetchMock)).toEqual([PRIMARY, PRIMARY, FALLBACK])
    expect(getChatboxAPIOrigin({})).toBe(FALLBACK)
  })

  it.each([
    ['an empty list', []],
    ['only unrelated origins', ['https://proxy.example.test']],
    ['a non-https entry', [PRIMARY, 'http://chatboxai.app']],
  ])('does not count the primary as up when data.api_origins has %s', async (_, origins) => {
    const fetchMock = vi.fn<ApiOriginProbeFetch>(async (input) =>
      originsResponse(input.startsWith(`${PRIMARY}/`) ? origins : undefined)
    )
    startChatboxAPIOriginProbing({ fetch: fetchMock })
    await settle()

    expect(getChatboxAPIOrigin({})).toBe(FALLBACK)
  })

  it('probes server-advertised origins after the built-in ones', async () => {
    const extra = 'https://new.example.test'
    const fetchMock = vi.fn<ApiOriginProbeFetch>(async () => originsResponse([PRIMARY, extra]))
    startChatboxAPIOriginProbing({ fetch: fetchMock })
    await settle()
    expect(isChatboxAPI(`${extra}/api/user`)).toBe(true)

    fetchMock.mockImplementation(async (input) => {
      if (input.startsWith(`${extra}/`)) return originsResponse([PRIMARY, extra])
      throw new TypeError('fetch failed')
    })
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 30_000)

    expect(probedOrigins(fetchMock).slice(1)).toEqual([
      PRIMARY,
      PRIMARY,
      FALLBACK,
      FALLBACK,
      'https://api.chatboxai.com',
      'https://api.chatboxai.com',
      'https://api.ai-chatbox.com',
      'https://api.ai-chatbox.com',
      'https://api.chatboxapp.xyz',
      'https://api.chatboxapp.xyz',
      extra,
    ])
    expect(getChatboxAPIOrigin({})).toBe(extra)
  })

  it('uses a fresh cached origin until the startup probe completes, then probes anyway', async () => {
    const fetchMock = reachableOnly(PRIMARY)
    const storage = memoryStorage({
      api_origins: { origin: FALLBACK, extras: [], expireAt: Date.now() + 60_000 },
    })
    // The first primary probe hangs until the probe timeout aborts it.
    fetchMock.mockImplementationOnce(
      (_, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    )
    startChatboxAPIOriginProbing({ fetch: fetchMock, storage })

    await vi.advanceTimersByTimeAsync(0)
    expect(getChatboxAPIOrigin({})).toBe(FALLBACK)
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getChatboxAPIOrigin({})).toBe(PRIMARY)
  })

  it('keeps the current origin when every origin is unreachable', async () => {
    startChatboxAPIOriginProbing({ fetch: reachableOnly() })
    await vi.advanceTimersByTimeAsync(30_000)

    expect(getChatboxAPIOrigin({})).toBe(PRIMARY)
  })

  it('falls back to the expired cached origin when every origin is unreachable', async () => {
    const storage = memoryStorage({
      api_origins: { origin: FALLBACK, extras: [], expireAt: Date.now() - 1 },
    })
    startChatboxAPIOriginProbing({ fetch: reachableOnly(), storage })
    await vi.advanceTimersByTimeAsync(30_000)

    expect(getChatboxAPIOrigin({})).toBe(FALLBACK)
  })

  it('shares one in-flight probe between concurrent callers', async () => {
    const fetchMock = reachableOnly(PRIMARY)
    startChatboxAPIOriginProbing({ fetch: fetchMock })

    await Promise.all([testApiOrigins(), testApiOrigins()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not probe while an environment override pins the origin', async () => {
    vi.stubEnv('USE_LOCAL_API', '1')
    const fetchMock = reachableOnly(PRIMARY)
    startChatboxAPIOriginProbing({ fetch: fetchMock })
    reportChatboxAPINetworkError()
    await settle()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops scheduled and network-error probes when the returned stop function runs', async () => {
    const fetchMock = reachableOnly(FALLBACK)
    const stop = startChatboxAPIOriginProbing({ fetch: fetchMock })
    await settle()
    const calls = fetchMock.mock.calls.length

    stop()
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    reportChatboxAPINetworkError()
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(calls)
  })

  it('keeps probing when a redundant start call is stopped', async () => {
    const fetchMock = reachableOnly(PRIMARY)
    startChatboxAPIOriginProbing({ fetch: fetchMock })
    startChatboxAPIOriginProbing({ fetch: fetchMock })()
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('primary origin alias', () => {
  it('accepts the current server response and never probes or selects the primary alias', async () => {
    const fetchMock = vi.fn<ApiOriginProbeFetch>(async (input) => {
      if (input.startsWith(`${PRIMARY}/`) || input.startsWith(`${PRIMARY_ALIAS}/`)) {
        return originsResponse(SERVER_ORIGINS)
      }
      throw new TypeError('fetch failed')
    })
    const storage = memoryStorage()
    startChatboxAPIOriginProbing({ fetch: fetchMock, storage })
    await settle()
    expect(getChatboxAPIOrigin({})).toBe(PRIMARY)
    expect(storage.values.get('api_origins')).toMatchObject({ origin: PRIMARY, extras: [] })

    fetchMock.mockImplementation(async (input) => {
      if (input.startsWith(`${PRIMARY_ALIAS}/`)) return originsResponse(SERVER_ORIGINS)
      throw new TypeError('fetch failed')
    })
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 30_000)

    expect(probedOrigins(fetchMock)).not.toContain(PRIMARY_ALIAS)
    expect(getChatboxAPIOrigin({})).toBe(PRIMARY)
  })

  it('ignores the primary alias in cached origins', async () => {
    const fetchMock = reachableOnly()
    const storage = memoryStorage({
      api_origins: { origin: PRIMARY_ALIAS, extras: [PRIMARY_ALIAS], expireAt: Date.now() + 60_000 },
    })
    startChatboxAPIOriginProbing({ fetch: fetchMock, storage })
    await vi.advanceTimersByTimeAsync(30_000)

    expect(probedOrigins(fetchMock)).not.toContain(PRIMARY_ALIAS)
    expect(getChatboxAPIOrigin({})).toBe(PRIMARY)
  })
})

describe('probe lifecycle', () => {
  /** Probe fetch that answers only when `release` is called, and rejects when aborted. */
  function deferredFetch() {
    const pending: Array<() => void> = []
    const fetchMock = vi.fn<ApiOriginProbeFetch>(
      (_, init) =>
        new Promise((resolve, reject) => {
          pending.push(() => resolve(originsResponse()))
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    return Object.assign(fetchMock, { release: () => pending.shift()?.() })
  }

  it('stops during the retry delay without further requests, publication or timers', async () => {
    const fetchMock = reachableOnly(FALLBACK)
    const storage = memoryStorage()
    const stop = startChatboxAPIOriginProbing({ fetch: fetchMock, storage })
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    stop()
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getChatboxAPIOrigin({})).toBe(PRIMARY)
    expect(storage.values.has('api_origins')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts an in-flight request on stop and ignores a late answer', async () => {
    const fetchMock = deferredFetch()
    const storage = memoryStorage()
    const stop = startChatboxAPIOriginProbing({ fetch: fetchMock, storage })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const signal = fetchMock.mock.calls[0][1]?.signal

    stop()
    fetchMock.release()
    await settle()

    expect(signal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(storage.values.has('api_origins')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let a stopped probe publish into a restarted lifecycle', async () => {
    const first = deferredFetch()
    const stop = startChatboxAPIOriginProbing({ fetch: first })
    await vi.advanceTimersByTimeAsync(0)
    stop()

    const second = reachableOnly(FALLBACK)
    startChatboxAPIOriginProbing({ fetch: second })
    first.release()
    await settle()

    expect(second).toHaveBeenCalled()
    expect(getChatboxAPIOrigin({})).toBe(FALLBACK)
  })

  it('applies the startup cache before probing so a confirmed probe result is not overwritten', async () => {
    const fetchMock = reachableOnly(PRIMARY)
    const values = new Map<string, unknown>([
      ['api_origins', { origin: FALLBACK, extras: [], expireAt: Date.now() + 60_000 }],
    ])
    const storage: ApiOriginsStorage = {
      get: async (key) => {
        await new Promise((resolve) => setTimeout(resolve, 500))
        return values.get(key) ?? null
      },
      set: async (key, value) => {
        await new Promise((resolve) => setTimeout(resolve, 500))
        values.set(key, value)
      },
    }
    startChatboxAPIOriginProbing({ fetch: fetchMock, storage })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalled()
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getChatboxAPIOrigin({})).toBe(PRIMARY)
    expect(values.get('api_origins')).toMatchObject({ origin: PRIMARY })
  })
})

describe('isChatboxAPI', () => {
  it('matches exact Chatbox API origins only', () => {
    expect(isChatboxAPI('https://api.chatboxai.app/api/user')).toBe(true)
    expect(isChatboxAPI('https://api.chatbox.run/api/user')).toBe(true)
    expect(isChatboxAPI('https://api.chatboxai.com/api/user')).toBe(true)
    expect(isChatboxAPI(new URL('https://chatboxai.app/api/user'))).toBe(true)
    expect(isChatboxAPI('https://api.chatboxai.app.example.org/api/user')).toBe(false)
    expect(isChatboxAPI('https://api.chatboxai.app@other.example/api/user')).toBe(false)
    expect(isChatboxAPI('not a url')).toBe(false)
  })
})

describe('re-probing after failed Chatbox API requests', () => {
  async function startWithSettledProbe(probeFetch: Mock<ApiOriginProbeFetch>) {
    startChatboxAPIOriginProbing({ fetch: probeFetch })
    await vi.advanceTimersByTimeAsync(0)
    probeFetch.mockClear()
    // Leave the minimum re-probe interval after the startup probe.
    await vi.advanceTimersByTimeAsync(60_000)
  }

  it('re-probes once when a request gets no HTTP response, then waits for the minimum interval', async () => {
    const probeFetch = reachableOnly(PRIMARY)
    await startWithSettledProbe(probeFetch)
    probeFetch.reachable.splice(0, 1, FALLBACK)
    const afetch = createAfetch(platformInfo, vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const request = expect(afetch('https://api.chatboxai.app/api/user', undefined, { retry: 2 })).rejects.toThrow(
      'fetch failed'
    )
    await vi.advanceTimersByTimeAsync(5000)
    await request

    expect(probedOrigins(probeFetch)).toEqual([PRIMARY, PRIMARY, FALLBACK])
    expect(getChatboxAPIOrigin({})).toBe(FALLBACK)

    reportChatboxAPINetworkError()
    await vi.advanceTimersByTimeAsync(0)
    expect(probeFetch).toHaveBeenCalledTimes(3)
  })

  it.each([404, 503])('does not re-probe on HTTP %s', async (status) => {
    const probeFetch = reachableOnly('https://api.chatboxai.app')
    await startWithSettledProbe(probeFetch)
    const afetch = createAfetch(platformInfo, vi.fn().mockResolvedValue(new Response('error', { status })))

    const request = expect(afetch('https://api.chatboxai.app/api/user')).rejects.toThrow(`Status Code ${status}`)
    await vi.advanceTimersByTimeAsync(1000)
    await request

    expect(probeFetch).not.toHaveBeenCalled()
  })

  it.each([
    'https://api.openai.com/v1/models',
    'https://api.chatboxai.app.example.org/v1/models',
    'https://api.chatboxai.app@other.example/v1/models',
  ])('does not re-probe when a non-Chatbox request to %s fails', async (url) => {
    const probeFetch = reachableOnly('https://api.chatboxai.app')
    await startWithSettledProbe(probeFetch)
    const afetch = createAfetch(platformInfo, vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const request = expect(afetch(url)).rejects.toThrow('fetch failed')
    await vi.advanceTimersByTimeAsync(1000)
    await request

    expect(probeFetch).not.toHaveBeenCalled()
  })
})
