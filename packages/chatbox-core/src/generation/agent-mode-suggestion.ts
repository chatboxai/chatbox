import type { Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'

export const AGENT_MODE_SUGGESTION_PROMPT = `Decide whether this first user message should be answered in Agent Mode.

Agent Mode is useful when the assistant should run code, inspect or create files, use local tools, query a knowledge base, load skills, or perform multi-step tool work. It is not needed for ordinary Q&A, writing, translation, brainstorming, explanation, simple advice, or web search.
If the user only needs online search or current information, do not suggest Agent Mode.
If the conversation is roleplay, character simulation, creative writing in-character, or uses attached documents as roleplay/world/character settings rather than files to process, do not suggest Agent Mode.
When suggest is true, write the reason in the same language as the user's message.

Return only JSON in this exact shape:
{"suggest":true,"reason":"short user-facing reason"}
or
{"suggest":false,"reason":""}`

export interface AgentModeSuggestionDecision {
  suggest: boolean
  reason?: string
}

/** True when exactly one user message exists in the prompt prefix (the first user turn). */
export function isFirstUserTurn(messages: Message[], targetMsgIx: number): boolean {
  const promptMessages = messages.slice(0, targetMsgIx)
  return promptMessages.filter((message) => message.role === 'user').length === 1
}

export function getLastUserMessage(messages: Message[], targetMsgIx: number): Message | undefined {
  for (let index = targetMsgIx - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') {
      return message
    }
  }
  return undefined
}

export function describeUserMessageForAgentModeDecision(message: Message): string {
  const text = getMessageText(message, true, false).trim()
  const files = message.files?.map((file) => `- ${file.name}${file.fileType ? ` (${file.fileType})` : ''}`) ?? []
  const links = message.links?.map((link) => `- ${link.url}`) ?? []
  return [
    `User message:\n${text || '(empty)'}`,
    files.length > 0 ? `Attached files:\n${files.join('\n')}` : '',
    links.length > 0 ? `Attached links:\n${links.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Parse the classifier model's reply into a decision. The model is asked to return
 * JSON, but may wrap it in prose or markdown fences, so we extract the first JSON
 * object and validate its shape. Returns null when no valid decision can be parsed.
 */
export function parseAgentModeSuggestionDecision(text: string): AgentModeSuggestionDecision | null {
  const jsonText = text.trim().match(/\{[\s\S]*\}/)?.[0]
  if (!jsonText) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(jsonText)
    if (!parsed || typeof parsed !== 'object' || !('suggest' in parsed)) {
      return null
    }
    const record = parsed as Record<string, unknown>
    if (typeof record.suggest !== 'boolean') {
      return null
    }
    return {
      suggest: record.suggest,
      reason: typeof record.reason === 'string' ? record.reason : undefined,
    }
  } catch {
    return null
  }
}
