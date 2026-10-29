import { analyzeAttachmentTokens } from '@shared/token-estimation/attachments'
import { estimateMessageToolCallTokens } from '@shared/context/tool-tokens'
import type { Message } from '@shared/types/session'
import { estimateDraftTokensImmediately, getDraftTokenizationText } from './draft-tokenization'
import type { ComputationTask, TokenBreakdown, TokenizerType } from './types'

export interface PartialAnalysisResult {
  breakdown: TokenBreakdown
  pendingTasks: Omit<ComputationTask, 'id' | 'createdAt' | 'sessionId'>[]
  hasApproximateText: boolean
}

/** Draft text and attachments are computed independently of persisted row history. */
export function analyzeCurrentInputTokens(options: {
  constructedMessage: Message | undefined
  tokenizerType: TokenizerType
  modelSupportToolUseForFile: boolean
  sandboxMode?: boolean
  currentInputTextTokens?: number
}): PartialAnalysisResult {
  const { constructedMessage: message, tokenizerType, currentInputTextTokens, ...policy } = options
  if (!message)
    return { breakdown: { text: 0, attachments: 0, toolCalls: 0 }, pendingTasks: [], hasApproximateText: false }
  const attachments = analyzeAttachmentTokens(message, tokenizerType, policy)
  return {
    breakdown: {
      text: currentInputTextTokens ?? estimateDraftTokensImmediately(getDraftTokenizationText(message), tokenizerType),
      attachments: attachments.tokens,
      toolCalls: estimateMessageToolCallTokens(message),
    },
    pendingTasks: attachments.missing.map(({ attachment, attachmentType, contentMode }) => ({
      type: 'attachment',
      messageId: message.id,
      attachmentId: attachment.id,
      attachmentType,
      tokenizerType,
      contentMode,
      priority: 1,
    })),
    hasApproximateText: message.contentParts.some((part) => part.type === 'image'),
  }
}
