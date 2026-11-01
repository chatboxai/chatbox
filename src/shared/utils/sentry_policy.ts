export type SentryErrorPriority = 'critical' | 'high' | 'normal'
export type SentryErrorSource = 'main' | 'renderer'

type SentryTagValue = string | number | boolean | null | undefined

interface SentryExceptionMechanismLike {
  handled?: boolean
  type?: string
}

interface SentryExceptionValueLike {
  mechanism?: SentryExceptionMechanismLike
  stacktrace?: {
    frames?: Array<{
      abs_path?: unknown
      filename?: unknown
      module?: unknown
    }>
  }
  type?: unknown
  value?: unknown
}

interface SentryEventLike {
  breadcrumbs?: Array<{
    category?: string
    data?: Record<string, unknown>
    message?: unknown
    type?: string
  }>
  contexts?: Record<string, unknown>
  exception?: {
    values?: SentryExceptionValueLike[]
  }
  extra?: Record<string, unknown>
  level?: string
  message?: unknown
  request?: {
    data?: unknown
    headers?: Record<string, string>
    url?: unknown
  }
  tags?: Record<string, SentryTagValue>
  user?: unknown
}

interface SentryEventHintLike {
  originalException?: unknown
}

export interface SentryEventProcessorOptions {
  dedupeOriginalExceptions?: boolean
  normalSampleRate: number
  random?: () => number
  source: SentryErrorSource
}

const HIGH_PRIORITY_OPERATIONS = new Set([
  'app_initialization',
  'database_access',
  'database_initialization',
  'initialization',
  'migration',
  'transaction_failure',
  'transaction_rollback',
  'vector_store_access',
  'vector_store_initialization',
  'worker_loop',
])

const PRIVATE_CONTEXT_KEYS = new Set([
  'content',
  'content_preview',
  'contents',
  'db_path',
  'email',
  'file_name',
  'file_path',
  'filename',
  'message',
  'messages',
  'name',
  'option',
  'options',
  'prompt',
  'prompts',
  'queries',
  'query',
  'query_summary',
  'request_body',
  'response_body',
])

const CREDENTIAL_KEY_SUFFIXES = [
  'access_key',
  'access_key_id',
  'api_key',
  'auth_header',
  'authorization',
  'bearer',
  'client_key',
  'consumer_key',
  'cookie',
  'credential',
  'encryption_key',
  'license_key',
  'password',
  'passwd',
  'private_key',
  'pwd',
  'secret',
  'signing_key',
  'token',
]

const URL_BREADCRUMB_KEYS = new Set(['from', 'to', 'url'])
const MAX_SANITIZE_DEPTH = 6

const IGNORED_ERROR_MESSAGES = [
  /^script error\.?$/i,
  /resizeobserver loop (?:completed with undelivered notifications|limit exceeded)/i,
]

const SAFE_ERROR_DESCRIPTOR_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,63}$/i

function valueKind(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function safeErrorDescriptor(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && SAFE_ERROR_DESCRIPTOR_PATTERN.test(value)) return value
  return undefined
}

/**
 * Turn values thrown by third-party/provider code into a real Error without
 * copying the original object, message, request body, credentials, or user data.
 */
export function normalizeErrorForSentry(error: unknown): Error {
  if (error instanceof Error) return error

  const descriptors: string[] = [valueKind(error)]
  if (typeof error === 'number') {
    const value = safeErrorDescriptor(error)
    if (value) {
      descriptors.push(`value=${value}`)
    }
  }
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    try {
      const record = error as Record<string, unknown>
      const nested = record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>) : null
      const sources = nested ? [record, nested] : [record]
      const fields = [
        ['name', 'name'],
        ['type', 'type'],
        ['code', 'code'],
        ['status', 'status'],
        ['statusCode', 'status_code'],
      ] as const

      for (const source of sources) {
        for (const [field, label] of fields) {
          const value = safeErrorDescriptor(source[field])
          if (value && !descriptors.includes(`${label}=${value}`)) {
            descriptors.push(`${label}=${value}`)
          }
        }
      }
    } catch {
      // Proxies and throwing getters are intentionally reduced to their type.
    }
  }

  const normalized = new Error(`Non-Error exception (${descriptors.join('; ')})`)
  normalized.name = 'NonErrorException'
  return normalized
}

function isWeakSetValue(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function tagString(value: SentryTagValue): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  return String(value)
}

