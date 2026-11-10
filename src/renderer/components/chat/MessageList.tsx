import type { SessionHeaderRead } from '@chatbox/core/ports'
import { getSessionActionGate } from '@chatbox/core/session/action-gates'
import { isActionAvailableInMode, resolveSessionMode, type SessionMode } from '@chatbox/core/session/mode-policy'
import type { PromptCacheDeleteTarget } from '@chatbox/core/session/prompt-cache-policy'
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
  Fragment,
  forwardRef,
  memo,
  type ReactNode,
  type UIEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { type ContextProp, type FlatScrollIntoViewLocation, Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { rendererApplication } from '@/app/renderer-application'
import { contentColumnClassName, paddedContentColumnClassName } from '@/components/layout/contentColumn'
import { useMyCopilots } from '@/hooks/useCopilots'
import { platformTypeAtom } from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSessionControls } from '@/hooks/useSessionLockState'
import type { useSessionTranscript } from '@/hooks/useSessionPresentation'
import { cn } from '@/lib/utils'
import platform from '@/platform'
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
import MessageNavigation, { FLOATING_BUTTON_GLASS_PROPS, ScrollToBottomButton } from './MessageNavigation'
import { getSessionAssistantName } from './message-header'
import { areMinimapAnchorsEqual, buildMessageMinimapAnchors } from './message-navigation-utils'
import { buildTranscriptRenderItems } from './message-render-items'
import SummaryMessage from './SummaryMessage'
import { createSendFollowIntent, sendFromHistoryFollowsTail } from './send-follow-intent'
import { getTranscriptFirstItemIndex, getTranscriptItemLocation } from './transcript-virtuoso-position'

type Transcript = ReturnType<typeof useSessionTranscript>
const followOutputToBottom = () => 'auto' as const

