import type { SessionReadModel } from '@chatbox/core/ports'
import { useEffect, useLayoutEffect, useRef } from 'react'
import * as scrollActions from '@/stores/scrollActions'

export function useInitialSessionScroll(
  sessionId: string,
  viewKind: SessionReadModel['kind'] | undefined,
  enabled = true
) {
  const currentViewKind = useRef(viewKind)
  const windowViewSeen = useRef(viewKind === 'window')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useLayoutEffect(() => {
    currentViewKind.current = viewKind
    windowViewSeen.current ||= viewKind === 'window'
  }, [viewKind])

  // The mount timer belongs to one route visit, including parameter-only navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId defines the timer's ownership lifetime.
  useLayoutEffect(
    () => () => {
      clearTimeout(timer.current)
      timer.current = undefined
    },
    [sessionId]
  )

  useEffect(() => {
    if (!enabled) return
    timer.current = setTimeout(() => {
      timer.current = undefined
      // MessageList owns window initialization and restoration, including while its data is loading.
      if (currentViewKind.current === 'full' && !windowViewSeen.current) scrollActions.scrollToBottom('auto')
    }, 200)
    return () => clearTimeout(timer.current)
  }, [enabled])
}
