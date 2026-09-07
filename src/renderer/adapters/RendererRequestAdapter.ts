import type { ApiRequestOptions, RequestAdapter } from '@shared/types/adapters'

export interface RendererApiRequestClient {
  post(
    url: string,
    headers: Record<string, string>,
    body: RequestInit['body'] | undefined,
    options: { signal?: AbortSignal; retry?: number; useProxy?: boolean }
  ): Promise<Response>
  get(
    url: string,
    headers: Record<string, string>,
    options: { signal?: AbortSignal; retry?: number; useProxy?: boolean }
  ): Promise<Response>
}

/**
 * Preserves both request paths used by model implementations:
 * ordinary fetch-with-retry and the platform-aware API request path.
 */
export class RendererRequestAdapter implements RequestAdapter {
  constructor(
    private readonly fetchWithOptionsImpl: RequestAdapter['fetchWithOptions'],
    private readonly apiRequestClient: RendererApiRequestClient
  ) {}

  fetchWithOptions(
    url: string,
    init?: RequestInit,
    options?: { retry?: number; parseChatboxRemoteError?: boolean }
  ): Promise<Response> {
    return this.fetchWithOptionsImpl(url, init, options)
  }

  apiRequest(options: ApiRequestOptions): Promise<Response> {
    if (options.method === 'POST') {
      return this.apiRequestClient.post(options.url, options.headers || {}, options.body, {
        signal: options.signal,
        retry: options.retry,
        useProxy: options.useProxy,
      })
    }
    return this.apiRequestClient.get(options.url, options.headers || {}, {
      signal: options.signal,
      retry: options.retry,
      useProxy: options.useProxy,
    })
  }
}
