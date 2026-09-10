import type { Message } from '@shared/types'
import { isSuccessfulAssistantReply } from '@/stores/session'

function isPositiveTokenCount(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}

export interface MessageTokenDisplay {
  totalTokens: number
  cachedInputTokens?: number
}

export function getMessageTokenDisplay(message: Message): MessageTokenDisplay | null {
  if (!isSuccessfulAssistantReply(message)) return null

  // A provider-reported total is only presented as consumed after the stream
  // recorded an explicit completion signal. This keeps partial/canceled streams
  // and local estimates from looking like confirmed billing.
  const totalTokens = message.usage?.totalTokens
  if (message.finishReason && isPositiveTokenCount(totalTokens)) {
    const cachedInputTokens = message.usage?.cachedInputTokens
    return {
      totalTokens,
      ...(isPositiveTokenCount(cachedInputTokens) ? { cachedInputTokens } : {}),
    }
  }

  return null
}
