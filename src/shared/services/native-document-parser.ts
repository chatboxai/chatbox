import type { AbortSignalLike } from '../types/adapters'

type NativeFetchInit = NonNullable<Parameters<typeof fetch>[1]>
type NativeFetch = (input: string, init?: NativeFetchInit) => Promise<Response>

export interface NativeDocumentParserRequestOptions {
  apiOrigin?: string
  fetchFn?: NativeFetch
  headers?: Record<string, string>
  signal?: AbortSignalLike
}

export interface NativeDocumentParserFile {
  filename: string
  filetype: string
  upload(url: string): Promise<void>
}

const DEFAULT_API_ORIGIN = 'https://api.chatboxai.app'

function resolveOrigin(value: string | undefined): string {
  return (value?.trim() || DEFAULT_API_ORIGIN).replace(/\/+$/, '')
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = payload.error
    if (typeof error === 'string' && error.trim()) return error
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return error.message
    }
  }
  return `Document parser request failed with status ${status}`
}

async function requestData(
  path: string,
  licenseKey: string,
  body: Record<string, unknown>,
  options: NativeDocumentParserRequestOptions
): Promise<Record<string, unknown>> {
  const response = await (options.fetchFn ?? fetch)(`${resolveOrigin(options.apiOrigin)}${path}`, {
    method: 'POST',
    headers: {
      Authorization: licenseKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(body),
    signal: options.signal as NativeFetchInit['signal'],
  } as NativeFetchInit)
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) throw new Error(errorMessage(payload, response.status))
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    throw new Error('Document parser response was not understood')
  }
  const data = payload.data
  if (!data || typeof data !== 'object') throw new Error('Document parser response was not understood')
  return data as Record<string, unknown>
}

/**
 * Native-safe equivalent of the renderer's uploadAndCreateUserFile flow.
 *
 * The host owns the binary PUT so React Native can use its native file upload
 * primitive without copying an Office/PDF payload through fetch or navigation
 * state. JSON API calls remain injectable for native networking and tests.
 */
export async function parseNativeChatboxAIDocument(
  licenseKey: string,
  file: NativeDocumentParserFile,
  options: NativeDocumentParserRequestOptions = {}
): Promise<string> {
  const upload = await requestData(
    '/api/files/generate-upload-url',
    licenseKey,
    { licenseKey, filename: file.filename },
    options
  )
  if (typeof upload.url !== 'string' || typeof upload.filename !== 'string') {
    throw new Error('Document upload response was not understood')
  }

  await file.upload(upload.url)

  const parsed = await requestData(
    '/api/files/create',
    licenseKey,
    {
      licenseKey,
      filename: upload.filename,
      filetype: file.filetype,
      returnContent: true,
    },
    options
  )
  if (typeof parsed.content !== 'string') throw new Error('Document parser response did not contain content')
  return parsed.content
}
