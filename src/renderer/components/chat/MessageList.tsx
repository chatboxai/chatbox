import type { SessionHeaderRead } from '@chatbox/core/ports'
import { getSessionActionGate } from '@chatbox/core/session/action-gates'
import { isActionAvailableInMode, resolveSessionMode, type SessionMode } from '@chatbox/core/session/mode-policy'
import type { PromptCacheDeleteTarget } from '@chatbox/core/session/prompt-cache-policy'
import type { SessionTranscriptViewportAnchor } from '@chatbox/react/query'
import NiceModal from '@ebay/nice-modal-react'
import { Button, Flex, Loader, Stack, Text, Transition } from '@mantine/core'
import { useThrottledCallback } from '@mantine/hooks'
import { TestId } from '@shared/automation/testids'
import type { Message as SessionMessage, SessionThreadBrief } from '@shared/types'
import {
  IconArrowBarToUp,
  IconArrowUp,
  IconListTree,
  IconMessagePlus,
  IconPencil,
  IconReload,
  IconSwitch3,
  IconTrash,
} from '@tabler/icons-react'
import { useAtomValue } from 'jotai'
import {
  type FC,
  forwardRef,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { type ContextProp, Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { rendererApplication } from '@/app/renderer-application'
import { contentColumnClassName, paddedContentColumnClassName } from '@/components/layout/contentColumn'
import { platformTypeAtom } from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSessionControls } from '@/hooks/useSessionLockState'
import type { useSessionTranscript } from '@/hooks/useSessionPresentation'
import { cn } from '@/lib/utils'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import { removeMessage } from '@/stores/session/messages'
import { moveThreadToConversations, removeThread, switchThread } from '@/stores/session/threads'
import { useSessionActivity } from '@/stores/sessionActivityStore'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { uiStore, useUIStore } from '@/stores/uiStore'
import { notifySessionLockBlocked } from '@/utils/session-lock-copy'
import ActionMenu from '../ActionMenu'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { ErrorNotice } from '../common/ErrorNotice'
import errorNoticeClasses from '../common/ErrorNotice.module.css'
import { ScalableIcon } from '../common/ScalableIcon'
import Loading from '../icons/Loading'
import { BlockCodeCollapsedStateProvider } from '../Markdown'
import ForkGroup from './ForkGroup'
import ForkMarkerMessage from './ForkMarkerMessage'
import Message from './Message'
import MessageMinimapRail from './MessageMinimapRail'
import MessageNavigation, { ScrollToBottomButton } from './MessageNavigation'
import { areMinimapAnchorsEqual, buildMessageMinimapAnchors } from './message-navigation-utils'
import { buildTranscriptRenderItems } from './message-render-items'
import SummaryMessage from './SummaryMessage'
import { createSmoothFollowOutputController, isLayoutClampedScroll } from './smooth-follow-output'
import { createTranscriptContentAnchor, shiftTranscriptContentAnchor } from './transcript-content-anchor'
import { scrollToTranscriptItem, transcriptAnchorLayoutSettled } from './transcript-item-scroll'

type Transcript = ReturnType<typeof useSessionTranscript>
export interface MessageListRef {
  captureAnchor(): SessionTranscriptViewportAnchor | null
  scrollToTop(): void
  scrollToBottom(): void
  scrollToMessage(messageId: string): Promise<boolean>
  setIsNewMessage(value: boolean): void
}

const MessageList = forwardRef<
  MessageListRef,
  { headerRead: SessionHeaderRead; transcript: Transcript; className?: string }
>(({ headerRead, transcript, className }, ref) => {
  const { t } = useTranslation()
  const session = headerRead.header
  const controller = transcript.controller
  const isSmallScreen = useIsSmallScreen()
  const activity = useSessionActivity(session.id)
  const platformType = useAtomValue(platformTypeAtom)
  const widthFull = useUIStore((state) => state.widthFull)
  const hideSystemPromptSetting = useSettingsStore((state) => state.hideSystemPromptMessage)
  const globalMaxContextMessageCount = useSettingsStore((state) => state.maxContextMessageCount)
  const sessionMode = resolveSessionMode(useSessionAgentMode(session.id).value)
  const controls = useSessionControls(session, session.id)
  const sessionLocks = controls.locks
  const hideSystemPrompt = hideSystemPromptSetting || !isActionAvailableInMode('session-system-prompt', sessionMode)
  const container = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLElement | null>(null)
  const reportedScrollTop = useRef(0)
  const pendingMeasurementScroll = useRef<HTMLElement | null>(null)
  const virtuoso = useRef<VirtuosoHandle>(null)
  const lastItem = useRef<HTMLDivElement>(null)
  const owner = useMemo(() => Symbol(session.id), [session.id])
  const { threads: sessionThreads } = rendererApplication.sessionHooks.useSessionThreads(session.id, {
    enabled: transcript.firstWindowReady,
  })
  const showThreadLabels = sessionThreads.length > 1
  const items = useMemo(
    () =>
      buildTranscriptRenderItems(transcript.rows, transcript.threads).filter(
        (item) => showThreadLabels || item.type !== 'thread'
      ),
    [transcript.rows, transcript.threads, showThreadLabels]
  )
  const rowsById = useMemo(() => new Map(transcript.rows.map((row) => [row.messageId, row])), [transcript.rows])
  const threadById = useMemo(
    () => new Map(transcript.threads.map((thread) => [thread.threadId, thread])),
    [transcript.threads]
  )
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [isNewMessage, setIsNewMessage] = useState(false)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [atBottom, setAtBottom] = useState(false)
  const [atTop, setAtTop] = useState(false)
  const [showScrollToPrev, setShowScrollToPrev] = useState(false)
  const lastScrollTop = useRef<number>()
  const lastMaxScrollTop = useRef<number>()
  const scrollNavigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (scrollNavigationTimer.current) clearTimeout(scrollNavigationTimer.current)
    },
    []
  )
  const handleScrollTopThrottled = useThrottledCallback((scrollTop: number, maxScrollTop: number) => {
    if (typeof lastScrollTop.current === 'number') {
      const layoutShrank = isLayoutClampedScroll(
        lastScrollTop.current,
        lastMaxScrollTop.current,
        scrollTop,
        maxScrollTop
      )
      if (scrollNavigationTimer.current) {
        clearTimeout(scrollNavigationTimer.current)
        scrollNavigationTimer.current = null
      }
      if (scrollTop > 0 && scrollTop < lastScrollTop.current && !layoutShrank) {
        setShowScrollToPrev(true)
        scrollNavigationTimer.current = setTimeout(() => setShowScrollToPrev(false), 3000)
      } else {
        setShowScrollToPrev(false)
      }
    }
    lastScrollTop.current = scrollTop
    lastMaxScrollTop.current = maxScrollTop
  }, 256)
  const [showNavigation, setShowNavigation] = useState(false)
  const progress = useRef(0)
  const userDirection = useRef<'older' | 'newer' | null>(null)
  const touchY = useRef<number | null>(null)
  const scrollbarPointer = useRef<{ pointerId: number; scrollTop: number } | null>(null)
  const browseOperation = useRef({ controller, requestId: 0, paging: false })
  const synchronizeBrowseIntent = useCallback(() => {
    const operation = controller.getSnapshot().operation
    const paging =
      !!operation && operation.phase !== 'error' && (operation.kind === 'older' || operation.kind === 'newer')
    if (browseOperation.current.paging && !paging) userDirection.current = null
    browseOperation.current.paging = paging
    const explicit = operation && ['open', 'navigate', 'branch'].includes(operation.kind)
    if (
      browseOperation.current.controller === controller &&
      (!explicit || browseOperation.current.requestId === operation.requestId)
    )
      return
    browseOperation.current = { controller, requestId: explicit ? operation.requestId : 0, paging }
    userDirection.current = null
    touchY.current = null
    scrollbarPointer.current = null
  }, [controller])
  useLayoutEffect(() => {
    synchronizeBrowseIntent()
    return controller.subscribe(synchronizeBrowseIntent)
  }, [controller, synchronizeBrowseIntent])
  const live = useRef({ transcript, items, rowsById })
  live.current = { transcript, items, rowsById }
  const scrollToPosition = useCallback((location: Parameters<VirtuosoHandle['scrollTo']>[0]) => {
    virtuoso.current?.scrollTo(location)
    if (scrollbarPointer.current && scroller.current) scrollbarPointer.current.scrollTop = scroller.current.scrollTop
  }, [])
  const scrollToItem = useCallback(
    (
      index: number,
      align: 'start' | 'end' | 'center' = 'start',
      behavior: 'auto' | 'smooth' = 'auto',
      isCurrent: () => boolean = () => true
    ) => {
      const list = virtuoso.current
      const viewport = scroller.current
      if (list && viewport)
        scrollToTranscriptItem(
          { scrollIntoView: (request) => list.scrollIntoView(request), scrollTo: scrollToPosition },
          viewport,
          index,
          align,
          behavior,
          isCurrent
        )
    },
    [scrollToPosition]
  )
  const follow = useMemo(
    () =>
      createSmoothFollowOutputController({
        scrollToBottom: (behavior) => {
          const element = scroller.current
          if (element) scrollToPosition({ top: Math.max(0, element.scrollHeight - element.clientHeight), behavior })
        },
        stopScrolling: (top) => scrollToPosition({ top, behavior: 'auto' }),
      }),
    [scrollToPosition]
  )
  useEffect(() => () => follow.dispose(), [follow])
  const scrollByGeometry = useCallback((delta: number) => {
    virtuoso.current?.scrollBy({ top: delta, behavior: 'auto' })
    if (scrollbarPointer.current && scroller.current) scrollbarPointer.current.scrollTop = scroller.current.scrollTop
  }, [])
  const contentAnchor = useMemo(
    () =>
      createTranscriptContentAnchor({
        viewport: () => scroller.current,
        suspended: () =>
          !!controller.getSnapshot().layout || !!controller.getSnapshot().operation || follow.isFollowing(),
        scrollBy: scrollByGeometry,
      }),
    [controller, follow, scrollByGeometry]
  )
  useLayoutEffect(() => {
    if (container.current) contentAnchor.connect(container.current)
    return () => contentAnchor.disconnect()
  }, [contentAnchor, transcript.windowEpoch])
  useEffect(() => {
    if (!highlighted) return
    const timer = setTimeout(() => setHighlighted(null), 2500)
    return () => clearTimeout(timer)
  }, [highlighted])

  const messageElement = useCallback((id: string) => {
    const elements = container.current?.querySelectorAll<HTMLElement>('[data-transcript-message]')
    return elements ? Array.from(elements).find((element) => element.dataset.transcriptMessage === id) : undefined
  }, [])
  const captureAnchor = useCallback((): SessionTranscriptViewportAnchor | null => {
    const block = contentAnchor.capture()
    const blockRow = block?.messageId ? live.current.rowsById.get(block.messageId) : undefined
    if (block && blockRow) return { ...block, threadId: blockRow.threadId }
    const viewport = scroller.current?.getBoundingClientRect()
    const elements = container.current?.querySelectorAll<HTMLElement>('[data-transcript-message]')
    if (!viewport || !elements) return null
    for (const element of Array.from(elements)) {
      const bounds = element.getBoundingClientRect()
      if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue
      const row = live.current.rowsById.get(element.dataset.transcriptMessage ?? '')
      if (row) return { threadId: row.threadId, messageId: row.messageId, offset: bounds.top - viewport.top }
    }
    return null
  }, [contentAnchor])
  const navigate = useCallback(
    (origin: 'head' | 'tail' | { messageId: string }) => {
      if (origin !== 'tail') follow.pause()
      if (typeof origin === 'object') setHighlighted(origin.messageId)
      return controller.navigate(origin)
    },
    [controller, follow]
  )
  useImperativeHandle(
    ref,
    () => ({
      captureAnchor,
      scrollToTop: () => {
        void navigate('head')
      },
      scrollToBottom: () => {
        void navigate('tail')
      },
      scrollToMessage: (messageId) => navigate({ messageId }),
      setIsNewMessage,
    }),
    [captureAnchor, navigate]
  )
  useEffect(() => {
    uiStore.getState().setMessageListElement(container)
    uiStore.getState().setTranscriptNavigation({
      owner,
      sessionId: session.id,
      navigateMessage: async (messageId) => {
        follow.pause()
        setHighlighted(messageId)
        return controller.navigate({ messageId })
      },
      openSearch: async (messageId) => {
        follow.pause()
        setHighlighted(messageId)
        return controller.openSearch(messageId)
      },
      viewThread: async (threadId) => {
        follow.pause()
        return controller.viewThread(threadId)
      },
      scrollToIndex: ({ index, align, behavior }) => {
        if (index === 0 || index === 'LAST') navigate(index === 0 ? 'head' : 'tail')
        else if (virtuoso.current && scroller.current) scrollToItem(index, align, behavior)
        return true
      },
    })
    return () => {
      if (uiStore.getState().transcriptNavigation?.owner === owner) {
        uiStore.getState().setTranscriptNavigation(null)
        uiStore.getState().setMessageListElement(null)
      }
    }
  }, [owner, session.id, controller, follow, navigate, scrollToItem])

  const layoutFrame = useRef<number | null>(null)
  const applying = useRef<number | null>(null)
  const layoutCorrection = useCallback(
    (anchor: SessionTranscriptViewportAnchor) => {
      const element = anchor.messageId ? messageElement(anchor.messageId) : null
      const viewport = scroller.current
      if (!element || !viewport) return null
      return (
        (anchor.blockId ? contentAnchor.correction(anchor) : null) ??
        element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - contentAnchor.messageOffset(anchor)
      )
    },
    [contentAnchor, messageElement]
  )
  const userInput = useCallback(
    (scrollDelta = 0) => {
      const state = controller.getSnapshot()
      const layout = state.layout
      if (layout && state.firstWindowReady) {
        let canYield = layout.kind !== 'preserve'
        if (layout.kind === 'preserve') {
          const anchor = shiftTranscriptContentAnchor(
            { ...layout.anchor, offset: 'offset' in layout.anchor ? layout.anchor.offset : 0 },
            scrollDelta
          )
          const correction = layoutCorrection(anchor)
          if (correction !== null) {
            if (Math.abs(correction) > 0.5) scrollByGeometry(correction)
            contentAnchor.adopt(anchor)
            canYield = true
          }
        }
        if (canYield) {
          if (layoutFrame.current !== null) cancelAnimationFrame(layoutFrame.current)
          layoutFrame.current = null
          applying.current = null
          controller.cancelLayout(layout.requestId)
        }
      }
      contentAnchor.onUserInput()
    },
    [controller, contentAnchor, layoutCorrection, scrollByGeometry]
  )
  const applyLayout = useCallback(() => {
    const layout = live.current.transcript.layout
    if (!layout || applying.current === layout.requestId || !scroller.current || !virtuoso.current) return
    const currentItems = live.current.items
    if (
      currentItems.some((item) => item.messages.length) &&
      !container.current?.querySelector('[data-transcript-message]')
    )
      return
    if (layoutFrame.current !== null) cancelAnimationFrame(layoutFrame.current)
    applying.current = layout.requestId
    const isCurrent = () => controller.getSnapshot().layout?.requestId === layout.requestId
    const index = layout.anchor.messageId
      ? currentItems.findIndex((item) => item.messages.some((message) => message.id === layout.anchor.messageId))
      : -1
    if (layout.kind === 'tail') {
      follow.resume()
      if (currentItems.length && !lastItem.current) scrollToItem(currentItems.length - 1, 'end', 'auto', isCurrent)
    } else {
      follow.pause()
      if (layout.kind === 'head' || index < 0) scrollToPosition({ top: 0, behavior: 'auto' })
      else if (!layout.anchor.messageId || !messageElement(layout.anchor.messageId))
        scrollToItem(index, 'start', 'auto', isCurrent)
    }
    let stableAnchorFrames = 0
    let previousAnchorHeight = -1
    let stableTailFrames = 0
    let previousTailHeight = -1
    // The deadline counts frame time, capping each gap, so a long render on a slow device does not consume it.
    let layoutTime = 0
    let previousFrame: number | null = null
    const nextFrame = () => {
      if (layoutTime < 5000) {
        layoutFrame.current = requestAnimationFrame(finish)
        return
      }
      applying.current = null
      controller.rejectLayout(layout.requestId, new Error('Message layout is unavailable'))
    }
    const finish = (time: number) => {
      layoutTime += previousFrame === null ? 0 : Math.min(time - previousFrame, 100)
      previousFrame = time
      if (live.current.transcript.layout?.requestId !== layout.requestId) {
        applying.current = null
        return
      }
      const element = layout.anchor.messageId ? messageElement(layout.anchor.messageId) : null
      const viewport = scroller.current
      if (!viewport) {
        applying.current = null
        return
      }
      if ((layout.kind === 'anchor' || layout.kind === 'preserve') && index >= 0) {
        if (!element) {
          if (virtuoso.current) scrollToItem(index, 'start', 'auto', isCurrent)
          nextFrame()
          return
        }
        const offset = 'offset' in layout.anchor ? layout.anchor.offset : 0
        const blockAnchor =
          'blockId' in layout.anchor && layout.anchor.blockId
            ? {
                messageId: layout.anchor.messageId,
                blockId: layout.anchor.blockId,
                offset,
                messageOffset: layout.anchor.messageOffset,
              }
            : null
        const correction =
          (blockAnchor ? contentAnchor.correction(blockAnchor) : null) ??
          element.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top -
            (blockAnchor ? contentAnchor.messageOffset(blockAnchor) : offset)
        const targetBounds = element.getBoundingClientRect()
        const viewportBounds = viewport.getBoundingClientRect()
        const targetVisible = blockAnchor
          ? contentAnchor.isVisible(blockAnchor)
          : targetBounds.bottom > viewportBounds.top && targetBounds.top < viewportBounds.bottom
        const settled = transcriptAnchorLayoutSettled(viewport, correction, targetVisible)
        stableAnchorFrames = settled && previousAnchorHeight === viewport.scrollHeight ? stableAnchorFrames + 1 : 0
        previousAnchorHeight = viewport.scrollHeight
        if (!settled) scrollByGeometry(correction)
        if (stableAnchorFrames < 2) {
          nextFrame()
          return
        }
      } else if (layout.kind === 'tail') {
        const tail = lastItem.current
        const bounds = viewport.getBoundingClientRect()
        const tailBounds = tail?.getBoundingClientRect()
        const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        const tailVisible =
          !currentItems.length ||
          (tailBounds && tailBounds.bottom > bounds.top && tailBounds.bottom <= bounds.bottom + 2)
        const settled = viewport.clientHeight > 0 && tailVisible && Math.abs(viewport.scrollTop - maxTop) <= 2
        stableTailFrames = settled && previousTailHeight === viewport.scrollHeight ? stableTailFrames + 1 : 0
        previousTailHeight = viewport.scrollHeight
        if (stableTailFrames < 2) {
          if (!settled) {
            if (!tail && currentItems.length) scrollToItem(currentItems.length - 1, 'end', 'auto', isCurrent)
            else scrollToPosition({ top: maxTop, behavior: 'auto' })
          }
          nextFrame()
          return
        }
      }
      const acknowledge = () => {
        if (live.current.transcript.layout?.requestId !== layout.requestId) return
        applying.current = null
        if (scrollbarPointer.current && scroller.current)
          scrollbarPointer.current.scrollTop = scroller.current.scrollTop
        if (scroller.current)
          follow.syncScrollPosition(
            scroller.current.scrollTop,
            Math.max(0, scroller.current.scrollHeight - scroller.current.clientHeight)
          )
        controller.acknowledgeLayout(layout.requestId)
        contentAnchor.adopt(layout.kind === 'preserve' && 'offset' in layout.anchor ? layout.anchor : null)
      }
      if (layout.kind === 'tail' || ((layout.kind === 'anchor' || layout.kind === 'preserve') && index >= 0))
        acknowledge()
      else layoutFrame.current = requestAnimationFrame(acknowledge)
    }
    layoutFrame.current = requestAnimationFrame(finish)
  }, [controller, follow, messageElement, contentAnchor, scrollByGeometry, scrollToPosition, scrollToItem])
  useLayoutEffect(() => {
    applyLayout()
  }, [transcript.layout, items, applyLayout])
  useEffect(
    () => () => {
      if (layoutFrame.current !== null) cancelAnimationFrame(layoutFrame.current)
    },
    []
  )
  useEffect(() => {
    const release = (event: PointerEvent) => {
      if (scrollbarPointer.current?.pointerId === event.pointerId) scrollbarPointer.current = null
    }
    document.addEventListener('pointerup', release)
    document.addEventListener('pointercancel', release)
    return () => {
      scrollbarPointer.current = null
      document.removeEventListener('pointerup', release)
      document.removeEventListener('pointercancel', release)
    }
  }, [])
  const loadAtEdge = useCallback(
    (direction: 'older' | 'newer') => {
      synchronizeBrowseIntent()
      if (userDirection.current !== direction || !progress.current) return
      const state = controller.getSnapshot()
      if (state.operation || state.layout) return
      if (direction === 'older' && state.hasOlder) void controller.loadOlder(progress.current)
      if (direction === 'newer' && state.hasNewer) void controller.loadNewer(progress.current)
    },
    [controller, synchronizeBrowseIntent]
  )
  const onScroll = useCallback(() => {
    synchronizeBrowseIntent()
    const element = scroller.current
    if (!element) return
    reportedScrollTop.current = element.scrollTop
    const pointer = scrollbarPointer.current
    const delta = pointer ? element.scrollTop - pointer.scrollTop : 0
    if (pointer) pointer.scrollTop = element.scrollTop
    if (delta && controller.getSnapshot().layout) userInput(delta)
    if (controller.getSnapshot().layout) {
      contentAnchor.onScroll()
      return
    }
    if (delta) {
      progress.current++
      userDirection.current = delta < 0 ? 'older' : 'newer'
      if (delta < 0) follow.pause()
    }
    follow.handleScroll(element.scrollTop, Math.max(0, element.scrollHeight - element.clientHeight))
    const maxScrollTop = element.scrollHeight - element.clientHeight
    if (maxScrollTop - element.scrollTop >= 0) handleScrollTopThrottled(element.scrollTop, maxScrollTop)
    contentAnchor.onScroll()
    if (element.scrollTop < 160) loadAtEdge('older')
    if (element.scrollHeight - element.clientHeight - element.scrollTop < 160) loadAtEdge('newer')
  }, [controller, follow, loadAtEdge, contentAnchor, userInput, synchronizeBrowseIntent, handleScrollTopThrottled])
  useEffect(() => {
    if (transcript.firstWindowReady && transcript.hasNewer && follow.isFollowing() && !transcript.operation)
      navigate('tail')
  }, [transcript.firstWindowReady, transcript.hasNewer, transcript.operation, navigate, follow])
  const previousRowCount = useRef(transcript.rows.length)
  useLayoutEffect(() => {
    if (!transcript.layout && isNewMessage && transcript.rows.length > previousRowCount.current) {
      const index = items.findIndex((item) => item.messages[0]?.id === headerRead.summary.lastUserMessageId)
      if (index >= 0) {
        follow.pause()
        if (virtuoso.current && scroller.current) scrollToItem(index)
      }
    }
    previousRowCount.current = transcript.rows.length
  }, [
    transcript.rows,
    transcript.layout,
    items,
    isNewMessage,
    headerRead.summary.lastUserMessageId,
    follow,
    scrollToItem,
  ])
  const jumpUser = useCallback(
    (direction: 'older' | 'newer') => {
      const state = controller.getSnapshot()
      if (!state.firstWindowReady || (state.operation && state.operation.phase !== 'error') || state.layout) return
      const anchor = captureAnchor()
      const current = state.rows.findIndex((row) => row.messageId === anchor?.messageId)
      if (current < 0) return
      const currentRow = state.rows[current]
      const currentElement = messageElement(currentRow.messageId)
      const currentTop =
        currentElement && scroller.current
          ? currentElement.getBoundingClientRect().top - scroller.current.getBoundingClientRect().top
          : 0
      const includeCurrent = direction === 'older' && currentTop < -1
      const candidates =
        direction === 'older'
          ? state.rows.slice(0, current + (includeCurrent ? 1 : 0)).reverse()
          : state.rows.slice(current + 1)
      const target = candidates.find((row) => row.message.role === 'user' && !row.message.isSummary)
      if (!target) return
      const index = live.current.items.findIndex((item) =>
        item.messages.some((message) => message.id === target.messageId)
      )
      if (index < 0) return
      follow.pause()
      userDirection.current = null
      touchY.current = null
      scrollbarPointer.current = null
      contentAnchor.onUserInput()
      setHighlighted(target.messageId)
      virtuoso.current?.scrollToIndex({ index, align: 'start', behavior: 'smooth' })
    },
    [captureAnchor, controller, follow, contentAnchor, messageElement]
  )
  const shouldConfirmPromptCacheDelete = useCallback(
    (messageId: string, target: PromptCacheDeleteTarget) =>
      rendererApplication.sessions.shouldConfirmPromptCacheDelete(session.id, messageId, target, {
        mode: sessionMode,
        maxContextMessageCount: session.settings?.maxContextMessageCount ?? globalMaxContextMessageCount,
      }),
    [session.id, session.settings?.maxContextMessageCount, sessionMode, globalMaxContextMessageCount]
  )
  const renderMessage = (message: SessionMessage, first: boolean, last: boolean) => {
    const row = rowsById.get(message.id)!
    const thread = threadById.get(row.threadId)
    const showThread = showThreadLabels && row.messageId === thread?.rootMessageId
    const hidden = hideSystemPrompt && message.role === 'system'
    const spacing = first ? 'pt-4' : last ? '!pb-4' : ''
    return (
      <Stack key={message.id} gap={0} pt={message.role === 'user' ? 4 : 0} data-transcript-message={message.id}>
        {showThread && (
          <ThreadLabel
            sessionId={session.id}
            sessionMode={sessionMode}
            thread={{
              id: row.threadId,
              name: thread?.name ?? session.name,
              createdAtLabel:
                thread && thread.threadOrder >= 0 ? new Date(thread.createdAt).toLocaleString() : undefined,
            }}
          />
        )}
        {hidden ? (
          <div className={cn('h-px', spacing)} aria-hidden="true" />
        ) : (
          <ErrorBoundary name="message-item">
            {message.isForkMarker ? (
              <ForkMarkerMessage sourceSessionId={message.forkedFromSessionId} className={spacing} />
            ) : message.isSummary ? (
              <SummaryMessage
                msg={message}
                sessionId={session.id}
                sessionMode={sessionMode}
                className={spacing}
                isLatestSummary={message.id === headerRead.summary.lastSummaryMessageId}
                highlighted={message.id === highlighted}
                shouldConfirmPromptCacheDelete={shouldConfirmPromptCacheDelete}
                onDelete={
                  session.type === 'picture'
                    ? undefined
                    : () => {
                        const gate = getSessionActionGate('delete-summary', sessionLocks)
                        if (!gate.allowed) {
                          void notifySessionLockBlocked(gate.reason, t)
                          return
                        }
                        void removeMessage(session.id, message.id)
                      }
                }
              />
            ) : (
              <Message
                id={message.id}
                msg={message}
                sessionId={session.id}
                sessionType={session.type || 'chat'}
                readOnly={session.type === 'picture'}
                className={spacing}
                collapseThreshold={message.role === 'system' ? 150 : undefined}
                buttonGroup={last && message.role === 'assistant' ? 'always' : 'auto'}
                sessionLocks={sessionLocks}
                sessionMode={sessionMode}
                shouldConfirmPromptCacheDelete={shouldConfirmPromptCacheDelete}
                allowGeneratingStop
                assistantAvatarKey={session.assistantAvatarKey}
                sessionPicUrl={session.picUrl}
              />
            )}
          </ErrorBoundary>
        )}
        {row.fork && row.fork.count > 1 && (
          <ForkGroup
            sessionId={session.id}
            sessionType={session.type || 'chat'}
            msgId={message.id}
            fork={row.fork}
            liveMessages={controls.data?.cancellableMessages ?? []}
            sessionLocks={sessionLocks}
            sessionMode={sessionMode}
            assistantAvatarKey={session.assistantAvatarKey}
            sessionPicUrl={session.picUrl}
          />
        )}
      </Stack>
    )
  }
  // A failure is reported where it happened: at the list edge that failed to page, as the empty state when
  // nothing could be opened, or above the list for navigation. Retrying is the only way out of the error, so
  // the notice stays until it succeeds.
  const transcriptErrorAt = !transcript.error
    ? null
    : transcript.rows.length === 0
      ? 'open'
      : transcript.operation?.kind === 'older' || transcript.operation?.kind === 'newer'
        ? transcript.operation.kind
        : 'navigate'
  const transcriptErrorNotice = transcript.error && transcriptErrorAt && (
    <ErrorNotice icon="error">
      <Text fw={600} fz={14} lh="20px" c="chatbox-primary">
        {
          {
            open: t('This conversation could not be loaded'),
            older: t('Earlier messages could not be loaded'),
            newer: t('Later messages could not be loaded'),
            navigate: t('Some messages could not be loaded'),
          }[transcriptErrorAt]
        }
      </Text>
      <div className={errorNoticeClasses.details}>
        <div className={errorNoticeClasses.detailText}>{transcript.error.message}</div>
      </div>
      <button type="button" className={errorNoticeClasses.retry} onClick={() => void transcript.retry()}>
        {t('Try Again')}
        <IconReload size={14} />
      </button>
    </ErrorNotice>
  )
  return (
    <div className={cn('w-full h-full min-h-0 mx-auto flex flex-col', className)}>
      <BlockCodeCollapsedStateProvider defaultCollapsed={!!settingsStore.getState().autoCollapseCodeBlock}>
        {isSmallScreen && (
          <Transition mounted={showScrollToPrev && (!atTop || transcript.hasOlder)} transition="fade">
            {(transitionStyle) => (
              <Flex style={transitionStyle} className="shrink-0 leading-tight bg-chatbox-background-secondary">
                {[
                  { text: t('Return to the top'), icon: IconArrowBarToUp, onClick: () => navigate('head') },
                  { text: t('Back to previous message'), icon: IconArrowUp, onClick: () => void jumpUser('older') },
                ].map((item, index) => (
                  <Button
                    key={item.text}
                    variant="transparent"
                    className={cn('w-1/2', index === 0 ? 'border-r border-r-chatbox-border-primary' : '')}
                    classNames={{ section: '!mr-xxs' }}
                    size="xs"
                    h="auto"
                    py={6}
                    c="chatbox-tertiary"
                    onClick={item.onClick}
                    leftSection={<ScalableIcon icon={item.icon} size={16} />}
                  >
                    {item.text}
                  </Button>
                ))}
              </Flex>
            )}
          </Transition>
        )}
        {transcriptErrorAt === 'navigate' && (
          <div className={cn('shrink-0 py-2', !isSmallScreen && 'px-[28px]')}>
            <div className={paddedContentColumnClassName(widthFull)}>{transcriptErrorNotice}</div>
          </div>
        )}
        <div
          ref={container}
          data-session-id={session.id}
          data-session-view="rows"
          data-testid={TestId.chat.transcript}
          data-transcript-message-count={transcript.rows.length}
          data-transcript-page-count={transcript.pages.length}
          data-transcript-first-message-id={transcript.rows[0]?.messageId}
          data-transcript-last-message-id={transcript.rows.at(-1)?.messageId}
          data-transcript-window-epoch={transcript.windowEpoch}
          className={cn('overflow-hidden relative min-h-0 flex-1', !isSmallScreen && 'px-[28px]')}
          aria-busy={!!transcript.operation && transcript.operation.phase !== 'error'}
          onPointerDownCapture={(event) => {
            synchronizeBrowseIntent()
            const element = scroller.current
            if (event.pointerType === 'mouse' && event.button === 0 && element && event.target === element) {
              scrollbarPointer.current = { pointerId: event.pointerId, scrollTop: element.scrollTop }
              userInput()
            }
          }}
          onWheelCapture={(event) => {
            synchronizeBrowseIntent()
            userInput()
            progress.current++
            userDirection.current = event.deltaY < 0 ? 'older' : 'newer'
            if (event.deltaY < 0) follow.pause()
            onScroll()
          }}
          onTouchStartCapture={(event) => {
            synchronizeBrowseIntent()
            touchY.current = event.touches[0]?.clientY ?? null
            userInput()
          }}
          onTouchMoveCapture={(event) => {
            synchronizeBrowseIntent()
            const currentY = event.touches[0]?.clientY
            if (currentY === undefined || touchY.current === null || currentY === touchY.current) return
            const direction = currentY > touchY.current ? 'older' : 'newer'
            userInput()
            progress.current++
            userDirection.current = direction
            if (userDirection.current === 'older') follow.pause()
            touchY.current = currentY
            onScroll()
          }}
          onTouchEndCapture={() => {
            touchY.current = null
          }}
          onKeyDownCapture={(event) => {
            synchronizeBrowseIntent()
            if (['ArrowUp', 'PageUp', 'ArrowDown', 'PageDown'].includes(event.key)) {
              userInput()
              progress.current++
              userDirection.current = event.key.endsWith('Up') ? 'older' : 'newer'
              if (userDirection.current === 'older') follow.pause()
            }
          }}
        >
          {(items.length > 0 || transcript.operation?.phase !== 'reading') && (
            <Virtuoso
              key={`${session.id}:${transcript.windowEpoch}`}
              style={{
                scrollbarGutter: isSmallScreen ? 'auto' : 'stable both-edges',
                visibility: transcript.firstWindowReady ? undefined : 'hidden',
                opacity: transcript.firstWindowReady ? undefined : 0,
              }}
              className={platformType === 'win32' ? 'scrollbar-custom' : ''}
              ref={virtuoso}
              data={items}
              firstItemIndex={0}
              computeItemKey={(_, item) => item.key}
              followOutput={false}
              skipAnimationFrameInResizeObserver
              initialTopMostItemIndex={0}
              components={transcriptListComponents}
              context={{
                columnClassName: paddedContentColumnClassName(widthFull),
                olderNotice: transcriptErrorAt === 'older' ? transcriptErrorNotice : null,
                newerNotice: transcriptErrorAt === 'newer' ? transcriptErrorNotice : null,
              }}
              scrollerRef={(element) => {
                scroller.current = element instanceof HTMLElement ? element : null
                setViewportHeight(scroller.current?.clientHeight ?? 0)
                // Virtuoso attaches the scroller after this component's layout effects, and an empty list reports no range.
                if (scroller.current) applyLayout()
              }}
              onScroll={onScroll}
              startReached={() => loadAtEdge('older')}
              endReached={() => loadAtEdge('newer')}
              rangeChanged={applyLayout}
              totalListHeightChanged={(height) => {
                applyLayout()
                if (!controller.getSnapshot().layout) follow.handleHeightChange(height)
                const element = scroller.current
                if (element && pendingMeasurementScroll.current !== element) {
                  pendingMeasurementScroll.current = element
                  // ResizeObserver can adjust the native offset after this frame's scroll events.
                  // Publish the measured viewport before paint so the rendered range matches it.
                  queueMicrotask(() => {
                    if (pendingMeasurementScroll.current === element) pendingMeasurementScroll.current = null
                    if (scroller.current === element && element.scrollTop !== reportedScrollTop.current)
                      element.dispatchEvent(new Event('scroll'))
                  })
                }
              }}
              atBottomStateChange={(value) => {
                setAtBottom(value)
                if (!controller.getSnapshot().layout) follow.handleAtBottomChange(value)
                uiStore.getState().setMessageScrollingAtBottom(value && !controller.getSnapshot().hasNewer)
              }}
              atTopStateChange={(value) => {
                setAtTop(value)
                uiStore.getState().setMessageScrollingAtTop(value && !controller.getSnapshot().hasOlder)
              }}
              increaseViewportBy={{ top: viewportHeight, bottom: viewportHeight }}
              minOverscanItemCount={{ top: 3, bottom: 3 }}
              itemContent={(index, item) => (
                <div
                  className={contentColumnClassName(widthFull)}
                  ref={index === items.length - 1 ? lastItem : undefined}
                >
                  {item.type === 'thread' && (
                    <ThreadLabel
                      sessionId={session.id}
                      sessionMode={sessionMode}
                      thread={{
                        id: item.thread.threadId,
                        name: item.thread.name ?? session.name,
                        createdAtLabel:
                          item.thread.threadOrder >= 0 ? new Date(item.thread.createdAt).toLocaleString() : undefined,
                      }}
                    />
                  )}
                  <Stack
                    gap={0}
                    className={item.type === 'group' ? 'pt-5' : undefined}
                    style={
                      item.type === 'group' && isNewMessage && index === items.length - 1
                        ? { minHeight: viewportHeight * 0.85 }
                        : undefined
                    }
                  >
                    {item.messages.map((message, messageIndex) =>
                      renderMessage(
                        message,
                        index === 0 && messageIndex === 0,
                        index === items.length - 1 && messageIndex === item.messages.length - 1
                      )
                    )}
                  </Stack>
                </div>
              )}
            />
          )}
          {(transcript.isLoadingOlder || transcript.isLoadingNewer) && (
            <Loader className="absolute top-2 left-1/2" size="xs" />
          )}
          {transcriptErrorAt === 'open' && (
            <div className="absolute inset-0 flex overflow-y-auto px-md pb-16">
              <div className="m-auto w-full max-w-[560px]">{transcriptErrorNotice}</div>
            </div>
          )}
          {!isSmallScreen && transcript.firstWindowReady && (
            <TranscriptMinimap key={session.id} transcript={transcript} onNavigate={navigate} />
          )}
          {activity === 'generating' && (!atBottom || transcript.hasNewer) && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <Button
                w={40}
                h={40}
                p={0}
                radius="xl"
                bg="var(--chatbox-background-primary)"
                c="chatbox-secondary"
                className="border border-solid border-chatbox-border-primary shadow-lg"
                aria-label={t('Generating...')}
                onClick={() => navigate('tail')}
              >
                <Loading height={16} viewBox="0 0 38 24" aria-hidden="true" />
              </Button>
            </div>
          )}
          {!isSmallScreen ? (
            <MessageNavigation
              visible={showNavigation}
              onVisibleChange={setShowNavigation}
              onScrollToTop={() => navigate('head')}
              onScrollToBottom={() => navigate('tail')}
              onScrollToPrev={() => void jumpUser('older')}
              onScrollToNext={() => void jumpUser('newer')}
            />
          ) : (
            <Transition mounted={activity !== 'generating' && (!atBottom || transcript.hasNewer)} transition="slide-up">
              {(transitionStyle) => <ScrollToBottomButton onClick={() => navigate('tail')} style={transitionStyle} />}
            </Transition>
          )}
        </div>
      </BlockCodeCollapsedStateProvider>
    </div>
  )
})
export default memo(MessageList)

