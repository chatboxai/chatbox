import uniq from 'lodash/uniq'
import { getChatboxAPIOrigin, isChatboxAPIOriginOverridden, setDynamicChatboxAPIOrigin } from './chatbox-api-origin'

export { getChatboxAPIOrigin } from './chatbox-api-origin'

/** Built-in origins in fixed priority order; the first one is the primary origin. */
const DEFAULT_POOL = [
  'https://api.chatboxai.app',
  'https://api.chatbox.run',
  'https://api.chatboxai.com',
  'https://api.ai-chatbox.com',
  'https://api.chatboxapp.xyz',
]
const PRIMARY_ORIGIN = DEFAULT_POOL[0]
/** Same deployment as the primary origin: recognized as Chatbox API but never probed as a fallback. */
const PRIMARY_ALIASES = ['https://chatboxai.app']

const CACHE_KEY = 'api_origins'
const CACHE_TTL_MS = 60 * 60 * 1000
/** Re-probe interval while the primary origin is confirmed reachable. */
const PRIMARY_PROBE_INTERVAL_MS = 60 * 60 * 1000
/** Re-probe interval while traffic uses a fallback origin, so it returns to the primary soon after recovery. */
const FALLBACK_PROBE_INTERVAL_MS = 5 * 60 * 1000
const PROBE_TIMEOUT_MS = 3000
/** Delay before confirming a failed origin with a second attempt. */
const PROBE_RETRY_DELAY_MS = 1000
/** Minimum gap between a finished probe and a probe triggered by a failed Chatbox API request. */
const NETWORK_ERROR_REPROBE_INTERVAL_MS = 60 * 1000

export interface ApiOriginsStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

export type ApiOriginProbeFetch = (input: string, init?: RequestInit) => Promise<Response>

/** Last successful probe: the selected origin and the server-advertised origins outside the built-in pool. */
interface CachedOrigins {
  origin: string
  extras: string[]
  expireAt: number
}

function createMemoryStorage(): ApiOriginsStorage {
  const values = new Map<string, unknown>()
  return {
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
  }
}

let extraOrigins: string[] = []
let storage: ApiOriginsStorage = createMemoryStorage()
let probeFetch: ApiOriginProbeFetch = (input, init) => fetch(input, init)
let inflightProbe: Promise<string | null> | null = null
let lastProbeFinishedAt = 0
let lifecycle: ProbeLifecycle | null = null
let probeTimer: ReturnType<typeof setTimeout> | null = null

function candidateOrigins(): string[] {
  return uniq([...DEFAULT_POOL, ...extraOrigins])
}

export function isChatboxAPI(input: RequestInfo | URL) {
  const url = typeof input === 'string' ? input : ((input as Request).url ?? input.toString())
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return false
  }
  return candidateOrigins().includes(origin) || PRIMARY_ALIASES.includes(origin) || origin === getChatboxAPIOrigin()
}

function isExtraOrigin(origin: string): boolean {
  return !DEFAULT_POOL.includes(origin) && !PRIMARY_ALIASES.includes(origin)
}

function isOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('https://')) return false
  try {
    return new URL(value).origin === value
  } catch {
    return false
  }
}

async function readCache(): Promise<CachedOrigins | null> {
  try {
    const value = await storage.get(CACHE_KEY)
    if (!value || typeof value !== 'object') return null
    const { origin, extras, expireAt } = value as Partial<CachedOrigins>
    if (!isOrigin(origin) || PRIMARY_ALIASES.includes(origin) || !Array.isArray(extras)) return null
    if (typeof expireAt !== 'number') return null
    return { origin, extras: extras.filter(isOrigin).filter(isExtraOrigin), expireAt }
  } catch {
    return null
  }
}

/** One start..stop span of probing; aborting its controller makes all of its pending work inert. */
interface ProbeLifecycle {
  controller: AbortController
}

/** Waits `ms`, or less when the lifecycle stops; the timer is cleared either way. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Resolves with the advertised origins when the origin answers 2xx JSON whose `data.api_origins` is a non-empty
 * array of https origins that includes a built-in origin; rejects anything else (e.g. a proxy or hijacked page).
 */
async function fetchAdvertisedOrigins(origin: string, signal: AbortSignal): Promise<string[]> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, PROBE_TIMEOUT_MS)
  signal.addEventListener('abort', abort, { once: true })
  try {
    const res = await probeFetch(`${origin}/api/api_origins`, {
      signal: controller.signal as unknown as NonNullable<RequestInit['signal']>,
    })
    if (!res.ok) throw new Error(`Status Code ${res.status}`)
    const body: unknown = await res.json()
    const origins = (body as { data?: { api_origins?: unknown } } | null)?.data?.api_origins
    if (!Array.isArray(origins) || !origins.every(isOrigin) || !origins.some((o) => DEFAULT_POOL.includes(o))) {
      throw new Error('Invalid api_origins response')
    }
    return origins
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

/** An origin counts as down only after it fails twice, one second apart. */
async function checkOrigin(origin: string, signal: AbortSignal): Promise<string[] | null> {
  for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
    if (attempt > 0) await delay(PROBE_RETRY_DELAY_MS, signal)
    if (signal.aborted) break
    try {
      return await fetchAdvertisedOrigins(origin, signal)
    } catch {
      // 确认失败前重试一次
    }
  }
  return null
}

