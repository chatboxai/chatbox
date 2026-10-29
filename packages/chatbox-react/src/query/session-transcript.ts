import type { SessionTranscriptOrigin } from '@chatbox/core/ports'
import { useEffect, useMemo } from 'react'
import type { SessionQueryBridge } from './session-query-bridge'
import type { SessionQuerySource } from './session-query-options'
import { sessionTranscriptPageSize, type SessionTranscriptViewportAnchor } from './session-transcript-window'
import { useSessionTranscriptWindow } from './use-session-transcript-window'

export interface SessionTranscriptOptions {
  sessionId: string
  platform: 'rn' | 'capacitor' | 'electron' | 'web'
  source: Pick<SessionQuerySource, 'readSessionTranscriptWindow' | 'prefetchSessionThreadLinks'>
  bridge: SessionQueryBridge
  initialOrigin?: SessionTranscriptOrigin
  captureAnchor?(): SessionTranscriptViewportAnchor | null
}

export function useSessionTranscript(options: SessionTranscriptOptions) {
  const source = useMemo(
    () => ({
      prefetchThreadLinks: options.source.prefetchSessionThreadLinks
        ? (request: import('@chatbox/core/ports').SessionThreadRequest & { signal?: AbortSignal }) =>
            options.source.prefetchSessionThreadLinks!(request)
        : undefined,
      readTranscriptWindow: (request: Parameters<SessionQuerySource['readSessionTranscriptWindow']>[0]) =>
        options.source.readSessionTranscriptWindow(request),
    }),
    [options.source]
  )
  const state = useSessionTranscriptWindow({
    sessionId: options.sessionId,
    pageSize: sessionTranscriptPageSize(options.platform),
    source,
    initialOrigin: options.initialOrigin,
    captureAnchor: options.captureAnchor,
  })
  useEffect(
    () => options.bridge.registerWindow(options.sessionId, state.controller),
    [options.bridge, options.sessionId, state.controller]
  )
  const messages = useMemo(() => state.rows.map((row) => row.message), [state.rows])
  return {
    ...state,
    messages,
    loadOlder: state.controller.loadOlder,
    loadNewer: state.controller.loadNewer,
    jumpToEdge: state.controller.navigate,
    isLoadingOlder: state.operation?.kind === 'older' && state.operation.phase === 'reading',
    isLoadingNewer: state.operation?.kind === 'newer' && state.operation.phase === 'reading',
    isJumping: state.operation?.kind === 'navigate' && state.operation.phase !== 'error',
    error: state.operation?.error ?? null,
    retry: state.controller.retry,
  }
}
