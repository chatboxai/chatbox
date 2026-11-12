import { EXECUTION_MESSAGE_CHANNEL } from '@shared/mobile-work/execution-html'
import type { ExecutionResult, MobileExecutionService } from '@shared/mobile-work/MobileExecutionService'

export function receiveExecutionMessage(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  frame: Window | null,
  jobId: string,
  token: string,
  service: MobileExecutionService
): void {
  if (!frame || event.source !== frame || event.origin !== 'null') return
  if (typeof event.data !== 'string') return
  try {
    if (event.data.length > 32 * 1024 * 1024) throw new Error('Execution output too large')
    const response = JSON.parse(event.data) as {
      channel?: unknown
      token?: unknown
      id?: unknown
      result?: ExecutionResult
    } | null
    if (
      !response ||
      response.channel !== EXECUTION_MESSAGE_CHANNEL ||
      response.token !== token ||
      response.id !== jobId
    )
      return
    if (!response.result) throw new Error('Execution returned no result')
    service.receive(jobId, response.result)
  } catch {
    service.fail(jobId, new Error('Invalid execution response'))
  }
}
