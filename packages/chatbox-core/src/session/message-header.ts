import type { Message } from '../types'

/**
 * Name shown in bold on the chat's replies: the name set in the conversation settings, else the name of the saved
 * copilot the chat was started from. The chat title is not an assistant identity (it can be renamed or generated), so
 * a copilot without a saved definition gets no name. Undefined means the provider name is used.
 */
export function getSessionAssistantName(
  session: { assistantName?: string; copilotId?: string },
  copilots: readonly { id: string; name: string }[]
): string | undefined {
  const sessionName = session.assistantName?.trim()
  if (sessionName) return sessionName
  if (!session.copilotId) return undefined
  return copilots.find((copilot) => copilot.id === session.copilotId)?.name.trim() || undefined
}

export type AssistantMessageSource = {
  /** Provider display name, or undefined when the reply carries no provider information. */
  providerName?: string
  /** Raw model id, or the model label recorded in the display snapshot for replies that predate model ids. */
  modelLabel?: string
}

/**
 * Splits a `message.model` display snapshot of the form `Provider (model)` into its two parts. A snapshot without a
 * trailing parenthesised part is a name on its own.
 */
export function parseModelDisplaySnapshot(snapshot: string | undefined): AssistantMessageSource {
  const value = snapshot?.trim()
  if (!value) return {}
  const match = /^(.*\S)\s*\(([^()]+)\)$/s.exec(value)
  if (!match) return { providerName: value }
  return { providerName: match[1].trim(), modelLabel: match[2].trim() }
}

/**
 * Provider and model of an assistant reply. The provider comes from the stored provider name, then the display
 * snapshot, then the current name of the stored provider id; the model is the raw model id, then the snapshot label.
 */
export function getAssistantMessageSource(
  message: Pick<Message, 'aiProvider' | 'aiProviderName' | 'model' | 'modelId'>,
  lookupProviderName?: (providerId: string) => string | undefined
): AssistantMessageSource {
  const snapshot = parseModelDisplaySnapshot(message.model)
  const providerName =
    message.aiProviderName?.trim() ||
    snapshot.providerName ||
    (message.aiProvider ? lookupProviderName?.(message.aiProvider)?.trim() : undefined) ||
    undefined
  const modelLabel = message.modelId?.trim() || snapshot.modelLabel
  return { providerName, modelLabel }
}

export type AssistantMessageHeader = {
  /** Bold name: the copilot name, else the provider name, else the fallback label. */
  name: string
  /** Grey segments shown after the name, filtered by the display settings. */
  meta: { provider?: string; model?: string; time?: string }
  /** Every segment regardless of the display settings, joined with ` · `, for menus and hover text. */
  detail: string
}

export const MESSAGE_HEADER_SEPARATOR = ' · '

/**
 * Header of an assistant reply. Without a copilot the provider is the bold name and the grey part is
 * `model · time`; with a copilot the copilot is the bold name and the grey part is `provider · model · time`.
 */
export function getAssistantMessageHeader(
  source: AssistantMessageSource,
  options: {
    assistantName?: string
    fallbackLabel: string
    showModelName: boolean
    /** Formatted time of the reply, or undefined when it has no timestamp. */
    time?: string
    showTime: boolean
  }
): AssistantMessageHeader {
  const assistantName = options.assistantName?.trim() || undefined
  const provider = assistantName ? source.providerName : undefined
  const name = assistantName ?? source.providerName ?? options.fallbackLabel
  return {
    name,
    meta: {
      provider,
      model: options.showModelName ? source.modelLabel : undefined,
      time: options.showTime ? options.time : undefined,
    },
    detail: [provider, source.modelLabel, options.time].filter(Boolean).join(MESSAGE_HEADER_SEPARATOR),
  }
}
