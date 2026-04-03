export type LangSmithBridgeReason = 'enabled' | 'missing-api-key' | 'tracing-disabled'

export interface LangSmithBridgeStatusPayload {
  enabled: boolean
  projectName: string
  reason: LangSmithBridgeReason
}

export interface LangSmithBridgeStartRunResponse extends LangSmithBridgeStatusPayload {
  runId: string | null
}

export const LANGSMITH_WEB_BRIDGE_ENDPOINTS = {
  startRun: '/api/langsmith/start-run',
  endRun: '/api/langsmith/end-run',
  recordEvent: '/api/langsmith/record-event',
} as const