interface TranscriptListContext {
  columnClassName: string
  olderNotice: ReactNode
  newerNotice: ReactNode
}
// Chromium and Firefox keep the visible messages in place through CSS scroll anchoring, except at the very top
// where the row simply appears in view. WebKit has no scroll anchoring, so the row reproduces that behaviour.
const browserAnchorsScroll = typeof CSS !== 'undefined' && CSS.supports('overflow-anchor', 'auto')
/** A row above the messages that moves them only when the list is scrolled to the very top. */
function TranscriptHeadRow({ className, children }: { className: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = row.current
    const scroller = element?.closest<HTMLElement>('[data-virtuoso-scroller]')
    if (browserAnchorsScroll || !element || !scroller) return
    if (scroller.scrollTop > 0) scroller.scrollTop += element.offsetHeight
    return () => {
      if (scroller.scrollTop > 0) scroller.scrollTop -= element.offsetHeight
    }
  }, [])
  return (
    <div ref={row} className={className}>
      {children}
    </div>
  )
}
const transcriptListComponents = {
  Header: ({ context }: ContextProp<TranscriptListContext>) =>
    context.olderNotice ? (
      <TranscriptHeadRow className={cn(context.columnClassName, 'pt-4')}>{context.olderNotice}</TranscriptHeadRow>
    ) : null,
  Footer: ({ context }: ContextProp<TranscriptListContext>) =>
    context.newerNotice ? <div className={cn(context.columnClassName, 'pb-4')}>{context.newerNotice}</div> : null,
}

