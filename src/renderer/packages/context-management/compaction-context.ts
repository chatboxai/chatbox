import { prepareContextMessages } from '@shared/context'
import type { Message, Session, SessionSettings, Settings } from '@shared/types'
import { assessContextPressure, getConfiguredContextWindow } from './context-pressure'

/** Select the send window and apply its pressure-driven tool-result cleanup. */
export function getCompactionContext(
  session: Session,
  sessionSettings: SessionSettings,
  globalSettings: Settings,
  pendingMessage?: Message,
  sandboxMode = false
): Message[] {
  // Reserve the same current-input slot used by normal sends. The pending turn
  // participates in pressure estimation but is not replaced by the summary.
  const currentInput: Message = pendingMessage ?? { id: 'compaction-current-input', role: 'user', contentParts: [] }
  const providerId = sessionSettings.provider ?? globalSettings.defaultChatModel?.provider
  const modelId = sessionSettings.modelId ?? globalSettings.defaultChatModel?.model
  return prepareContextMessages([...session.messages, currentInput], {
    compactionPoints: session.compactionPoints,
    maxContextMessageCount: sessionSettings.maxContextMessageCount,
    toolCleanupMode: (contextMessages) =>
      assessContextPressure({
        contextMessages,
        sandboxMode,
        providerId,
        modelId,
        contextWindow: getConfiguredContextWindow(globalSettings, providerId, modelId),
        compactionThreshold: globalSettings.compactionThreshold,
      }).toolCleanupMode,
  }).filter((message) => message.id !== currentInput.id)
}