function getExceptionValue(event: SentryEventLike): SentryExceptionValueLike | undefined {
  return event.exception?.values?.at(-1)
}

function getErrorMessage(event: SentryEventLike): string {
  const exceptionValue = getExceptionValue(event)?.value
  if (typeof exceptionValue === 'string') return exceptionValue
  return typeof event.message === 'string' ? event.message : ''
}

function shouldIgnoreEvent(event: SentryEventLike): boolean {
  const exception = getExceptionValue(event)
  if (exception?.type === 'AbortError') {
    return true
  }

  const message = getErrorMessage(event).trim()
  return IGNORED_ERROR_MESSAGES.some((pattern) => pattern.test(message))
}

function inferDomain(tags: Record<string, SentryTagValue>): string {
  const explicitDomain = tagString(tags.error_domain)
  if (explicitDomain) {
    return explicitDomain
  }

  const component = tagString(tags.component) ?? ''
  if (component.startsWith('session-attachment-rag')) {
    return 'session-attachment-rag'
  }
  if (component.startsWith('knowledge-base')) {
    return 'knowledge-base'
  }
  if (component === 'agent-mode') {
    return 'agent-mode'
  }
  if (tags.errorBoundary) {
    return 'ui'
  }
  return component || 'application'
}

function inferOperation(event: SentryEventLike, tags: Record<string, SentryTagValue>): string {
  return (
    tagString(tags.error_operation) ??
    tagString(tags.operation) ??
    tagString(tags.errorBoundary) ??
    tagString(tags.errorType) ??
    getExceptionValue(event)?.mechanism?.type ??
    'unknown'
  )
}

function inferPriority(
  event: SentryEventLike,
  tags: Record<string, SentryTagValue>,
  operation: string
): SentryErrorPriority {
  const explicitPriority = tagString(tags.error_priority)
  if (explicitPriority === 'critical' || explicitPriority === 'high' || explicitPriority === 'normal') {
    return explicitPriority
  }

  const mechanism = getExceptionValue(event)?.mechanism
  if (tags.errorBoundary || tags.errorType === 'global' || tags.errorType === 'unhandledRejection') {
    return 'critical'
  }
  if (mechanism?.handled === false || event.level === 'fatal') {
    return 'critical'
  }
  if (HIGH_PRIORITY_OPERATIONS.has(operation) || tags.component === 'agent-mode') {
    return 'high'
  }
  return 'normal'
}

function inferHandled(event: SentryEventLike, tags: Record<string, SentryTagValue>): boolean {
  const explicitHandled = tagString(tags.error_handled)
  if (explicitHandled === 'true' || explicitHandled === 'false') {
    return explicitHandled === 'true'
  }

  if (tags.errorType === 'global' || tags.errorType === 'unhandledRejection') {
    return false
  }
  return getExceptionValue(event)?.mechanism?.handled ?? true
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.split(/[?#]/, 1)[0]
  }
}

function sanitizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return `[non-string ${valueKind(value)}]`
  }
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/([?&](?:api_?key|access_?token|token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[redacted]')
    .replace(/\/home\/[^/\s]+/g, '/home/[redacted]')
    .replace(/([A-Z]):\\Users\\[^\\\s]+/gi, '$1:\\Users\\[redacted]')
    .replace(/([A-Z]):\/Users\/[^/\s]+/gi, '$1:/Users/[redacted]')
}

const APP_FRAME_SCHEME = 'app:///'
const FRAME_ORIGIN_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)/i
const APP_FRAME_PROTOCOLS = new Set(['app', 'capacitor', 'file', 'ionic'])
const LOCAL_HOST_PATTERN = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i
const FRAME_DRIVE_LETTER_PATTERN = /^\/?[a-z]:(?=\/)/i
const FRAME_APP_ROOT_MARKERS = ['/resources/app.asar/', '/resources/app/', '/app.asar/']
const FRAME_BUNDLE_ROOTS = ['apps', 'dist', 'node_modules', 'out', 'output', 'packages', 'src']

function resolveRelativeSegments(path: string): string {
  const resolved: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      resolved.pop()
      continue
    }
    resolved.push(segment)
  }
  return resolved.join('/')
}

