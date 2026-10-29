import type { SessionTranscriptOrigin } from '@chatbox/core/ports'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { SessionTranscriptWindowController, type SessionTranscriptWindowOptions } from './session-transcript-window'

export interface UseSessionTranscriptWindowOptions extends SessionTranscriptWindowOptions {
  initialOrigin?: SessionTranscriptOrigin
}

/** Keep source stable for a mounted conversation. Layout acknowledgements open its post-first-window work gate. */
export function useSessionTranscriptWindow(options: UseSessionTranscriptWindowOptions) {
  const captureAnchor = useRef(options.captureAnchor)
  captureAnchor.current = options.captureAnchor
  const controller = useMemo(
    () =>
      new SessionTranscriptWindowController({
        sessionId: options.sessionId,
        pageSize: options.pageSize,
        maxBytes: options.maxBytes,
        source: options.source,
        captureAnchor: () => captureAnchor.current?.() ?? null,
      }),
    [options.sessionId, options.pageSize, options.maxBytes, options.source]
  )
  const origin = options.initialOrigin ?? 'tail'
  const originKey =
    typeof origin === 'string'
      ? origin
      : 'messageId' in origin
        ? JSON.stringify(['message', origin.messageId, origin.align])
        : JSON.stringify(['thread', origin.threadId, origin.edge, origin.align])
  const originRef = useRef(origin)
  originRef.current = origin
  useEffect(() => {
    void controller.open(originRef.current)
    return controller.close
  }, [controller, originKey])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const prefetchThreadId = state.threads.at(-1)?.threadId
  useEffect(() => {
    if (!state.firstWindowReady || state.revision === null || !prefetchThreadId || !options.source.prefetchThreadLinks)
      return
    const abort = new AbortController()
    const timer = setTimeout(() => {
      void options.source.prefetchThreadLinks!({
        sessionId: options.sessionId,
        threadId: prefetchThreadId,
        expectedRevision: state.revision!,
        signal: abort.signal,
      }).catch(() => {})
    }, 0)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [state.firstWindowReady, state.revision, prefetchThreadId, options.source, options.sessionId])
  return { ...state, controller }
}
