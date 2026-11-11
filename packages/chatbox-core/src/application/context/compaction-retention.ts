import type { Message } from '../../types'
import type { CompactionBudget } from '../token-estimation/math'

export interface CompactionRetention {
  budget: CompactionBudget
  ratio: number
  requestOverheadTokens: number
  countTokens(messages: Message[]): Promise<number>
}

/** Select an older prefix to summarize, leaving a continuous, complete recent tail. */
export async function selectCompactionPrefix(
  messages: Message[],
  pendingMessage: Message | undefined,
  retention: CompactionRetention
): Promise<Message[]> {
  if (retention.ratio <= 0) return messages

  const { budget, countTokens } = retention
  const systemTokens = await countTokens(messages.filter((message) => message.role === 'system'))
  const pendingTokens = pendingMessage ? await countTokens([pendingMessage]) : 0
  const reservedTokens = retention.requestOverheadTokens + systemTokens + pendingTokens + budget.summaryAllowanceTokens
  const maxRetainedTokens = Math.max(0, budget.targetTokens - reservedTokens)
  const targetTokens = Math.min(Math.floor(budget.usableTokens * retention.ratio), maxRetainedTokens)
  if (targetTokens <= 0) return messages

  let start = messages.length
  let retainedTokens = 0
  while (start > 0 && retainedTokens < targetTokens) {
    let next = start - 1
    if (messages[next].role === 'system' || messages[next].isSummary) break

    // Current tool calls carry their results inside one message. Also keep
    // legacy standalone tool messages with the assistant that called them.
    while (next > 0 && messages[next].role === 'tool') next -= 1
    const group = messages.slice(next, start)
    if (group.some((message) => message.role === 'system' || message.isSummary)) break
    if (group.some((message) => message.role === 'tool') && messages[next].role !== 'assistant') break
    const groupTokens = await countTokens(group)
    // Crossing the ratio target is fine at a whole-message boundary, but the
    // space reserved for the summary and next request must still fit.
    if (retainedTokens + groupTokens > maxRetainedTokens) break
    retainedTokens += groupTokens
    start = next
  }
  return messages.slice(0, start)
}
