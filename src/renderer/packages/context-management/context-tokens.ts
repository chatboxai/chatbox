import type { Message, Settings } from '@shared/types'
import { useTokenEstimation } from '@/packages/token-estimation/hooks/useTokenEstimation'
import type { ExactDraftTokens } from '@/packages/token-estimation/types'

export interface UseContextTokensOptions {
  sessionId: string | null
  revision?: number
  enabled?: boolean
  settings: Partial<Settings>
  model?: { provider: string; modelId: string }
  modelSupportToolUseForFile: boolean
  sandboxMode?: boolean
  constructedMessage?: Message
}

export interface UseContextTokensResult {
  contextTokens: number
  messageCount: number
  currentInputTokens: number
  totalTokens: number
  isCalculating: boolean
  isDraftCalculating: boolean
  isCurrentInputApproximate: boolean
  isTotalApproximate: boolean
  isContextApproximate: boolean
  isContextCalculating: boolean
  pendingTasks: number
  pendingContextMessages: number
  /** Exact worker count for the current draft, for seeding the outgoing message at submit. */
  exactDraftTokens: ExactDraftTokens | null
}

/** Independent row history is enabled only after the first transcript layout. */
export function useContextTokens(options: UseContextTokensOptions): UseContextTokensResult {
  const result = useTokenEstimation({
    ...options,
    constructedMessage: options.constructedMessage,
    maxContextMessageCount: options.settings.maxContextMessageCount,
  })
  return { ...result, messageCount: result.contextMessageCount }
}