export interface MessageListRef {
  scrollToTop(): void
  scrollToBottom(): void
  /**
   * Captures, at send time, whether the send should follow the tail. Mobile layouts always follow; wide layouts follow
   * only when the user is at the tail (or has just asked for it) and return null while reading history. The returned
   * check turns false once the user browses away.
   */
  captureSendFollow(): (() => boolean) | null
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
  const { copilots } = useMyCopilots()
  const assistantName = getSessionAssistantName(session, copilots)
  const controls = useSessionControls(session, session.id)
  const sessionLocks = controls.locks
  const hideSystemPrompt = hideSystemPromptSetting || !isActionAvailableInMode('session-system-prompt', sessionMode)
  const container = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLElement | null>(null)
  const virtuoso = useRef<VirtuosoHandle>(null)
  const owner = useMemo(() => Symbol(session.id), [session.id])
  const { threads: sessionThreads, hasNextPage: moreSessionThreads } =
    rendererApplication.sessionHooks.useSessionThreads(session.id, {
      enabled: transcript.firstWindowReady,
    })
  // Empty archived thread rows are not visible threads, so they never make a single thread look like several.
  // Unloaded summary pages may still hold a visible thread, so a partial list is judged by its row count.
  const showThreadLabels = moreSessionThreads
    ? sessionThreads.length > 1
    : sessionThreads.filter((thread) => thread.rootMessageId !== null || thread.threadOrder < 0).length > 1
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
  const scrollNavigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigationBar = useRef<HTMLDivElement | null>(null)
  useEffect(
    () => () => {
      if (scrollNavigationTimer.current) clearTimeout(scrollNavigationTimer.current)
    },
    []
  )
  const hideScrollNavigation = useCallback(() => {
    if (scrollNavigationTimer.current) {
      clearTimeout(scrollNavigationTimer.current)
      scrollNavigationTimer.current = null
    }
    lastScrollTop.current = undefined
    setShowScrollToPrev(false)
  }, [])
  // An explicit jump places its target at the top of the list, where the small-screen bar would cover it.
  const positioningExplicitTarget = useCallback(() => {
    const layout = controller.getSnapshot().layout
    return !!layout && layout.kind !== 'preserve'
  }, [controller])
  useLayoutEffect(
    () =>
      controller.subscribe(() => {
        if (positioningExplicitTarget()) hideScrollNavigation()
      }),
    [controller, positioningExplicitTarget, hideScrollNavigation]
  )
  const handleScrollTopThrottled = useThrottledCallback((scrollTop: number) => {
    if (positioningExplicitTarget()) {
      hideScrollNavigation()
      return
    }
    if (typeof lastScrollTop.current === 'number') {
      if (scrollNavigationTimer.current) {
        clearTimeout(scrollNavigationTimer.current)
        scrollNavigationTimer.current = null
      }
      if (scrollTop > 0 && scrollTop < lastScrollTop.current) {
        setShowScrollToPrev(true)
        scrollNavigationTimer.current = setTimeout(() => setShowScrollToPrev(false), 3000)
      } else {
        setShowScrollToPrev(false)
      }
    }
    lastScrollTop.current = scrollTop
  }, 256)
  const [showNavigation, setShowNavigation] = useState(false)
  const progress = useRef(0)
  const observedScrollTop = useMemo(() => ({ current: 0 }), [controller])
  const userDirection = useRef<'older' | 'newer' | null>(null)
  const touchY = useRef<number | null>(null)
  const scrolling = useMemo(
    () => ({ current: false, settleTimer: null as ReturnType<typeof setTimeout> | null }),
    [controller, transcript.windowEpoch]
  )
  useEffect(
    () => () => {
      if (scrolling.settleTimer !== null) clearTimeout(scrolling.settleTimer)
    },
    [scrolling]
  )
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
  const [position, setPosition] = useState(() => ({
    epoch: transcript.windowEpoch,
    items,
    firstItemIndex: 1_000_000,
    initialLocation: getTranscriptItemLocation(items, transcript.layout),
    initialRequestId: transcript.layout?.requestId,
  }))
  if (position.items !== items || position.epoch !== transcript.windowEpoch) {
    const newWindow = position.epoch !== transcript.windowEpoch
    setPosition({
      epoch: transcript.windowEpoch,
      items,
      firstItemIndex: newWindow
        ? 1_000_000
        : getTranscriptFirstItemIndex(position.items, items, position.firstItemIndex),
      initialLocation: newWindow ? getTranscriptItemLocation(items, transcript.layout) : position.initialLocation,
      initialRequestId: newWindow ? transcript.layout?.requestId : position.initialRequestId,
    })
  }
  const atBottomRef = useMemo(() => ({ current: false }), [controller])
  const measuredEpoch = useRef<number | null>(null)
  const positionedRequest = useRef<number | null>(null)
  const scrollToItem = useCallback(
    (index: number, align: 'start' | 'end' | 'center' = 'start', behavior: 'auto' | 'smooth' = 'auto') => {
      virtuoso.current?.scrollToIndex({ index, align, behavior })
    },
    []
  )
  const sendFollowIntent = useMemo(createSendFollowIntent, [controller])
  const [followOutput, setFollowOutputState] = useState(false)
  const followOutputRef = useMemo(() => ({ current: false }), [controller])
  const branchFollow = useMemo(() => ({ paused: false, operationId: 0, downwardScroll: false }), [controller])
  const setFollowOutput = useCallback(
    (value: boolean) => {
      followOutputRef.current = value
      setFollowOutputState(value)
    },
    [followOutputRef]
  )
  const followChangedRowsToBottom = useCallback(
    ({ totalCount }: { totalCount: number }): FlatScrollIntoViewLocation => ({
      index: totalCount - 1,
      align: 'end',
      behavior: 'auto',
      // Virtuoso may wait for a measurement; a newer user scroll must cancel that pending tail request.
      calculateViewLocation: ({ locationParams }) =>
        followOutputRef.current && !branchFollow.paused && !controller.getSnapshot().hasNewer ? locationParams : null,
    }),
    [branchFollow, controller, followOutputRef]
  )
  useLayoutEffect(() => {
    if (transcript.hasNewer) setFollowOutput(false)
  }, [transcript.hasNewer, setFollowOutput])
  const leaveTail = useCallback(() => {
    sendFollowIntent.leaveTail()
    atBottomRef.current = false
    if (controller.getSnapshot().operation?.branchMode === 'create') branchFollow.paused = true
    branchFollow.downwardScroll = false
    setFollowOutput(false)
  }, [atBottomRef, branchFollow, controller, sendFollowIntent, setFollowOutput])
  useLayoutEffect(() => {
    const synchronizeBranchFollow = () => {
      const state = controller.getSnapshot()
      const operation = state.operation
      if (operation?.kind !== 'branch') return
      const operationId = operation.branchOperationId ?? operation.requestId
      if (branchFollow.operationId === operationId) return
      // Branch creation announces itself before replacing rows, so a shorter reply cannot turn history into tail intent.
      const followCreatedBranch =
        operation.branchMode === 'create' && !state.hasNewer && (followOutputRef.current || atBottomRef.current)
      branchFollow.operationId = operationId
      branchFollow.paused = !followCreatedBranch
      branchFollow.downwardScroll = false
      observedScrollTop.current = scroller.current?.scrollTop ?? 0
      sendFollowIntent.leaveTail()
      if (followCreatedBranch) sendFollowIntent.requestTail()
      setFollowOutput(followCreatedBranch)
    }
    synchronizeBranchFollow()
    const unsubscribe = controller.subscribe(synchronizeBranchFollow)
    return () => {
      unsubscribe()
      sendFollowIntent.leaveTail()
    }
  }, [atBottomRef, branchFollow, controller, followOutputRef, observedScrollTop, sendFollowIntent, setFollowOutput])
  const resumeTailAfterUserScroll = useCallback(() => {
    if (!branchFollow.paused || !branchFollow.downwardScroll || !atBottomRef.current) return
    const state = controller.getSnapshot()
    if (state.hasNewer || state.operation) return
    branchFollow.paused = false
    branchFollow.downwardScroll = false
    setFollowOutput(true)
  }, [atBottomRef, branchFollow, controller, setFollowOutput])
  useEffect(() => {
    if (!highlighted) return
    const timer = setTimeout(() => setHighlighted(null), 2500)
    return () => clearTimeout(timer)
  }, [highlighted])

