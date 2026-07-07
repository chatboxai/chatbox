import { ApiError, BaseError, NetworkError } from '../../shared/models/errors'

interface RequestOptions {
  method: string
  headers?: RequestInit['headers']
  body?: RequestInit['body']
  signal?: AbortSignal
  retry?: number
  useProxy?: boolean
}

async function retryRequest<T>(fn: () => Promise<T>, retry: number, url: string): Promise<T> {
  let requestError: BaseError | null = null

  for (let i = 0; i <= retry; i++) {
    try {
      return await fn()
    } catch (e) {
      // 对 ApiError（通常代表 4xx/业务错误）不重试
      if (e instanceof ApiError) {
        throw e
      }
      let origin = 'unknown'
      try {
        origin = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').origin
      } catch {}
      requestError = e instanceof BaseError ? e : new NetworkError((e as Error).message, origin)

      if (i < retry) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  throw requestError || new Error('Unknown error')
}

function buildHeaders(options: RequestOptions, _url: string): Headers {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')

  return headers
}

async function doRequest(url: string, options: RequestOptions): Promise<Response> {
  const { signal, retry = 3, body, method } = options
  const headers = buildHeaders(options, url)

  const makeRequest = async () => {
    const res = await fetch(url, { method, headers, body, signal })
    if (!res.ok) {
      const err = await res.text().catch(() => null)
      throw new ApiError(`Status Code ${res.status}`, err ?? undefined)
    }
    return res
  }

  return retryRequest(makeRequest, retry, url)
}

export const apiRequest = {
  async post(
    url: string,
    headers: Record<string, string>,
    body: RequestInit['body'],
    options?: Partial<RequestOptions>
  ) {
    return doRequest(url, { ...options, method: 'POST', headers, body })
  },

  async get(url: string, headers: Record<string, string>, options?: Partial<RequestOptions>) {
    return doRequest(url, { ...options, method: 'GET', headers })
  },
}

export async function fetchWithProxy(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return doRequest(input.toString(), {
    method: init?.method || 'GET',
    headers: init?.headers,
    body: init?.body,
    signal: init?.signal || undefined,
    useProxy: true,
  })
}
