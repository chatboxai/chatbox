import { useEffect, useSyncExternalStore } from 'react'
import { sessionStartupRecovery } from './coordinator'

export function useSessionStartupLoadTarget(sessionId: string | null): string | null {
  useSyncExternalStore(
    sessionStartupRecovery.subscribe,
    sessionStartupRecovery.getSnapshot,
    sessionStartupRecovery.getSnapshot
  )
  useEffect(
    () => () => {
      if (sessionId) sessionStartupRecovery.leave(sessionId)
    },
    [sessionId]
  )
  return sessionStartupRecovery.getLoadTarget(sessionId)
}

export function useSessionStartupQueryFailure(sessionId: string, sessionLoadTarget: string | null, isError: boolean) {
  useEffect(() => {
    if (!isError || sessionLoadTarget !== sessionId) return
    sessionStartupRecovery.fail(sessionId)
  }, [isError, sessionId, sessionLoadTarget])
}

export function useSessionStartupGuard(sessionId: string, isSessionLoadSettled: boolean, disabled = false) {
  useEffect(() => {
    if (disabled) return
    sessionStartupRecovery.begin(sessionId)
    return () => sessionStartupRecovery.abandon(sessionId)
  }, [disabled, sessionId])

  useEffect(() => {
    if (!disabled && isSessionLoadSettled) sessionStartupRecovery.settle(sessionId)
  }, [disabled, isSessionLoadSettled, sessionId])
}
