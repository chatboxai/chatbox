import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import type { MessageListRef, MessageNavigationTarget } from '@/components/chat/MessageList'
import { navigateCompleteTranscript } from '@/stores/scrollActions'
import * as toastActions from '@/stores/toastActions'
import { type TranscriptNavigation, uiStore } from '@/stores/uiStore'

type NavigationTarget = { kind: 'preserve' } | MessageNavigationTarget

/** Owns asynchronous navigation for one mounted route identity. */
export function useSessionViewNavigation(
  sessionId: string,
  messageListRef: RefObject<MessageListRef>,
  complete: boolean,
  cancelWindowJump?: () => void
) {
  const owner = useMemo(() => ({ sessionId }), [sessionId])
  const activeOwner = useRef<typeof owner | null>(owner)
  activeOwner.current = owner
  type Navigation = {
    owner: typeof owner
    target: NavigationTarget
    source: 'window' | 'complete'
    initialNavigation: TranscriptNavigation | null
  }
  const [navigation, setNavigation] = useState<Navigation | null>(null)
  const [loadingOwner, setLoadingOwner] = useState<typeof owner | null>(null)
  const activeNavigation = useRef<Navigation | null>(null)
  useEffect(() => {
    activeOwner.current = owner
    return () => {
      if (activeOwner.current === owner) activeOwner.current = null
    }
  }, [owner])
  const isCurrent = useCallback(() => activeOwner.current === owner, [owner])
  const loadComplete = useCallback(
    async (target: NavigationTarget) => {
      if (activeOwner.current !== owner) return
      const currentNavigation = uiStore.getState().transcriptNavigation
      const previous = activeNavigation.current
      const request: Navigation = {
        owner,
        target: target.kind === 'preserve' && previous?.owner === owner ? previous.target : target,
        source: 'complete',
        initialNavigation: currentNavigation?.sessionId === sessionId ? currentNavigation : null,
      }
      setLoadingOwner(owner)
      activeNavigation.current = request
      setNavigation(null)
      try {
        const session = await rendererApplication.sessionQueryBridge.requireCompleteSessionView(sessionId)
        if (activeOwner.current === owner && activeNavigation.current === request) {
          if (session && request.target.kind !== 'preserve') setNavigation(request)
          else activeNavigation.current = null
        }
      } catch (error) {
        if (activeOwner.current === owner && activeNavigation.current === request) {
          activeNavigation.current = null
          console.error('Failed to load conversation history', error)
          toastActions.add(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (activeOwner.current === owner && (!activeNavigation.current || activeNavigation.current === request)) {
          setLoadingOwner(null)
        }
      }
    },
    [owner, sessionId]
  )
  const requireComplete = useCallback(
    (messageId?: string) => loadComplete(messageId ? { kind: 'message', messageId } : { kind: 'head' }),
    [loadComplete]
  )
  const loadCompleteNavigation = useCallback(() => loadComplete({ kind: 'preserve' }), [loadComplete])
  const navigate = useCallback(
    (target: MessageNavigationTarget) => {
      if (activeOwner.current !== owner) return false
      cancelWindowJump?.()
      const pending = activeNavigation.current
      if (!complete && pending?.owner === owner && pending.source === 'complete') {
        // Hydration remembers the latest intent; the current view handles the action immediately.
        pending.target = target
      } else {
        activeNavigation.current = null
        setNavigation(null)
      }
      return false
    },
    [owner, complete, cancelWindowJump]
  )
  const jumpToEdge = useCallback(
    (edge: 'head' | 'tail', jumpWindow: (edge: 'head' | 'tail') => void | Promise<void>) => {
      if (activeOwner.current !== owner) return
      const pending = activeNavigation.current
      const hydrating = !complete && pending?.owner === owner && pending.source === 'complete'
      const request: Navigation = hydrating
        ? pending
        : { owner, target: { kind: edge }, source: 'window', initialNavigation: null }
      request.target = { kind: edge }
      activeNavigation.current = request
      const finish = () => {
        if (!hydrating && activeNavigation.current === request) activeNavigation.current = null
      }
      void Promise.resolve(jumpWindow(edge)).then(finish, finish)
    },
    [owner, complete]
  )
  useEffect(() => {
    if (!complete || !navigation || navigation.owner !== owner) return
    let active = true
    const ownsRequest = () => active && isCurrent() && activeNavigation.current === navigation
    void navigateCompleteTranscript({
      sessionId,
      initialNavigation: navigation.initialNavigation,
      isCurrent: ownsRequest,
      messageId: navigation.target.kind === 'message' ? navigation.target.messageId : undefined,
      edge: navigation.target.kind === 'tail' ? 'tail' : 'head',
      navigate: () => {
        const list = messageListRef.current
        if (!list) return false
        if (navigation.target.kind === 'message')
          return list.scrollToMessage(navigation.target.messageId, 'smooth', 'replay')
        if (navigation.target.kind === 'tail') list.scrollToBottom('auto', 'replay')
        else list.scrollToTop('auto', 'replay')
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
    navigate,
    requireComplete,
    loadCompleteNavigation,
    jumpToEdge,
    isLoadingComplete: loadingOwner === owner,
    pendingNavigation: navigation?.owner === owner ? navigation : null,
    isCurrent,
  }
}