/** Index of the earliest bundle root that occupies a whole path segment, or -1. */
function findBundleRootIndex(path: string): number {
  let earliest = -1
  for (const root of FRAME_BUNDLE_ROOTS) {
    const needle = `${root}/`
    for (let from = 0; ; ) {
      const index = path.indexOf(needle, from)
      if (index === -1) break
      if (index === 0 || path[index - 1] === '/') {
        if (earliest === -1 || index < earliest) earliest = index
        break
      }
      from = index + 1
    }
  }
  return earliest
}

/**
 * Collapse a stack frame path to an install-independent `app:///` path.
 *
 * Frames carry the absolute location the app happens to run from — an installed
 * `.../AppData/Local/Programs/Chatbox/resources/app.asar/...`, a portable
 * `F:/AI/chatbox/...`, a translocated `/private/var/folders/<uuid>/d/Chatbox.app/...`,
 * or a `capacitor://localhost/` origin. Sentry derives both the issue fingerprint
 * and the release artifact lookup from that path, so an unnormalized frame splits
 * one defect across every install location and matches no uploaded source map.
 *
 * Only paths that resolve against a known app layout are rewritten: re-rooting a
 * remote script or an unrelated checkout would merge genuinely distinct frames.
 */
function normalizeFramePath(value: string): string {
  const origin = FRAME_ORIGIN_PATTERN.exec(value)
  let isAppRooted = false
  let path = value

  if (origin) {
    const [matched, protocol, host] = origin
    const isAppOrigin = APP_FRAME_PROTOCOLS.has(protocol.toLowerCase()) || LOCAL_HOST_PATTERN.test(host)
    if (!isAppOrigin) {
      return value
    }
    path = value.slice(matched.length)
    isAppRooted = true
  }

  path = path.replace(/[?#].*$/, '').replace(/\\/g, '/')
  const withoutDriveLetter = path.replace(FRAME_DRIVE_LETTER_PATTERN, '')
  const isAbsoluteFilePath = !isAppRooted && (withoutDriveLetter !== path || path.startsWith('/'))
  path = withoutDriveLetter
  if (!path.includes('/')) {
    return value
  }

  // macOS bundles capitalize `Contents/Resources`, Windows and Linux do not.
  const lowerCasePath = path.toLowerCase()
  for (const marker of FRAME_APP_ROOT_MARKERS) {
    const markerIndex = lowerCasePath.lastIndexOf(marker)
    if (markerIndex !== -1) {
      path = path.slice(markerIndex + marker.length)
      isAppRooted = true
      break
    }
  }

  path = resolveRelativeSegments(path)

  // The bundle-root fallback covers unpackaged runs, where no app bundle marker
  // exists. It must not re-root an unrelated absolute path that merely happens to
  // contain a `src/` or `dist/` segment.
  if (isAppRooted || !isAbsoluteFilePath) {
    const bundleRootIndex = findBundleRootIndex(path)
    if (bundleRootIndex !== -1) {
      path = path.slice(bundleRootIndex)
      isAppRooted = true
    }
  }

  return isAppRooted && path ? `${APP_FRAME_SCHEME}${path}` : value
}

/**
 * Keep `module` consistent with the normalized path so culprits stop varying per
 * install, in the `dir.dots:file` shape the Node SDK itself emits.
 */
function normalizeFrameModule(normalizedPath: string, fallback: string): string {
  if (!normalizedPath.startsWith(APP_FRAME_SCHEME)) {
    return fallback
  }
  const relativePath = normalizedPath.slice(APP_FRAME_SCHEME.length)
  const lastSeparator = relativePath.lastIndexOf('/')
  const file = relativePath.slice(lastSeparator + 1).replace(/\.[^.]+$/, '')
  if (lastSeparator === -1) {
    return file || fallback
  }
  const directory = relativePath.slice(0, lastSeparator).replace(/\//g, '.')
  return directory ? `${directory}:${file}` : file || fallback
}

function normalizeContextKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('_')
}

function isSensitiveContextKey(key: string): boolean {
  const normalizedKey = normalizeContextKey(key)
  return (
    PRIVATE_CONTEXT_KEYS.has(normalizedKey) ||
    CREDENTIAL_KEY_SUFFIXES.some((suffix) => normalizedKey === suffix || normalizedKey.endsWith(`_${suffix}`)) ||
    normalizedKey === 'key'
  )
}

function sanitizeValue(value: unknown, key: string, depth: number, seen: WeakSet<object>): unknown {
  if (isSensitiveContextKey(key)) {
    return '[redacted]'
  }
  if (typeof value === 'string') {
    return sanitizeText(value)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (depth >= MAX_SANITIZE_DEPTH) {
    return '[redacted]'
  }
  if (seen.has(value)) {
    return '[circular]'
  }

  seen.add(value)
  let sanitizedValue: unknown
  if (Array.isArray(value)) {
    sanitizedValue = value.map((item) => sanitizeValue(item, key, depth + 1, seen))
  } else {
    sanitizedValue = Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, childKey, depth + 1, seen),
      ])
    )
  }
  seen.delete(value)
  return sanitizedValue
}

