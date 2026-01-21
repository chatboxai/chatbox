/**
 * Type definitions for quick-input feature IPC communication
 */

export interface QuickInputSubmitPayload {
  text: string
}

export interface QuickInputIPC {
  'quick-input:submit': QuickInputSubmitPayload
  'quick-input:close': void
  'quick-input:ready': void
  'quick-input:focus': void
}
