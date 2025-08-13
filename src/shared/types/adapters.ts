import type { SentryAdapter } from '../utils/sentry_adapter'

export interface ApiRequestOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: RequestInit['body']
  useProxy?: boolean
  signal?: AbortSignal
  retry?: number
}

export interface StorageAdapter {
  saveImage(folder: string, dataUrl: string): Promise<string>
  getImage(storageKey: string): Promise<string>
}

export interface RequestAdapter {
  fetchWithOptions(
    url: string,
    init?: RequestInit,
    options?: { retry?: number; parseChatboxRemoteError?: boolean }
  ): Promise<Response>
  apiRequest(options: ApiRequestOptions): Promise<Response>
}

export interface ModelDependencies {
  request: RequestAdapter
  storage: StorageAdapter
  sentry: SentryAdapter
  getRemoteConfig(): any
} 