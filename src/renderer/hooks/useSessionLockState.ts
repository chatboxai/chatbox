import {
  deriveSessionLockState,
  IDLE_SESSION_LOCK_STATE,
  type SessionLockState,
  sessionLockStatesEqual,
} from '@chatbox/core/session/action-gates'
import type { Session } from '@shared/types'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { useMemo, useRef } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import { compactionUIStateMapAtom } from '@/stores/atoms/compactionAtoms'

const useGenerationRuntimeVersion = () => rendererApplication.generationHooks.useVersion()

/**
 * Renderer adapter for the shared session action gates: joins session data
 * with the renderer-only compaction runtime state into one lock snapshot.
 * Components pass the snapshot to `getSessionActionGate` instead of encoding
 * their own blocking conditions.
 *
 * Referential stability matters here: the hook is mounted in the route, the
 * message list, and the input box at once, and streaming hands it a fresh
 * session object per chunk. The compaction map is subscribed through a
 * per-session `selectAtom` boolean (the map itself changes on every compaction
 * streaming chunk), and the snapshot object is reused while its values are
 * unchanged so `memo()`d consumers (every Message row) don't re-render per
 * chunk.
 */
export function useSessionLockState(session: Session | null | undefined): SessionLockState {
  const sessionId = session?.id
  const compactionRunningAtom = useMemo(
    () =>
      selectAtom(compactionUIStateMapAtom, (stateMap) =>
        sessionId ? stateMap[sessionId]?.status === 'running' : false
      ),
    [sessionId]
  )
  const compactionRunning = useAtomValue(compactionRunningAtom)
  useGenerationRuntimeVersion()
  const activeGenerationMessageIds = sessionId
    ? rendererApplication.generationRuntime.getActiveMessageIds(sessionId)
    : new Set<string>()
  const previousRef = useRef<SessionLockState>(IDLE_SESSION_LOCK_STATE)
  return useMemo(() => {
    const next = session
      ? deriveSessionLockState(session, { compactionRunning, activeGenerationMessageIds })
      : IDLE_SESSION_LOCK_STATE
    if (sessionLockStatesEqual(next, previousRef.current)) {
      return previousRef.current
    }
    previousRef.current = next
    return next
  }, [session, compactionRunning, activeGenerationMessageIds])
}
