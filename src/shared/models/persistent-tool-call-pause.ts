import type { StopCondition, ToolSet } from 'ai'

const PERSISTENT_TOOL_CALL_PAUSE_ERROR_NAMES = new Set([
  'ToolCallLimitPausedError',
  'UserExecApprovalPausedError',
  'CommandEscalationApprovalPausedError',
  'FileMutationApprovalPausedError',
  'AppActionApprovalPausedError',
])

export function isPersistentToolCallPauseError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'name' in error &&
      PERSISTENT_TOOL_CALL_PAUSE_ERROR_NAMES.has(String(error.name))
  )
}

/**
 * Pause errors are tool outputs from the AI SDK's perspective. Without this
 * stop condition, the SDK immediately starts another model step after every
 * parallel tool has returned its pause error.
 */
export function stopWhenPersistentToolCallPause<T extends ToolSet>(): StopCondition<T> {
  return ({ steps }) =>
    steps.at(-1)?.content.some((part) => part.type === 'tool-error' && isPersistentToolCallPauseError(part.error)) ??
    false
}
