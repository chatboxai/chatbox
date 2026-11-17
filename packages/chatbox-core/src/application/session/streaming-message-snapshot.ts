import type { Message } from '../../types/session'

export function snapshotStreamingMessage(message: Message): Message {
  return {
    ...message,
    contentParts: message.contentParts.map((part) => ({ ...part })),
    status: message.status?.map((status) => ({ ...status })),
  }
}
