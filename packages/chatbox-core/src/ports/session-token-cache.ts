import type { SessionRowCommit } from './session-row-store'

export const SESSION_TOKEN_CACHE_VERSION = 'history-breakdown-v1'
export const SESSION_TOKEN_PAGE_MESSAGES = 100
export const SESSION_TOKEN_PAGE_BYTES = 2 * 1024 * 1024

/** Numerical projection of one immutable message payload and attachment policy. */
export interface SessionTokenCachedValue {
  text: number
  attachments: number
  toolCalls: number
  approximate: boolean
}
export interface SessionTokenCacheIdentity {
  sessionId: string
  messageId: string
  payloadId: string
  payloadBytes: number
}
export interface SessionTokenCacheEntry extends SessionTokenCacheIdentity {
  value?: SessionTokenCachedValue
}
export interface SessionTokenCacheRequest {
  sessionId: string
  messageIds: readonly string[]
  cacheKey: string
  expectedRevision: number
}
export interface SessionTokenCacheResult {
  identity: SessionTokenCacheIdentity
  cacheKey: string
  value: SessionTokenCachedValue
}
export interface SessionTokenCacheStorePort {
  readTokenCache(
    request: SessionTokenCacheRequest
  ): Promise<(SessionRowCommit & { entries: SessionTokenCacheEntry[] }) | null>
  acceptTokenCache(results: readonly SessionTokenCacheResult[]): Promise<void>
}
export function validateTokenCacheRequest(request: SessionTokenCacheRequest): void {
  if (
    !request.sessionId ||
    new TextEncoder().encode(request.sessionId).length > 1024 ||
    request.messageIds.length > SESSION_TOKEN_PAGE_MESSAGES ||
    request.messageIds.some((id) => !id || new TextEncoder().encode(id).length > 1024) ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 1 ||
    !validTokenCacheKey(request.cacheKey)
  )
    throw new Error('Invalid token cache selection')
}
export function validTokenCacheKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith(`${SESSION_TOKEN_CACHE_VERSION}:`) && key.length <= 200
}
export function validTokenCachedValue(value: SessionTokenCachedValue): boolean {
  return (
    typeof value.approximate === 'boolean' &&
    [value.text, value.attachments, value.toolCalls].every(
      (count) => Number.isFinite(count) && count >= 0 && count <= Number.MAX_SAFE_INTEGER
    )
  )
}
export function validTokenCacheResult(result: SessionTokenCacheResult): boolean {
  return (
    validTokenCacheKey(result.cacheKey) &&
    validTokenCachedValue(result.value) &&
    [result.identity.sessionId, result.identity.messageId, result.identity.payloadId].every(
      (id) => typeof id === 'string' && id.length > 0
    ) &&
    Number.isSafeInteger(result.identity.payloadBytes) &&
    result.identity.payloadBytes >= 0
  )
}