  const navigate = useCallback(
    (origin: 'head' | 'tail' | { messageId: string }) => {
      if (origin === 'tail') {
        branchFollow.paused = false
        branchFollow.downwardScroll = false
        sendFollowIntent.requestTail()
        setFollowOutput(true)
      } else leaveTail()
      if (typeof origin === 'object') setHighlighted(origin.messageId)
      return controller.navigate(origin)
    },
    [branchFollow, controller, leaveTail, sendFollowIntent, setFollowOutput]
  )
  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: () => {
        void navigate('head')
      },
      scrollToBottom: () => {
        void navigate('tail')
      },
      captureSendFollow: () => {
        if (sendFromHistoryFollowsTail({ platformType: platform.type, isSmallScreen }))
          return sendFollowIntent.capture(true)
        const state = controller.getSnapshot()
        const atTail =
          (followOutputRef.current || atBottomRef.current) &&
          !state.hasNewer &&
          state.operation?.kind !== 'branch' &&
          (!state.layout || state.layout.kind === 'tail')
        return sendFollowIntent.capture(atTail)
      },
      scrollToMessage: (messageId) => navigate({ messageId }),
      setIsNewMessage,
    }),
    [atBottomRef, controller, followOutputRef, isSmallScreen, navigate, sendFollowIntent]
  )
  useEffect(() => {
    uiStore.getState().setMessageListElement(container)
    uiStore.getState().setTranscriptNavigation({
      owner,
      sessionId: session.id,
      navigateMessage: async (messageId) => {
        leaveTail()
        setHighlighted(messageId)
        return controller.navigate({ messageId })
      },
      openSearch: async (messageId) => {
        leaveTail()
        setHighlighted(messageId)
        return controller.openSearch(messageId)
      },
      viewThread: async (threadId) => {
        leaveTail()
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
  }, [owner, session.id, controller, leaveTail, navigate, scrollToItem])

  const userInput = useCallback(() => {
    const state = controller.getSnapshot()
    if (state.layout && state.firstWindowReady) controller.cancelLayout(state.layout.requestId)
  }, [controller])
  const applyLayout = useCallback(() => {
    const state = live.current.transcript
    const layout = state.layout
    if (!layout || !virtuoso.current) return
    if (
      layout.kind !== 'preserve' &&
      layout.requestId !== position.initialRequestId &&
      positionedRequest.current !== layout.requestId
    ) {
      positionedRequest.current = layout.requestId
      virtuoso.current.scrollToIndex(getTranscriptItemLocation(live.current.items, layout))
    }
    if (!live.current.items.length || measuredEpoch.current === state.windowEpoch)
      controller.acknowledgeLayout(layout.requestId)
  }, [controller, position.initialRequestId])
  useLayoutEffect(() => {
    applyLayout()
  }, [transcript.layout, items, applyLayout])
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
      // iOS touch scrolling can overwrite Virtuoso's prepend compensation on the next native scroll event.
      if (platformType === 'ios' && (scrolling.current || scrolling.settleTimer !== null || touchY.current !== null))
        return
      const element = scroller.current
      if (
        platformType === 'ios' &&
        element &&
        (element.scrollTop < 0 || element.scrollTop > Math.max(0, element.scrollHeight - element.clientHeight))
      )
        return
      const state = controller.getSnapshot()
      if (state.operation || state.layout) return
      if (direction === 'older' && state.hasOlder) void controller.loadOlder(progress.current)
      if (direction === 'newer' && state.hasNewer) void controller.loadNewer(progress.current)
    },
    [controller, platformType, scrolling, synchronizeBrowseIntent]
  )
  const onScroll = useCallback(
    (event?: UIEvent): void => {
      synchronizeBrowseIntent()
      const element = scroller.current
      if (!element) return
      if (event && platformType === 'ios') {
        // A final native bounce event can arrive after Virtuoso reports idle. Wait for that event to settle
        // before paging; Virtuoso normalizes negative offsets, so it may not emit another idle transition.
        if (scrolling.settleTimer !== null) clearTimeout(scrolling.settleTimer)
        scrolling.settleTimer = setTimeout(() => {
          scrolling.settleTimer = null
          onScroll()
        }, 120)
      }
      const scrolledDown = element.scrollTop > observedScrollTop.current
      observedScrollTop.current = element.scrollTop
      const pointer = scrollbarPointer.current
      const delta = pointer ? element.scrollTop - pointer.scrollTop : 0
      if (pointer) pointer.scrollTop = element.scrollTop
      if (delta && controller.getSnapshot().layout) userInput()
      if (controller.getSnapshot().layout) return
      if (delta) {
        progress.current++
        userDirection.current = delta < 0 ? 'older' : 'newer'
        if (delta < 0) leaveTail()
      }
      if (event && scrolledDown && userDirection.current === 'newer' && !controller.getSnapshot().operation) {
        branchFollow.downwardScroll = true
      }
      const maxScrollTop = element.scrollHeight - element.clientHeight
      if (maxScrollTop - element.scrollTop >= 0) handleScrollTopThrottled(element.scrollTop)
      if (element.scrollTop < 512) loadAtEdge('older')
      if (element.scrollHeight - element.clientHeight - element.scrollTop < 512) loadAtEdge('newer')
    },
    [
      branchFollow,
      controller,
      leaveTail,
      loadAtEdge,
      observedScrollTop,
      platformType,
      scrolling,
      userInput,
      synchronizeBrowseIntent,
      handleScrollTopThrottled,
    ]
  )
  const previousRowCount = useRef(transcript.rows.length)
  useLayoutEffect(() => {
    if (!transcript.layout && isNewMessage && transcript.rows.length > previousRowCount.current) {
      const index = items.findIndex((item) => item.messages[0]?.id === headerRead.summary.lastUserMessageId)
      if (index >= 0) {
        setFollowOutput(false)
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
    scrollToItem,
    setFollowOutput,
  ])
  const jumpUser = useCallback(
    (direction: 'older' | 'newer') => {
      const state = controller.getSnapshot()
      if (!state.firstWindowReady || (state.operation && state.operation.phase !== 'error') || state.layout) return
      const viewport = scroller.current?.getBoundingClientRect()
      if (!viewport) return
      // Virtuoso also renders overscan rows. Navigation starts from a message currently inside the viewport.
      const visibleMessageId = Array.from(
        container.current?.querySelectorAll<HTMLElement>('[data-transcript-message]') ?? []
      ).find((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.bottom > viewport.top && bounds.top < viewport.bottom
      })?.dataset.transcriptMessage
      const current = state.rows.findIndex((row) => row.messageId === visibleMessageId)
      if (current < 0) return
      const candidates = direction === 'older' ? state.rows.slice(0, current).reverse() : state.rows.slice(current + 1)
      const target = candidates.find((row) => row.message.role === 'user' && !row.message.isSummary)
      if (!target) return
      const index = live.current.items.findIndex((item) =>
        item.messages.some((message) => message.id === target.messageId)
      )
      if (index < 0) return
      leaveTail()
      userDirection.current = null
      touchY.current = null
      scrollbarPointer.current = null
      setHighlighted(target.messageId)
      // The small-screen navigation bar overlays the top of the list; land the message below it.
      const barHeight = navigationBar.current?.offsetHeight
      virtuoso.current?.scrollToIndex({
        index,
        align: 'start',
        behavior: 'smooth',
        ...(barHeight ? { offset: -barHeight } : {}),
      })
    },
    [controller, leaveTail]
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
    // Small screens let each message own the 20px gap above it; wide layouts add space around user turns here.
    return (
      <Stack
        key={message.id}
        gap={0}
        pt={message.role === 'user' && !isSmallScreen ? 4 : 0}
        data-transcript-message={message.id}
      >
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
                assistantName={assistantName}
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
            assistantName={assistantName}
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
  const followingTail =
    followOutput &&
    followOutputRef.current &&
    !branchFollow.paused &&
    (transcript.operation?.kind !== 'branch' || transcript.operation.branchMode === 'create') &&
    !transcript.hasNewer
  // Followed content briefly leaves the physical bottom on every growth until Virtuoso scrolls it back.
  const showReturnToTail = transcript.hasNewer || (!atBottom && !followingTail)
  return (
    <div className={cn('w-full h-full min-h-0 mx-auto flex flex-col', className)}>
      <BlockCodeCollapsedStateProvider defaultCollapsed={!!settingsStore.getState().autoCollapseCodeBlock}>
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
              observedScrollTop.current = element.scrollTop
              scrollbarPointer.current = { pointerId: event.pointerId, scrollTop: element.scrollTop }
              userInput()
            }
          }}
          onWheelCapture={(event) => {
            if (event.deltaY === 0) return
            synchronizeBrowseIntent()
            userInput()
            progress.current++
            userDirection.current = event.deltaY < 0 ? 'older' : 'newer'
            if (event.deltaY < 0) leaveTail()
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
            if (userDirection.current === 'older') leaveTail()
            touchY.current = currentY
            onScroll()
          }}
          onTouchEndCapture={(event) => {
            touchY.current = event.touches[0]?.clientY ?? null
            if (platformType === 'ios' && !scrolling.current) onScroll()
          }}
          onTouchCancelCapture={(event) => {
            touchY.current = event.touches[0]?.clientY ?? null
            if (platformType === 'ios' && !scrolling.current) onScroll()
          }}
          onKeyDownCapture={(event) => {
            synchronizeBrowseIntent()
            if (['ArrowUp', 'PageUp', 'ArrowDown', 'PageDown'].includes(event.key)) {
              observedScrollTop.current = scroller.current?.scrollTop ?? 0
              userInput()
              progress.current++
              userDirection.current = event.key.endsWith('Up') ? 'older' : 'newer'
              if (userDirection.current === 'older') leaveTail()
            }
          }}
        >
          {isSmallScreen && (
            <Transition mounted={showScrollToPrev && !atTop} transition="fade">
              {(transitionStyle) => (
                <div
                  ref={navigationBar}
                  style={transitionStyle}
                  className="pointer-events-none absolute z-10 top-0 left-0 right-0 flex justify-center px-3 pt-2"
                >
                  <Flex
                    align="center"
                    className="pointer-events-auto max-w-full rounded-full border border-solid border-chatbox-border-primary bg-[color-mix(in_srgb,var(--chatbox-background-primary)_82%,transparent)] px-1 leading-tight shadow-sm backdrop-blur-md"
                  >
                    {[
                      { text: t('Return to the top'), icon: IconArrowBarToUp, onClick: () => navigate('head') },
                      {
                        text: t('Back to previous message'),
                        icon: IconArrowUp,
                        onClick: () => void jumpUser('older'),
                      },
                    ].map((item, index) => (
                      <Fragment key={item.text}>
                        {index > 0 && (
                          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-chatbox-border-primary" />
                        )}
                        <Button
                          variant="transparent"
                          className="min-w-0"
                          classNames={{ section: '!mr-xxs' }}
                          size="xs"
                          h={44}
                          px={12}
                          c="chatbox-tertiary"
                          onClick={item.onClick}
                          leftSection={<ScalableIcon icon={item.icon} size={16} />}
                        >
                          {item.text}
                        </Button>
                      </Fragment>
                    ))}
                  </Flex>
                </div>
              )}
            </Transition>
          )}
          {(transcript.firstWindowReady || items.length > 0 || transcript.operation?.phase !== 'reading') && (
            <div className="chatbox-scroll-top-fade h-full">
              <Virtuoso
                key={`${session.id}:${transcript.windowEpoch}`}
                style={{
                  scrollbarGutter: isSmallScreen ? 'auto' : 'stable both-edges',
                  visibility: transcript.firstWindowReady ? undefined : 'hidden',
                  opacity: transcript.firstWindowReady ? undefined : 0,
                }}
                className={cn('chatbox-scroll-bottom-fade', platformType === 'win32' && 'scrollbar-custom')}
                ref={virtuoso}
                data={items}
                firstItemIndex={position.firstItemIndex}
                computeItemKey={(_, item) => item.key}
                followOutput={followingTail ? followOutputToBottom : false}
                // Editing can replace rows without changing their count. Let Virtuoso restore the tail after measuring them.
                scrollIntoViewOnChange={followingTail ? followChangedRowsToBottom : undefined}
                skipAnimationFrameInResizeObserver
                initialTopMostItemIndex={position.initialLocation}
                components={transcriptListComponents}
                context={{
                  columnClassName: paddedContentColumnClassName(widthFull),
                  hasOlder: transcript.hasOlder,
                  hasNewer: transcript.hasNewer,
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
                isScrolling={(value) => {
                  scrolling.current = value
                  if (!value && platformType === 'ios') onScroll()
                }}
                startReached={() => loadAtEdge('older')}
                endReached={() => loadAtEdge('newer')}
                itemsRendered={(renderedItems) => {
                  if (renderedItems.some((item) => item.size > 0)) {
                    measuredEpoch.current = transcript.windowEpoch
                    applyLayout()
                  }
                }}
                atBottomStateChange={(value) => {
                  setAtBottom(value)
                  atBottomRef.current = value
                  const state = controller.getSnapshot()
                  if (value) {
                    if (branchFollow.paused) resumeTailAfterUserScroll()
                    else
                      setFollowOutput(
                        !state.hasNewer &&
                          state.operation?.kind !== 'newer' &&
                          (state.operation?.kind !== 'branch' || state.operation.branchMode === 'create')
                      )
                  }
                  uiStore.getState().setMessageScrollingAtBottom(value && !state.hasNewer)
                }}
                atTopStateChange={(value) => {
                  setAtTop(value)
                  uiStore.getState().setMessageScrollingAtTop(value && !controller.getSnapshot().hasOlder)
                }}
                increaseViewportBy={{ top: viewportHeight, bottom: viewportHeight }}
                minOverscanItemCount={{ top: 3, bottom: 3 }}
                itemContent={(index, item) => (
                  <div className={contentColumnClassName(widthFull)}>
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
                      className={item.type === 'group' && !isSmallScreen ? 'pt-5' : undefined}
                      style={
                        item.type === 'group' && isNewMessage && index === position.firstItemIndex + items.length - 1
                          ? { minHeight: viewportHeight * 0.85 }
                          : undefined
                      }
                    >
                      {item.messages.map((message, messageIndex) =>
                        renderMessage(
                          message,
                          index === position.firstItemIndex && messageIndex === 0,
                          index === position.firstItemIndex + items.length - 1 &&
                            messageIndex === item.messages.length - 1
                        )
                      )}
                    </Stack>
                  </div>
                )}
              />
            </div>
          )}
          {transcriptErrorAt === 'open' && (
            <div className="absolute inset-0 flex overflow-y-auto px-md pb-16">
              <div className="m-auto w-full max-w-[560px]">{transcriptErrorNotice}</div>
            </div>
          )}
          {!isSmallScreen && transcript.firstWindowReady && (
            <TranscriptMinimap key={session.id} transcript={transcript} onNavigate={navigate} />
          )}
          {activity === 'generating' && showReturnToTail && (
            <div
              className={cn(
                'absolute left-1/2 -translate-x-1/2',
                atBottom && transcript.hasNewer ? 'bottom-14' : 'bottom-4'
              )}
            >
              <Button
                w={40}
                h={40}
                p={0}
                radius="xl"
                c="chatbox-secondary"
                className={cn(
                  'border border-solid border-chatbox-border-primary shadow-lg',
                  FLOATING_BUTTON_GLASS_PROPS.className
                )}
                style={FLOATING_BUTTON_GLASS_PROPS.style}
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
            <Transition mounted={activity !== 'generating' && showReturnToTail} transition="slide-up">
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
  hasOlder: boolean
  hasNewer: boolean
  olderNotice: ReactNode
  newerNotice: ReactNode
}
function TranscriptEdgeLoading({ hasMore }: { hasMore: boolean }) {
  const { t } = useTranslation()
  const [keepSpace, setKeepSpace] = useState(hasMore)
  if (hasMore && !keepSpace) setKeepSpace(true)
  // Keep the edge's height after its final page so removing the indicator cannot shift the reading position.
  // A newly navigated window mounts its own edge components.
  if (!keepSpace && !hasMore) return null
  return (
    <div className="h-10">
      {hasMore && (
        <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-chatbox-tint-tertiary">
          <Loader size="xs" aria-hidden="true" />
          <span>{t('Loading...')}</span>
        </div>
      )}
    </div>
  )
}
const transcriptListComponents = {
  Header: ({ context }: ContextProp<TranscriptListContext>) =>
    context.olderNotice ? (
      <div className={cn(context.columnClassName, 'pt-4')}>{context.olderNotice}</div>
    ) : (
      <TranscriptEdgeLoading hasMore={context.hasOlder} />
    ),
  Footer: ({ context }: ContextProp<TranscriptListContext>) =>
    context.newerNotice ? (
      <div className={cn(context.columnClassName, 'pb-4')}>{context.newerNotice}</div>
    ) : (
      // Keep the last message clear of the 12px bottom fade, including windows that need no pagination indicator.
      <div className="min-h-3">
        <TranscriptEdgeLoading hasMore={context.hasNewer} />
      </div>
    ),
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
