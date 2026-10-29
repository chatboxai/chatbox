export interface AcceptedImageBackgroundTaskResult {
  ok: true
  command: 'image generate'
  accepted: true
  background: true
  recordId: string
  status: 'pending'
  startedAt: number
  wait: {
    mode: 'callback'
    managedBy: 'chatbox'
    modelShouldPoll: false
    pollIntervalMs?: number
  }
}

export function getAcceptedImageBackgroundTaskResult(value: unknown): AcceptedImageBackgroundTaskResult | null {
  if (!value || typeof value !== 'object') return null
  const result = value as Record<string, unknown>
  const wait = result.wait
  if (!wait || typeof wait !== 'object') return null
  const waitRecord = wait as Record<string, unknown>

  if (
    result.ok !== true ||
    result.command !== 'image generate' ||
    result.accepted !== true ||
    result.background !== true ||
    result.status !== 'pending' ||
    typeof result.recordId !== 'string' ||
    typeof result.startedAt !== 'number' ||
    waitRecord.mode !== 'callback' ||
    waitRecord.managedBy !== 'chatbox' ||
    waitRecord.modelShouldPoll !== false
  ) {
    return null
  }

  return value as AcceptedImageBackgroundTaskResult
}

export function hasAcceptedCallbackBackgroundTask(
  steps: ReadonlyArray<{
    toolResults: ReadonlyArray<{ toolName: string; output: unknown }>
  }>
): boolean {
  return steps.some((step) =>
    step.toolResults.some(
      (toolResult) =>
        toolResult.toolName === 'chatbox_cli' && getAcceptedImageBackgroundTaskResult(toolResult.output) !== null
    )
  )
}

export function hasAcceptedCallbackBackgroundTaskResult(
  contentParts: ReadonlyArray<{ type: string; toolName?: string; result?: unknown }>
): boolean {
  return contentParts.some(
    (part) =>
      part.type === 'tool-call' &&
      part.toolName === 'chatbox_cli' &&
      getAcceptedImageBackgroundTaskResult(part.result) !== null
  )
}
