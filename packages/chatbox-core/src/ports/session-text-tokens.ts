import type { SessionMessageTextDerivedPatch } from '../application/session/message-derived-data'

/** Canonical text projection plus the tokenizer implementations shipped together. */
export const SESSION_TEXT_TOKEN_VERSION = 'message-text-cl100k-deepseek-v1'

/** Issued alongside a completely decoded committed payload, never persisted on Message. */
export interface SessionTextTokenSource {
  readonly sessionId: string
  readonly messageId: string
  readonly payloadId: string
  readonly calculationVersion: typeof SESSION_TEXT_TOKEN_VERSION
  readonly textDigest: string
  readonly text: string
}

export interface SessionTextTokenResult {
  readonly source: SessionTextTokenSource
  readonly value: SessionMessageTextDerivedPatch
}

export interface SessionTextTokenRead {
  readonly sources: Readonly<Record<string, SessionTextTokenSource>>
  readonly results: readonly SessionTextTokenResult[]
}

export interface SessionTextTokenWriteResult {
  sessionId: string
  results: SessionTextTokenResult[]
}

export interface SessionTextTokenRepositoryPort {
  acceptSessionTextTokenResults(
    sessionId: string,
    results: readonly SessionTextTokenResult[]
  ): Promise<SessionTextTokenWriteResult>
}

export interface SessionTextTokenStorePort {
  readTextTokenResults(sources: readonly SessionTextTokenSource[]): Promise<SessionTextTokenResult[]>
  acceptTextTokenResults(results: readonly SessionTextTokenResult[]): Promise<SessionTextTokenResult[]>
}
