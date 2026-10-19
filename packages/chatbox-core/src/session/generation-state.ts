import type { Message } from '../types'

type GenerationStateMessage = Pick<Message, 'id' | 'role' | 'generating'>

export function isCancellableGeneratingAssistantMessage(
  message: GenerationStateMessage,
  generationRuntimeActive: boolean
): boolean {
  return message.role === 'assistant' && message.generating === true && generationRuntimeActive
}

export function countCancellableGeneratingAssistantMessages(
  messages: GenerationStateMessage[],
  activeGenerationMessageIds: ReadonlySet<string>
): number {
  return messages.reduce(
    (count, message) =>
      count + Number(isCancellableGeneratingAssistantMessage(message, activeGenerationMessageIds.has(message.id))),
    0
  )
}
