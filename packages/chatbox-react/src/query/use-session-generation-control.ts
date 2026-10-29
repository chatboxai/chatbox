import type { SessionHeaderRead, SessionRowRepositoryPort } from '@chatbox/core/ports'
import { IDLE_SESSION_LOCK_STATE, type SessionLockState } from '@chatbox/core/session/action-gates'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { SessionQueryBridge } from './session-query-bridge'

export function useSessionGenerationControl(options: {
  sessionId: string | null | undefined
  headerRead: SessionHeaderRead | null | undefined
  activeGenerationMessageIds: ReadonlySet<string>
  compactionRunning: boolean
  source: Pick<SessionRowRepositoryPort, 'readSessionGenerationControl'>
  bridge: SessionQueryBridge
}) {
  const { sessionId, headerRead, activeGenerationMessageIds, compactionRunning, source, bridge } = options
  const ids = [...activeGenerationMessageIds].sort()
  const subscribe = useCallback(
    (listener: () => void) => (sessionId ? bridge.subscribeCommits(sessionId, listener) : () => {}),
    [bridge, sessionId]
  )
  const getVersion = useCallback(
    () => (sessionId ? bridge.getGenerationControlVersion(sessionId) : 0),
    [bridge, sessionId]
  )
  const structureVersion = useSyncExternalStore(subscribe, getVersion, getVersion)
  const summary = headerRead?.summary
  const controlScope = JSON.stringify([
    ids,
    headerRead?.activeThreadId,
    headerRead?.control.generatingAssistantCount,
    summary?.generatingMessageCount,
    summary?.pausedMessageCount,
    summary?.webSearchSignInErrorCount,
  ])
  const result = useQuery({
    queryKey: [
      'session-generation-control',
      sessionId,
      controlScope,
      structureVersion,
      summary?.lastConversationMessageId,
    ],
    // Keep confirmed locks while refreshing the same generation facts after a row change.
    placeholderData: (previous, previousQuery) =>
      headerRead && previous?.sessionId === sessionId && previousQuery?.queryKey[2] === controlScope
        ? previous
        : undefined,
    enabled: !!sessionId && headerRead != null,
    queryFn: () => source.readSessionGenerationControl({ sessionId: sessionId!, activeGenerationMessageIds: ids }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    networkMode: 'always',
  })
  const read = result.data
  const locks = useMemo<SessionLockState>(
    () => ({
      generatingReplyCount: read?.generatingReplyCount ?? IDLE_SESSION_LOCK_STATE.generatingReplyCount,
      anyReplyGenerating: read?.anyReplyGenerating ?? IDLE_SESSION_LOCK_STATE.anyReplyGenerating,
      awaitingPauseDecision: read?.awaitingPauseDecision ?? IDLE_SESSION_LOCK_STATE.awaitingPauseDecision,
      compactionRunning,
    }),
    [read?.generatingReplyCount, read?.anyReplyGenerating, read?.awaitingPauseDecision, compactionRunning]
  )
  return { ...result, locks }
}
