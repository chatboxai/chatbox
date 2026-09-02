import type { AgentModeValue, Session } from '../types'

/**
 * Static capability policy for the chat/work mode split (see
 * docs/technical/chat-work-mode-split.md).
 *
 * Deliberately separate from `action-gates.ts`, which models *transient* locks
 * (streaming replies, compaction, pending approval) that hosts present as
 * "disabled + why" notices. Mode policy models *static* availability — an
 * action a mode simply does not offer — and hosts present it by hiding the
 * entry point. The one action needing both dimensions (switching forks while
 * replies stream) stays in action-gates, keyed by `SessionActionContext.sessionMode`.
 *
 * This policy is a client-side UX constraint, not a data invariant: older
 * clients and sync peers do not enforce it, so storage/domain logic must never
 * assume work-mode messages are immutable.
 */

export type SessionMode = 'chat' | 'work'

export type ModePolicyAction =
  /** Reply Again Below on user/system messages (flat alternative replies). */
  | 'reply-below'
  /** Open the editor for an assistant message. */
  | 'edit-assistant-message'
  /** Delete a single message. */
  | 'delete-message'
  /** Delete a saved fork branch (removes its messages). */
  | 'delete-fork'
  /** The editor's plain Save — editing without resending. */
  | 'save-message-edit'
  /** The conversation's own system prompt: shown in the transcript, edited in conversation settings. */
  | 'session-system-prompt'
  /** Queue a message while a reply streams. */
  | 'queue-message'
  /** Jump the queue and steer an item into the running generation. */
  | 'steer-queued-message'
  /** Archive the current conversation and start a new thread. */
  | 'create-thread'
  /** Open or navigate Thread History (toolbar, drawer, in-transcript labels). */
  | 'thread-history'

/**
 * `'on'` is Work Mode; `'off'`, `'auto'` and unset are Chat Mode ('auto' only
 * arms the first-turn suggestion classifier — capabilities stay chat-level
 * until the user accepts the upgrade, see agentModeState.ts).
 *
 * Policy follows the session data, not platform capability: a work-mode
 * session synced to mobile keeps its restrictions even though the agent
 * cannot run there.
 */
export function resolveSessionMode(agentModeValue: AgentModeValue | undefined): SessionMode {
  return agentModeValue === 'on' ? 'work' : 'chat'
}

const WORK_MODE_UNAVAILABLE: ReadonlySet<ModePolicyAction> = new Set([
  'reply-below',
  'edit-assistant-message',
  'delete-fork',
  'save-message-edit',
  'session-system-prompt',
  'create-thread',
  'thread-history',
])

const CHAT_MODE_UNAVAILABLE: ReadonlySet<ModePolicyAction> = new Set(['queue-message', 'steer-queued-message'])

export function isActionAvailableInMode(action: ModePolicyAction, mode: SessionMode): boolean {
  return !(mode === 'work' ? WORK_MODE_UNAVAILABLE : CHAT_MODE_UNAVAILABLE).has(action)
}

/**
 * Work Mode does not create or expose an empty Thread History surface.
 * Sessions with archived threads keep their stored conversation boundaries
 * visible so the transcript does not present separate topics as one
 * continuous exchange.
 */
export function isThreadHistoryAvailable(session: Pick<Session, 'threads'>, mode: SessionMode): boolean {
  return isActionAvailableInMode('thread-history', mode) || Boolean(session.threads?.length)
}

/**
 * Whether the session has left the "brand new chat" state that still allows
 * manual cross-mode switching. Threads are checked too: clearing context
 * archives the exchanged messages into a thread while `messages` resets.
 */
export function hasConversationStarted(session: Pick<Session, 'messages' | 'threads'>): boolean {
  if (session.messages.some((message) => message.role === 'user')) {
    return true
  }
  return session.threads?.some((thread) => thread.messages.some((message) => message.role === 'user')) ?? false
}
