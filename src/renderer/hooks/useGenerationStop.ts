import { useCallback, useSyncExternalStore } from 'react'
import {
  getGenerationStopStatus,
  messageStopOperationKey,
  sessionStopOperationKey,
  startGenerationStop,
  subscribeGenerationStopOperations,
} from '@/stores/generationStopOperations'
import { stopAllMessageGenerations, stopMessageGeneration } from '@/stores/session/generation-cancellation'

export type { GenerationStopStatus } from '@/stores/generationStopOperations'

function useStopOperation(key: string | undefined, run: () => Promise<void>) {
  const status = useSyncExternalStore(
    subscribeGenerationStopOperations,
    () => getGenerationStopStatus(key),
    () => getGenerationStopStatus(key)
  )

  const requestStop = useCallback((): boolean => {
    if (!key) return false
    void startGenerationStop(key, run)
    return true
  }, [key, run])

  const stopAndWait = useCallback((): Promise<void> => {
    if (!key) return Promise.resolve()
    return startGenerationStop(key, run)
  }, [key, run])

  return { requestStop, status, stopAndWait }
}

export function useGenerationStop(
  sessionId: string | undefined,
  stop: (sessionId: string) => Promise<void> = stopAllMessageGenerations
) {
  const run = useCallback(() => (sessionId ? stop(sessionId) : Promise.resolve()), [sessionId, stop])
  return useStopOperation(sessionId ? sessionStopOperationKey(sessionId) : undefined, run)
}

export function useMessageGenerationStop(
  sessionId: string,
  messageId: string,
  stop: (sessionId: string, messageId: string) => Promise<void> = stopMessageGeneration
) {
  const run = useCallback(() => stop(sessionId, messageId), [messageId, sessionId, stop])
  return useStopOperation(messageStopOperationKey(sessionId, messageId), run)
}
