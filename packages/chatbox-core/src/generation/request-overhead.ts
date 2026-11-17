import { getMessageText } from '@shared/utils/message'
import { asSchema, type ModelMessage, type ToolSet } from 'ai'
import type { RequestOverheadTokens } from '../application/context/CompactionService'
import type { Message } from '../types'
import { type CountTextTokens, estimateModelMessagesTokens } from './mid-run-compaction'

/** Tool definitions as a provider receives them: name, description and input JSON schema. */
export async function estimateToolDefinitionTokens(tools: ToolSet, countText: CountTextTokens): Promise<number> {
  let total = 0
  for (const [name, tool] of Object.entries(tools)) {
    const parameters = tool.inputSchema ? await asSchema(tool.inputSchema).jsonSchema : undefined
    total += countText(JSON.stringify({ name, description: tool.description, parameters }))
  }
  return total
}

/** Request tokens the conversation history does not account for. */
export async function estimateRequestOverheadTokens(options: {
  tools: ToolSet
  requestMessages: ModelMessage[]
  historyMessages: readonly Message[]
  countText: CountTextTokens
  countMessage(message: ModelMessage): number
}): Promise<RequestOverheadTokens> {
  const requestSystem = estimateModelMessagesTokens(
    options.requestMessages.filter((message) => message.role === 'system'),
    options.countMessage
  )
  const historySystem = options.historyMessages
    .filter((message) => message.role === 'system')
    .reduce((total, message) => total + options.countText(getMessageText(message, true, true)), 0)
  return {
    toolTokens: await estimateToolDefinitionTokens(options.tools, options.countText),
    extraSystemTokens: Math.max(0, requestSystem - historySystem),
  }
}
