import { prepareContextMessages } from '@shared/context'
import type { Message, Session, SessionSettings } from '@shared/types'

/** Select the send window the summarizer covers. */
export function getCompactionContext(
  session: Session,
  sessionSettings: SessionSettings,
  pendingMessage?: Message
): Message[] {
  // Reserve the same current-input slot used by normal sends. The pending turn
  // participates in window selection but is not replaced by the summary.
  const currentInput: Message = pendingMessage ?? { id: 'compaction-current-input', role: 'user', contentParts: [] }
  return prepareContextMessages([...session.messages, currentInput], {
    compactionPoints: session.compactionPoints,
    maxContextMessageCount: sessionSettings.maxContextMessageCount,
  }).filter((message) => message.id !== currentInput.id)
}
