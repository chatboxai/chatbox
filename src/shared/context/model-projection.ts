import type { Message } from '../types'
import {
  buildCompactionHandoff,
  type CompactionHandoffMode,
  getCompactionHandoffMode,
  getContextHistoryStartNote,
} from './compaction-handoff'

export interface ContextProjectionOptions {
  /** App language code (`Settings['language']`) for the wording the projection adds. */
  language?: string
  /** `summarize` frames an earlier summary as plain history for a new summary. */
  purpose?: 'send' | 'summarize'
}

/** The row facts the projection depends on; message bodies are not needed to plan it. */
export type ContextProjectionEntry = Pick<Message, 'role' | 'isSummary'>

export const CONTEXT_HISTORY_START_MESSAGE_ID = 'context-history-start'

interface ContextProjectionPlan {
  /** Handoff mode for each summary, keyed by its index in the selection. */
  handoffs: Map<number, CompactionHandoffMode>
  /** Whether a user note must open a window whose first conversation turn is not a user turn. */
  historyStart: boolean
}

function planContextProjection(
  selection: readonly ContextProjectionEntry[],
  purpose: NonNullable<ContextProjectionOptions['purpose']>
): ContextProjectionPlan {
  const handoffs = new Map<number, CompactionHandoffMode>()
  selection.forEach((entry, index) => {
    if (!entry.isSummary) return
    handoffs.set(index, purpose === 'summarize' ? 'history' : getCompactionHandoffMode(selection[index + 1]?.role))
  })
  // A summary is always sent as a user turn, so only a leading assistant/tool
  // turn needs the note. Chat templates may drop or reject assistant/tool turns
  // before the first user turn, e.g. after the message-count limit trims the window.
  const first = selection.find((entry) => entry.role !== 'system')
  return { handoffs, historyStart: first !== undefined && !first.isSummary && first.role !== 'user' }
}

function withModelContent(message: Message, role: Message['role'], contentParts: Message['contentParts']): Message {
  // Cached counts describe the stored content, not the projected one.
  return {
    ...message,
    role,
    contentParts,
    tokenCountMap: undefined,
    tokenCountApproximate: undefined,
    tokenCalculatedAt: undefined,
  }
}

/**
 * The model-facing form of a context selection: a compaction summary is sent
 * as user context framed by its handoff wording, and the first non-system
 * message is always a user turn. Stored messages are not modified.
 */
export function projectContextMessagesForModel(
  selection: Message[],
  options: ContextProjectionOptions = {}
): Message[] {
  const { language, purpose = 'send' } = options
  const plan = planContextProjection(selection, purpose)
  const messages: Message[] = []

  for (let index = 0; index < selection.length; index += 1) {
    const message = selection[index]
    const mode = plan.handoffs.get(index)
    if (mode === undefined) {
      messages.push(message)
      continue
    }
    const next = selection[index + 1]
    const summary = message.contentParts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
    const { text } = buildCompactionHandoff(summary, mode, language)
    if (next?.role === 'user') {
      // One user turn: the summary leads the user message that follows it.
      messages.push(withModelContent(next, 'user', [{ type: 'text', text }, ...next.contentParts]))
      index += 1
    } else {
      messages.push(withModelContent(message, 'user', [{ type: 'text', text }]))
    }
  }

  if (plan.historyStart) {
    messages.splice(
      messages.findIndex((message) => message.role !== 'system'),
      0,
      {
        id: CONTEXT_HISTORY_START_MESSAGE_ID,
        role: 'user',
        contentParts: [{ type: 'text', text: getContextHistoryStartNote(language) }],
      }
    )
  }

  return messages
}

/**
 * The wording {@link projectContextMessagesForModel} adds to the same
 * selection, for estimators that count the selected messages themselves.
 * Only row facts are read, so a token plan can supply them without bodies.
 */
export function getContextProjectionText(
  selection: readonly ContextProjectionEntry[],
  options: ContextProjectionOptions = {}
): string {
  const { language, purpose = 'send' } = options
  const plan = planContextProjection(selection, purpose)
  const added = [...plan.handoffs.values()].map((mode) => buildCompactionHandoff('', mode, language).instruction)
  if (plan.historyStart) added.push(getContextHistoryStartNote(language))
  return added.join('\n\n')
}
