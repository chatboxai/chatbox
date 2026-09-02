/**
 * @deprecated Import session action gates from
 * `@chatbox/core/session/action-gates` instead.
 */
export {
  assertSessionActionAllowed,
  deriveSessionLockState,
  getSessionActionGate,
  getSubmitAvailability,
  IDLE_SESSION_LOCK_STATE,
  isGenerationLocked,
  type SessionAction,
  SessionActionBlockedError,
  type SessionActionBlockReason,
  type SessionActionContext,
  type SessionActionGate,
  type SessionLockState,
  type SubmitAvailability,
  sessionLockStatesEqual,
  shouldShowConcurrentReplyStop,
} from '@chatbox/core/session/action-gates'
