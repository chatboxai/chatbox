import type { OAuthCredentials } from '../oauth/types'

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

export interface OAuthAdapter {
  refreshCredential(providerId: string, credential: OAuthCredentials): Promise<OAuthCredentials>
  persistCredential(providerId: string, credential: OAuthCredentials): void
  clearCredential(providerId: string): void
}

export interface RequestAdapter {
  fetchWithOptions(
    url: string,
    init?: RequestInit,
    options?: { retry?: number; parseWorkspAIceRemoteError?: boolean }
  ): Promise<Response>
  apiRequest(options: ApiRequestOptions): Promise<Response>
}

export interface ModelDependencies {
  request: RequestAdapter
  storage: StorageAdapter
  oauth?: OAuthAdapter
  /** Current platform type, used for OAuth auth resolution */
  platformType?: 'desktop' | 'web' | 'mobile'
}
