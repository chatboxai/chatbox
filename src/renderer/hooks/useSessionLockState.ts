import { type SessionLockState } from '@chatbox/core/session/action-gates'
import type { SessionHeader } from '@shared/types'
import { useSessionGenerationControl } from '@chatbox/react/query'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { useMemo } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import { compactionUIStateMapAtom } from '@/stores/atoms/compactionAtoms'

const useGenerationRuntimeVersion = () => rendererApplication.generationHooks.useVersion()

/** Joins exact row generation controls with the host's compaction runtime. */
export function useSessionControls(session: SessionHeader | null | undefined, presentationSessionId?: string) {
  const sessionId = session?.id ?? presentationSessionId
  const compactionRunningAtom = useMemo(
    () =>
      selectAtom(compactionUIStateMapAtom, (stateMap) =>
        sessionId ? stateMap[sessionId]?.status === 'running' : false
      ),
    [sessionId]
  )
  const compactionRunning = useAtomValue(compactionRunningAtom)
  const generationRuntimeVersion = useGenerationRuntimeVersion()
  // biome-ignore lint/correctness/useExhaustiveDependencies: The version invalidates this external-store snapshot.
  const activeGenerationMessageIds = useMemo(
    () => (sessionId ? rendererApplication.generationRuntime.getActiveMessageIds(sessionId) : new Set<string>()),
    [sessionId, generationRuntimeVersion]
  )
  const header = rendererApplication.sessionHooks.useSessionHeader(sessionId ?? null)
  return useSessionGenerationControl({
    sessionId,
    headerRead: header.read,
    bridge: rendererApplication.sessionQueryBridge,
    activeGenerationMessageIds,
    compactionRunning,
    source: rendererApplication.sessions,
  })
}

export function useSessionLockState(
  session: SessionHeader | null | undefined,
  presentationSessionId?: string
): SessionLockState {
  return useSessionControls(session, presentationSessionId).locks
}