const TranscriptMinimap = memo(
  ({
    transcript,
    onNavigate,
  }: {
    transcript: Transcript
    onNavigate(origin: 'head' | 'tail' | { messageId: string }): void
  }) => {
    const previous = useRef<ReturnType<typeof buildMessageMinimapAnchors>>([])
    const anchors = useMemo(() => {
      const next = buildMessageMinimapAnchors(transcript.rows)
      if (areMinimapAnchorsEqual(previous.current, next)) return previous.current
      previous.current = next
      return next
    }, [transcript.rows])
    return (
      <MessageMinimapRail
        anchors={anchors}
        onJump={(anchor) => onNavigate({ messageId: anchor.messageId })}
        hasOlder={transcript.hasOlder}
        hasNewer={transcript.hasNewer}
        onLoadOlder={() => void transcript.controller.loadOlder()}
        onLoadNewer={() => void transcript.controller.loadNewer()}
        onEdge={onNavigate}
        loading={!!transcript.operation && transcript.operation.phase !== 'error'}
        error={transcript.error}
        onRetry={() => void transcript.retry()}
      />
    )
  }
)
type ThreadLabelProps = {
  sessionId: string
  sessionMode: SessionMode
  thread: Pick<SessionThreadBrief, 'id' | 'name' | 'createdAtLabel'>
}
const ThreadLabel: FC<ThreadLabelProps> = memo(({ thread, sessionId, sessionMode }) => {
  const { t } = useTranslation()
  const openSessionPanel = useUIStore((s) => s.openSessionPanel)

  const handleOpenHistoryDrawer = useCallback(() => {
    openSessionPanel(sessionId, 'threads')
  }, [openSessionPanel, sessionId])

  const handleEditThreadName = useCallback(async () => {
    if (!thread.id) return
    await NiceModal.show('thread-name-edit', { sessionId, threadId: thread.id })
  }, [sessionId, thread.id])

  const handleContinueThread = useCallback(() => {
    if (!thread.id) return
    void switchThread(sessionId, thread.id)
  }, [sessionId, thread.id])

  const handleMoveToConversations = useCallback(() => {
    if (!thread.id) return
    void moveThreadToConversations(sessionId, thread.id)
  }, [sessionId, thread.id])

  const handleDeleteThread = useCallback(() => {
    if (!thread.id) return
    return removeThread(sessionId, thread.id)
  }, [sessionId, thread.id])

  return (
    <div className="text-center pb-4 pt-8">
      <ActionMenu
        position="bottom"
        items={[
          {
            text: t('Edit Thread Name'),
            icon: IconPencil,
            onClick: handleEditThreadName,
          },
          {
            text: t('Show in Thread List'),
            icon: IconListTree,
            onClick: handleOpenHistoryDrawer,
          },
          ...(sessionMode === 'chat'
            ? [
                {
                  text: t('Continue this thread'),
                  icon: IconSwitch3,
                  onClick: handleContinueThread,
                },
                {
                  text: t('Move to Conversations'),
                  icon: IconMessagePlus,
                  onClick: handleMoveToConversations,
                },
                { divider: true as const },
                {
                  doubleCheck: true,
                  text: t('delete'),
                  icon: IconTrash,
                  onClick: handleDeleteThread,
                },
              ]
            : []),
        ]}
      >
        <span
          data-testid={TestId.message.threadLabel}
          className="cursor-pointer font-bold border-solid border rounded-xxl py-2 px-3 border-slate-400/25"
          onDoubleClick={handleOpenHistoryDrawer}
          // onClick={onClick}
        >
          <span className="pr-1 opacity-60">#</span>
          <span className="truncate inline-block align-bottom max-w-[calc(50%-4rem)] md:max-w-[calc(30%-4rem)]">
            {thread.name || t('New Thread')}
          </span>
          {thread.createdAtLabel && <span className="pl-1 opacity-60 text-xs">{thread.createdAtLabel}</span>}
        </span>
      </ActionMenu>
    </div>
  )
})
