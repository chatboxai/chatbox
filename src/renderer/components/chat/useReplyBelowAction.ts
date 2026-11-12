import {
  getSessionActionGate,
  SessionActionBlockedError,
  type SessionLockState,
} from '@chatbox/core/session/action-gates'
import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { generateMore } from '@/stores/session/generation'
import * as toastActions from '@/stores/toastActions'
import { notifySessionLockBlocked } from '@/utils/session-lock-copy'

export function useReplyBelowAction(
  sessionId: string,
  messageId: string,
  generating: boolean | undefined,
  locks: SessionLockState
) {
  const { t } = useTranslation()
  const runtime = rendererApplication.generationRuntime
  const stopping = useSyncExternalStore(
    (listener) => runtime.subscribe(listener),
    () => runtime.isSessionStopRequested(sessionId),
    () => false
  )
  const context = { messageGenerating: generating, sessionStopRequested: stopping }
  const gate = getSessionActionGate('reply-below', locks, context)
  const run = useCallback(async () => {
    const currentContext = {
      messageGenerating: generating,
      sessionStopRequested: runtime.isSessionStopRequested(sessionId),
    }
    const currentGate = getSessionActionGate('reply-below', locks, currentContext)
    if (!currentGate.allowed) {
      await notifySessionLockBlocked(currentGate.reason, t)
      return
    }
    try {
      await generateMore(sessionId, messageId)
    } catch (error) {
      if (error instanceof SessionActionBlockedError) await notifySessionLockBlocked(error.reason, t)
      else toastActions.add(error instanceof Error ? error.message : t('Failed to regenerate'), 2500)
    }
  }, [generating, locks, messageId, runtime, sessionId, t])
  return { gate, run }
}
