import { estimateTokensForTokenizerType } from '@shared/token-estimation/tokenizer'
import type { TokenizerType } from './types'

export interface DraftTokenizationRequest {
  text: string
  tokenizerType: TokenizerType
}

/** Wire request: the id correlates responses on the shared persistent worker. */
export interface DraftTokenizationWorkerRequest extends DraftTokenizationRequest {
  id: number
}

export interface DraftTokenizationWorkerResponse {
  id: number
  tokens?: number
  error?: string
}

export function handleDraftTokenizationRequest(request: DraftTokenizationRequest): { tokens: number } {
  const { text, tokenizerType } = request
  const tokens = estimateTokensForTokenizerType(text, tokenizerType)
  if (text.length > 0 && tokens === 0) {
    throw new Error('Draft tokenizer returned no tokens for non-empty input')
  }
  return { tokens }
}
