import type { Message } from '../../types'

/** A process cannot resume a provider stream persisted before it started. */
export function recoverInterruptedMessage(message: Message, bootTime: number, now: number): Message | null | undefined {
  if (!message.generating || (message.timestamp !== undefined && message.timestamp >= bootTime)) return undefined
  const legacyRequests = (message as Message & { generationRequests?: readonly unknown[] }).generationRequests
  if (
    message.role === 'assistant' &&
    !message.files?.length &&
    !message.links?.length &&
    message.error === undefined &&
    message.errorCode === undefined &&
    message.backgroundTask === undefined &&
    !legacyRequests?.length &&
    message.contentParts.every((part) => (part.type === 'text' || part.type === 'reasoning') && part.text.length === 0)
  )
    return null
  return {
    ...message,
    generating: false,
    contentParts: message.contentParts.map((part) =>
      part.type === 'tool-call' && part.state === 'call'
        ? {
            ...part,
            state: 'error',
            pauseReason: undefined,
            resultStorageKey: undefined,
            resultImageStorageKey: undefined,
            resultImageMediaType: undefined,
            result: { error: 'Tool execution was interrupted before its result was persisted.' },
            duration: part.startTime ? now - part.startTime : undefined,
          }
        : part
    ),
  }
}
