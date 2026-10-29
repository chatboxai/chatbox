import type { SessionMode } from '../session/mode-policy'
import type { PromptCacheDeleteTarget } from '../session/prompt-cache-policy'
export interface SessionPromptCacheRequest {
  sessionId: string
  mode: SessionMode
  maxContextMessageCount?: number
  deletion?: { messageId: string; target: PromptCacheDeleteTarget }
}
export interface SessionPromptCacheRepositoryPort {
  readSessionPromptCacheDecision(request: SessionPromptCacheRequest): Promise<boolean>
}
