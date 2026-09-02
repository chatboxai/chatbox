import type { Message, MessageToolCallPart } from './types'

// Single source of truth for "this tool call is paused waiting for user approval".
// Everything that reacts to a pending approval (input locking, the floating pill,
// orchestration resume batches, the approval card UI) must route through this module
// so a new approval pause type only ever needs to be added here.

export type ApprovalPauseReason = Extract<
  NonNullable<MessageToolCallPart['pauseReason']>,
  { type: 'user_exec_approval' | 'command_escalation_approval' | 'file_mutation_approval' | 'app_action_approval' }
>

export type PendingApprovalToolCall = {
  messageId: string
  toolCallId: string
  pauseReason: ApprovalPauseReason
}

export function isApprovalPauseReason(
  pauseReason: MessageToolCallPart['pauseReason']
): pauseReason is ApprovalPauseReason {
  return (
    pauseReason?.type === 'user_exec_approval' ||
    pauseReason?.type === 'command_escalation_approval' ||
    pauseReason?.type === 'file_mutation_approval' ||
    pauseReason?.type === 'app_action_approval'
  )
}

type ApprovalScanMessage = Pick<Message, 'id' | 'contentParts'>

// The message list identity changes on every streaming chunk and several consumers
// (input box, floating pill) scan it in the same render pass — cache per array
// identity so the walk happens once per update.
const pendingApprovalsCache = new WeakMap<object, PendingApprovalToolCall[]>()

/** All tool calls currently paused waiting for user approval, in message order. */
export function listPendingApprovalToolCalls(messages: ApprovalScanMessage[]): PendingApprovalToolCall[] {
  const cached = pendingApprovalsCache.get(messages)
  if (cached) return cached

  const pending: PendingApprovalToolCall[] = []
  for (const message of messages) {
    for (const part of message.contentParts) {
      if (part.type === 'tool-call' && part.state === 'paused' && isApprovalPauseReason(part.pauseReason)) {
        pending.push({
          messageId: message.id,
          toolCallId: part.toolCallId,
          pauseReason: part.pauseReason,
        })
      }
    }
  }
  pendingApprovalsCache.set(messages, pending)
  return pending
}

/**
 * A paused tool call surfaced as one user decision: either an approval request
 * (per-call) or a tool-call-limit pause (per frozen batch). This is what the
 * unified action bar above the input box renders, in message order.
 */
export type PendingPauseInteraction =
  | ({ kind: 'approval' } & PendingApprovalToolCall)
  | { kind: 'tool_call_limit'; messageId: string; toolCallId: string; maxToolCalls: number }

const pendingInteractionsCache = new WeakMap<object, PendingPauseInteraction[]>()

/**
 * Whether any tool call is paused on a decision the user can actually act on.
 * A paused part whose `pauseReason` this build does not recognize (imported
 * data, or data written by a different app version) surfaces no approval card
 * and no continue action, so it must not count as pending.
 */
export function hasPendingPauseInteraction(messages: ApprovalScanMessage[]): boolean {
  return messages.some((message) =>
    message.contentParts.some(
      (part) =>
        part.type === 'tool-call' &&
        part.state === 'paused' &&
        (isApprovalPauseReason(part.pauseReason) || part.pauseReason?.type === 'tool_call_limit')
    )
  )
}

/**
 * All paused tool calls that wait on a user decision. Approval pauses map 1:1 to
 * interactions. A tool-call-limit pause freezes the message's whole in-flight
 * batch and the service resumes or stops every limit-paused part together
 * (`findPausedToolCallLimitBatch` ignores stepIndex), so per message only the
 * first limit-paused part becomes an interaction — mirroring what acting on it
 * actually resolves.
 */
export function listPendingPauseInteractions(messages: ApprovalScanMessage[]): PendingPauseInteraction[] {
  const cached = pendingInteractionsCache.get(messages)
  if (cached) return cached

  const pending: PendingPauseInteraction[] = []
  for (const message of messages) {
    let seenLimitPause = false
    for (const part of message.contentParts) {
      if (part.type !== 'tool-call' || part.state !== 'paused') continue
      if (isApprovalPauseReason(part.pauseReason)) {
        pending.push({
          kind: 'approval',
          messageId: message.id,
          toolCallId: part.toolCallId,
          pauseReason: part.pauseReason,
        })
      } else if (part.pauseReason?.type === 'tool_call_limit') {
        if (seenLimitPause) continue
        seenLimitPause = true
        pending.push({
          kind: 'tool_call_limit',
          messageId: message.id,
          toolCallId: part.toolCallId,
          maxToolCalls: part.pauseReason.maxToolCalls,
        })
      }
    }
  }
  pendingInteractionsCache.set(messages, pending)
  return pending
}
