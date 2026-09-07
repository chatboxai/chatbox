import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import type { MessageListRef } from '@/components/chat/MessageList'
import { navigateCompleteTranscript } from '@/stores/scrollActions'
import { type TranscriptNavigation, uiStore } from '@/stores/uiStore'

/** Owns asynchronous navigation for one mounted route identity. */
export function useSessionViewNavigation(
  sessionId: string,
  messageListRef: RefObject<MessageListRef>,
  complete: boolean
) {
  const owner = useMemo(() => ({ sessionId }), [sessionId])
  const activeOwner = useRef<typeof owner | null>(owner)
  activeOwner.current = owner
  type Navigation = { owner: typeof owner; messageId?: string; initialNavigation: TranscriptNavigation | null }
  const [navigation, setNavigation] = useState<Navigation | null>(null)
  const activeNavigation = useRef<Navigation | null>(null)
  useEffect(() => {
    activeOwner.current = owner
    return () => {
      if (activeOwner.current === owner) activeOwner.current = null
    }
  }, [owner])
  const isCurrent = useCallback(() => activeOwner.current === owner, [owner])
  const requireComplete = useCallback(
    async (messageId?: string) => {
      if (activeOwner.current !== owner) return
      const currentNavigation = uiStore.getState().transcriptNavigation
      const request = {
        owner,
        messageId,
        initialNavigation: currentNavigation?.sessionId === sessionId ? currentNavigation : null,
      }
      activeNavigation.current = request
      setNavigation(null)
      try {
        const session = await rendererApplication.sessionQueryBridge.requireCompleteSessionView(sessionId)
        if (activeOwner.current === owner && activeNavigation.current === request) {
          if (session) setNavigation(request)
          else activeNavigation.current = null
        }
      } catch (error) {
        if (activeOwner.current === owner && activeNavigation.current === request) {
          activeNavigation.current = null
          console.error('Failed to load conversation history', error)
        }
      }
    },
    [owner, sessionId]
  )
  useEffect(() => {
    if (!complete || !navigation || navigation.owner !== owner) return
    let active = true
    const ownsRequest = () => active && isCurrent() && activeNavigation.current === navigation
    void navigateCompleteTranscript({
      sessionId,
      initialNavigation: navigation.initialNavigation,
      isCurrent: ownsRequest,
      messageId: navigation.messageId,
      navigate: () => {
        const list = messageListRef.current
        if (!list) return false
        if (navigation.messageId) return list.scrollToMessage(navigation.messageId)
        list.scrollToTop()
        return true
      },
    })
      .then((success) => {
        if (!success && ownsRequest()) console.warn('Unable to complete conversation navigation')
      })
      .catch((error) => {
        if (ownsRequest()) console.error('Failed to navigate conversation history', error)
      })
      .finally(() => {
        if (!ownsRequest()) return
        activeNavigation.current = null
        setNavigation((current) => (current === navigation ? null : current))
      })
    return () => {
      active = false
    }
  }, [complete, navigation, owner, sessionId, messageListRef, isCurrent])
  return {
    requireComplete,
    pendingNavigation: navigation?.owner === owner ? navigation : null,
    isCurrent,
  }
}
