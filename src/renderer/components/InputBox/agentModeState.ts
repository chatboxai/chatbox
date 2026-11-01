import type { AgentModeEntry, AgentModeValue } from '@shared/types'
import platform from '@/platform'

export interface AgentModeUIState {
  /**
   * The mode to render in the selector / robot button, clamped to 'off' when
   * the platform or model can't run agent mode. Display only — never gate
   * behavior on this. In particular, 'auto' is shown as chat/off mode; it only
   * controls the first-turn suggestion classifier.
   */
  displayValue: AgentModeValue
  /**
   * Whether agent-mode capabilities are actually engaged. True only for 'on'.
   * 'auto' is displayed as chat/off mode and runs the first-turn suggestion
   * classifier, but generation resolves it to off unless the user accepts the
   * suggestion. Gate Work Mode-only input and capability behavior on this flag
   * (or `capabilitiesDisabled`), not on displayValue.
   */
  isActive: boolean
  /**
   * Inverse of `isActive`, for disabling Work Mode-only capability controls
   * (code execution, skills, MCP, working directories). Independent capabilities
   * such as Web Search and Knowledge Base must not use this gate.
   */
  capabilitiesDisabled: boolean
  modelUnsupported: boolean
}

export function getAgentModeUIState(entry: AgentModeEntry, modelSupportsAgentMode: boolean): AgentModeUIState {
  const modelUnsupported = !modelSupportsAgentMode
  const platformUnsupported = !platform.isDesktopLike && platform.type !== 'mobile'
  const displayValue: AgentModeValue = entry.value === 'on' && !modelUnsupported && !platformUnsupported ? 'on' : 'off'

  // Work Mode capabilities (code execution, skills, MCP, agent-mode file handling)
  // only apply when agent mode is actually on; 'auto' merely allows the suggestion,
  // so it is treated as inactive here.
  const isActive = displayValue === 'on'

  return {
    displayValue,
    isActive,
    capabilitiesDisabled: !isActive,
    modelUnsupported,
  }
}