/**
 * Tries origins in fixed priority order (built-in pool, then advertised extras); the first reachable one takes all
 * traffic. On startup a fresh cached origin is applied before any network request, as the initial value.
 * Nothing is published, stored or scheduled once the lifecycle has stopped.
 */
async function probe(life: ProbeLifecycle, startup: boolean): Promise<string | null> {
  const { signal } = life.controller
  const cached = await readCache()
  if (signal.aborted) return null
  if (cached) {
    extraOrigins = uniq([...extraOrigins, ...cached.extras])
    if (startup && cached.expireAt > Date.now()) setDynamicChatboxAPIOrigin(cached.origin)
  }

  for (const origin of candidateOrigins()) {
    const advertised = await checkOrigin(origin, signal)
    if (signal.aborted) return null
    if (!advertised) continue
    extraOrigins = uniq([...extraOrigins, ...advertised]).filter(isExtraOrigin)
    setDynamicChatboxAPIOrigin(origin)
    const entry: CachedOrigins = { origin, extras: extraOrigins, expireAt: Date.now() + CACHE_TTL_MS }
    await storage.set(CACHE_KEY, entry).catch(() => {})
    return origin
  }
  // 全部不可用时沿用最近一次可用的域名（没有缓存则保留当前域名），等待下一次探测
  if (cached) setDynamicChatboxAPIOrigin(cached.origin)
  return null
}

function runProbe(life: ProbeLifecycle, startup: boolean): Promise<string | null> {
  const current: Promise<string | null> = probe(life, startup)
    .catch(() => null)
    .then((origin) => {
      if (inflightProbe === current) inflightProbe = null
      if (lifecycle !== life) return null
      lastProbeFinishedAt = Date.now()
      const interval = origin === PRIMARY_ORIGIN ? PRIMARY_PROBE_INTERVAL_MS : FALLBACK_PROBE_INTERVAL_MS
      probeTimer = setTimeout(() => void testApiOrigins(), interval)
      return origin
    })
  inflightProbe = current
  return current
}

/**
 * Probes the origins and selects the first reachable one. Concurrent calls share one probe.
 * Resolves with the selected origin, or null when every origin failed or probing is not running.
 */
export function testApiOrigins(): Promise<string | null> {
  if (inflightProbe) return inflightProbe
  if (!lifecycle) return Promise.resolve(null)
  if (probeTimer) clearTimeout(probeTimer)
  probeTimer = null
  return runProbe(lifecycle, false)
}

/** Re-probes origins after a Chatbox API request failed without receiving an HTTP response. */
export function reportChatboxAPINetworkError(): void {
  if (!lifecycle) return
  if (inflightProbe || Date.now() - lastProbeFinishedAt < NETWORK_ERROR_REPROBE_INTERVAL_MS) return
  void testApiOrigins()
}

function stopProbing(): void {
  lifecycle?.controller.abort()
  lifecycle = null
  inflightProbe = null
  if (probeTimer) clearTimeout(probeTimer)
  probeTimer = null
}

/**
 * Starts origin selection for this JS context. A fresh cached origin is the initial value until the non-blocking
 * startup probe completes. Re-probes hourly while the primary origin is confirmed reachable, otherwise every 5 minutes.
 * Does nothing when an environment override (local/beta API) pins the origin or probing already runs.
 * Returns a function that stops the scheduled, in-flight and network-error probes started by this call.
 */
export function startChatboxAPIOriginProbing(
  options: { storage?: ApiOriginsStorage; fetch?: ApiOriginProbeFetch } = {}
): () => void {
  if (lifecycle || isChatboxAPIOriginOverridden()) return () => {}
  if (options.storage) storage = options.storage
  if (options.fetch) probeFetch = options.fetch
  const life: ProbeLifecycle = { controller: new AbortController() }
  lifecycle = life
  void runProbe(life, true)
  return () => {
    if (lifecycle === life) stopProbing()
  }
}

/** Test-only: restores the initial module state. */
export function resetChatboxAPIOriginProbingForTest(): void {
  stopProbing()
  extraOrigins = []
  storage = createMemoryStorage()
  probeFetch = (input, init) => fetch(input, init)
  inflightProbe = null
  lastProbeFinishedAt = 0
  setDynamicChatboxAPIOrigin(PRIMARY_ORIGIN)
}
