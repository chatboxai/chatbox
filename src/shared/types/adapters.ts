import type { SentryAdapter } from '../utils/sentry_adapter'
import type { OAuthCredentials } from '../oauth/types'

/** Minimal cross-host shape used when a signal is only forwarded or inspected. */
export interface AbortSignalLike {
  readonly aborted: boolean
}

export interface ApiRequestOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: RequestInit['body']
  useProxy?: boolean
  signal?: AbortSignalLike
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
    options?: { retry?: number; parseChatboxRemoteError?: boolean }
  ): Promise<Response>
  apiRequest(options: ApiRequestOptions): Promise<Response>
}

export interface ModelDependencies {
  request: RequestAdapter
  storage: StorageAdapter
  sentry: SentryAdapter
  getRemoteConfig(): any
  oauth?: OAuthAdapter
  /** Current platform type, used for OAuth auth resolution */
  platformType?: 'desktop' | 'web' | 'mobile'
}
