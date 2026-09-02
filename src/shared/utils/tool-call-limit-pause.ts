import type { SessionSettings, Settings } from '../types'
import { resolveCommandApprovalMode } from '../types/command-execution'

/**
 * How many consecutive tool calls a generation may execute before pausing for
 * user confirmation (the "Paused after N steps" card).
 */
export const MAX_TOOL_CALLS_BEFORE_CONFIRMATION = 25

/**
 * Resolve whether generation should pause for confirmation after
 * MAX_TOOL_CALLS_BEFORE_CONFIRMATION consecutive tool calls, in this order:
 *
 * 1. The session-level setting, when this chat has one. An explicit per-chat
 *    choice always wins, so the switch in conversation settings never claims a
 *    behavior the run does not have.
 * 2. Full Access, which already skips per-action approval and is meant to run
 *    unattended. It overrides the global default instead of the chat's own
 *    choice: the global setting is always present (it defaults to `true`), so a
 *    Full Access chat would otherwise never reach an unattended default.
 * 3. The global setting, defaulting to pause.
 */
export function shouldPauseOnToolCallLimit(
  sessionSettings:
    | Pick<SessionSettings, 'pauseOnToolCallLimit' | 'commandApprovalMode' | 'agentFullAccess'>
    | undefined,
  globalSettings: Partial<Pick<Settings, 'pauseOnToolCallLimit'>> | undefined
): boolean {
  if (sessionSettings?.pauseOnToolCallLimit !== undefined) return sessionSettings.pauseOnToolCallLimit
  if (sessionSettings && resolveCommandApprovalMode(sessionSettings) === 'full_access') return false
  return globalSettings?.pauseOnToolCallLimit ?? true
}