function sanitizeRecord(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) {
    return record
  }

  const seen = new WeakSet<object>()
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, sanitizeValue(value, key, 0, seen)]))
}

function sanitizeEvent(event: SentryEventLike): void {
  event.user = undefined
  event.extra = sanitizeRecord(event.extra)
  event.contexts = sanitizeRecord(event.contexts)
  if (event.message !== undefined) {
    event.message = sanitizeText(event.message)
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) {
      exception.value = sanitizeText(exception.value)
    }
    for (const frame of exception.stacktrace?.frames ?? []) {
      let normalizedPath: string | undefined
      if (frame.filename !== undefined) {
        normalizedPath = normalizeFramePath(sanitizeText(frame.filename))
        frame.filename = normalizedPath
      }
      if (frame.abs_path !== undefined) {
        const normalizedAbsPath = normalizeFramePath(sanitizeText(frame.abs_path))
        frame.abs_path = normalizedAbsPath
        // `filename` is often a bare basename, so prefer whichever path resolved.
        if (!normalizedPath?.startsWith(APP_FRAME_SCHEME)) {
          normalizedPath = normalizedAbsPath
        }
      }
      if (frame.module !== undefined) {
        const sanitizedModule = sanitizeText(frame.module)
        frame.module = normalizedPath ? normalizeFrameModule(normalizedPath, sanitizedModule) : sanitizedModule
      }
    }
  }

  if (event.request) {
    event.request.data = undefined
    if (typeof event.request.url === 'string') {
      event.request.url = sanitizeUrl(event.request.url)
    } else if (event.request.url !== undefined) {
      event.request.url = sanitizeText(event.request.url)
    }
  }
  if (event.request?.headers) {
    for (const key of Object.keys(event.request.headers)) {
      if (isSensitiveContextKey(key)) {
        delete event.request.headers[key]
      }
    }
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    const sanitizedData = sanitizeRecord(breadcrumb.data)
    breadcrumb.data = sanitizedData
    if (breadcrumb.message !== undefined) {
      breadcrumb.message = sanitizeText(breadcrumb.message)
    }
    for (const key of URL_BREADCRUMB_KEYS) {
      const breadcrumbUrl = sanitizedData?.[key]
      if (sanitizedData && typeof breadcrumbUrl === 'string') {
        sanitizedData[key] = sanitizeUrl(breadcrumbUrl)
      }
    }
  }
}

export function createSentryEventProcessor(options: SentryEventProcessorOptions) {
  const seenExceptions = new WeakSet<object>()
  const random = options.random ?? Math.random

  return <T>(rawEvent: T, rawHint?: unknown): T | null => {
    try {
      const event = rawEvent as SentryEventLike
      const hint = rawHint as SentryEventHintLike | undefined

      if (shouldIgnoreEvent(event)) {
        return null
      }

      const originalException = hint?.originalException
      if (
        options.dedupeOriginalExceptions &&
        isWeakSetValue(originalException) &&
        seenExceptions.has(originalException)
      ) {
        return null
      }

      const tags = event.tags ?? {}
      const operation = inferOperation(event, tags)
      const priority = inferPriority(event, tags, operation)
      const sampleRate = priority === 'normal' ? options.normalSampleRate : 1

      if (sampleRate < 1 && random() >= sampleRate) {
        return null
      }

      event.tags = {
        ...tags,
        error_domain: inferDomain(tags),
        error_handled: String(inferHandled(event, tags)),
        error_operation: operation,
        error_priority: priority,
        error_sample_rate: String(sampleRate),
        error_source: options.source,
      }
      sanitizeEvent(event)

      if (options.dedupeOriginalExceptions && isWeakSetValue(originalException)) {
        seenExceptions.add(originalException)
      }

      return rawEvent
    } catch {
      // A malformed event must never break the app or bypass privacy filtering.
      return null
    }
  }
}
