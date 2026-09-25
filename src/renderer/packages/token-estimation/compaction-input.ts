import { selectTokenEstimationContext } from '@chatbox/core/application/token-estimation'
import type { AttachmentPolicy } from '@shared/context/attachments'
import type { Message, Session } from '@shared/types'
import { analyzeContextTokens, analyzeCurrentInputTokens } from './analyzer'
import { calculateAttachmentTokens } from './attachment-computation'
import { getTokenizerType } from './tokenizer'

/** Reuse source-bound counts for the upcoming send window; only missing attachments require I/O. */
export async function estimateCompactionInputTokens(
  session: Session,
  pendingMessage: Message | undefined,
  model: { provider: string; modelId: string } | undefined,
  maxContextMessageCount: number | undefined,
  policy: AttachmentPolicy
): Promise<number> {
  const history = selectTokenEstimationContext(session, maxContextMessageCount, pendingMessage)
  const tokenizerType = getTokenizerType(model)
  const options = {
    tokenizerType,
    modelSupportToolUseForFile: policy.modelSupportToolUseForFile ?? false,
    sandboxMode: policy.sandboxMode,
  }
  const context = analyzeContextTokens({ ...options, contextMessages: history, estimateMissingText: true })
  const draft = analyzeCurrentInputTokens({ ...options, constructedMessage: pendingMessage })
  let tokens = [context.breakdown, draft.breakdown].reduce(
    (total, value) => total + value.text + value.attachments + value.toolCalls,
    0
  )
  const messages = new Map(
    [...history, ...(pendingMessage ? [pendingMessage] : [])].map((message) => [message.id, message])
  )
  for (const task of [...context.pendingTasks, ...draft.pendingTasks]) {
    if (task.type !== 'attachment') continue
    const message = messages.get(task.messageId)
    const attachment = (task.attachmentType === 'file' ? message?.files : message?.links)?.find(
      (item) => item.id === task.attachmentId
    )
    if (!attachment) continue
    const result = await calculateAttachmentTokens(attachment, {
      ...task,
      id: 'compaction-attachment',
      sessionId: session.id,
      createdAt: Date.now(),
    })
    if (result.success && result.result) tokens += result.result.tokens
  }
  return tokens
}
