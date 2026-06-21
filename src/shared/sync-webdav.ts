export const SYNC_COLLECTION_PATH = 'ChatboxSync/v1/'
export const SYNC_SNAPSHOT_PATH = `${SYNC_COLLECTION_PATH}snapshot.json.enc`

export type WebDAVMethod = 'GET' | 'PUT' | 'MKCOL' | 'PROPFIND' | 'DELETE'

export type WebDAVRequest = {
  url: string
  method: WebDAVMethod
  headers?: Record<string, string>
  body?: string
}

export type WebDAVResponse = {
  status: number
  headers: Record<string, string>
  body: string
}

type WebDAVFetch = (
  input: string | URL,
  init: {
    method: WebDAVMethod
    headers?: Record<string, string>
    body?: string
    redirect: 'error'
  }
) => Promise<Response>

const ALLOWED_WEBDAV_TARGETS = new Map<string, Set<WebDAVMethod>>([
  ['ChatboxSync/', new Set(['MKCOL'])],
  [SYNC_COLLECTION_PATH, new Set(['MKCOL'])],
  [SYNC_SNAPSHOT_PATH, new Set(['GET', 'PUT', 'PROPFIND'])],
])
const ALLOWED_WEBDAV_HEADERS = new Set(['authorization', 'content-type', 'depth'])
const REDIRECT_STATUS_MIN = 300
const REDIRECT_STATUS_MAX = 399

function rejectWebDAVRequest(): never {
  throw new Error('WebDAV request target is not allowed')
}

export function joinWebDAVUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function normalizeRelativePath(pathname: string): string {
  return pathname.replace(/^\/+/, '')
}

export function validateWebDAVRequestTarget(baseUrl: string, request: WebDAVRequest): void {
  if (typeof baseUrl !== 'string' || typeof request !== 'object' || request === null || Array.isArray(request)) {
    rejectWebDAVRequest()
  }
  if (typeof request.url !== 'string' || typeof request.method !== 'string') {
    rejectWebDAVRequest()
  }
  if (request.headers !== undefined && (typeof request.headers !== 'object' || request.headers === null || Array.isArray(request.headers))) {
    rejectWebDAVRequest()
  }
  if (request.body !== undefined && typeof request.body !== 'string') {
    rejectWebDAVRequest()
  }

  const base = new URL(baseUrl)
  const url = new URL(request.url)
  if (base.protocol !== 'https:' || url.protocol !== 'https:') {
    throw new Error('WebDAV URL must use HTTPS')
  }
  if (base.search || base.hash) {
    rejectWebDAVRequest()
  }
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
  if (url.origin !== base.origin || !url.pathname.startsWith(basePath)) {
    rejectWebDAVRequest()
  }
  if (url.search || url.hash) {
    rejectWebDAVRequest()
  }

  const relativePath = normalizeRelativePath(url.pathname.slice(basePath.length))
  const allowedMethods = ALLOWED_WEBDAV_TARGETS.get(relativePath)
  if (!allowedMethods?.has(request.method)) {
    rejectWebDAVRequest()
  }
  for (const [headerName, headerValue] of Object.entries(request.headers ?? {})) {
    if (typeof headerValue !== 'string') {
      rejectWebDAVRequest()
    }
    if (!ALLOWED_WEBDAV_HEADERS.has(headerName.toLowerCase())) {
      rejectWebDAVRequest()
    }
  }
  if (request.body !== undefined && request.method !== 'PUT') {
    rejectWebDAVRequest()
  }
}

export async function executeWebDAVRequest(
  baseUrl: string,
  request: WebDAVRequest,
  fetchImpl: WebDAVFetch
): Promise<WebDAVResponse> {
  validateWebDAVRequestTarget(baseUrl, request)
  const response = await fetchImpl(new URL(request.url), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'error',
  })
  if (response.status >= REDIRECT_STATUS_MIN && response.status <= REDIRECT_STATUS_MAX) {
    throw new Error('WebDAV redirects are not allowed')
  }
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  return {
    status: response.status,
    headers,
    body: await response.text(),
  }
}
