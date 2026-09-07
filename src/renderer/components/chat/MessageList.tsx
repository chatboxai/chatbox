import { type CurrentThreadTarget, getCurrentThreadTarget } from '@chatbox/core/application/session'
import type { SessionTranscript } from '@chatbox/core/ports'
import { getSessionActionGate } from '@chatbox/core/session/action-gates'
import {
  isActionAvailableInMode,
  isThreadHistoryAvailable,
  resolveSessionMode,
  type SessionMode,
} from '@chatbox/core/session/mode-policy'
import {
  type PromptCacheDeleteTarget,
  shouldConfirmPromptCacheBreakForDelete,
} from '@chatbox/core/session/prompt-cache-policy'
import NiceModal from '@ebay/nice-modal-react'
import { Button, Flex, Loader, Stack, Transition } from '@mantine/core'
import { useThrottledCallback } from '@mantine/hooks'
import { TestId } from '@shared/automation/testids'
import type { Session, Message as SessionMessage, SessionThreadBrief } from '@shared/types'
import {
  IconArrowBarToUp,
  IconArrowUp,
  IconListTree,
  IconMessagePlus,
  IconPencil,
  IconSwitch3,
  IconTrash,
} from '@tabler/icons-react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  type FC,
  forwardRef,
  memo,
  type UIEventHandler,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { type StateSnapshot, Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { buildMessageRenderItems, type MessageRenderItem } from '@/components/chat/message-render-items'
import { platformTypeAtom } from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSessionLockState } from '@/hooks/useSessionLockState'
import { cn } from '@/lib/utils'
import platform from '@/platform'
import * as atoms from '@/stores/atoms'
import { getSessionAgentModeEntry } from '@/stores/session/agent-mode'
import { removeMessage } from '@/stores/session/messages'
import { moveThreadToConversations, removeThread, switchThread } from '@/stores/session/threads'
import { getAllMessageList, getCurrentThreadHistoryHash } from '@/stores/sessionHelpers'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { type TranscriptNavigation, uiStore, useUIStore } from '@/stores/uiStore'
import { evaluatePromptCacheDeleteContext } from '@/utils/prompt-cache-confirm'
import { notifySessionLockBlocked } from '@/utils/session-lock-copy'
import ActionMenu from '../ActionMenu'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { ScalableIcon } from '../common/ScalableIcon'
import { BlockCodeCollapsedStateProvider } from '../Markdown'
import ForkGroup from './ForkGroup'
import ForkMarkerMessage from './ForkMarkerMessage'
import Message from './Message'
import MessageMinimapRail, { type MessageMinimapAnchor } from './MessageMinimapRail'
import MessageNavigation, { ScrollToBottomButton } from './MessageNavigation'
import {
  areMinimapAnchorsEqual,
  canReuseMinimapAnchorsDuringGeneration,
  getMessagePreviewText,
  isUserNavigationMessage,
} from './message-navigation-utils'
import SummaryMessage from './SummaryMessage'
import { createSmoothFollowOutputController, isLayoutClampedScroll } from './smooth-follow-output'
import {
  boundedWindowSnapshot,
  clearWindowScrollPosition,
  createWindowScrollKey,
  discardWindowScrollPosition,
  getWindowScrollPosition,
  observeWindowScrollInvalidation,
  resolveWindowScrollPosition,
  saveWindowScrollPosition,
  type WindowScrollEntry,
  type WindowTranscriptIdentity,
  windowScrollObjectId,
} from './window-scroll-cache'

const EMPTY_MINIMAP_ANCHORS: MessageMinimapAnchor[] = []

// LRU-like cache with max size to prevent unbounded memory growth
const MAX_SCROLL_CACHE_SIZE = 100
const sessionScrollPositionCache = new Map<string, StateSnapshot>()

function setScrollPosition(sessionId: string, snapshot: StateSnapshot) {
  // Delete and re-add to move to end (most recently used)
  sessionScrollPositionCache.delete(sessionId)
  sessionScrollPositionCache.set(sessionId, snapshot)

  // Evict oldest entries if over limit
  if (sessionScrollPositionCache.size > MAX_SCROLL_CACHE_SIZE) {
    const firstKey = sessionScrollPositionCache.keys().next().value
    if (firstKey) {
      sessionScrollPositionCache.delete(firstKey)
    }
  }
}

// Export cleanup function for use when sessions are deleted
export function clearScrollPositionCache(sessionId: string) {
  sessionScrollPositionCache.delete(sessionId)
  clearWindowScrollPosition(sessionId)
}

function readWindowAnchor(container: HTMLElement, items: MessageRenderItem[]) {
  const list = container.querySelector<HTMLElement>('[data-testid="virtuoso-item-list"]')
  const viewport = container.getBoundingClientRect()
  if (!list || viewport.height <= 0 || getComputedStyle(list).visibility === 'hidden') return null
  for (const item of Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-index]'))) {
    const bounds = item.getBoundingClientRect()
    if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue
    const messageId = items[Number(item.dataset.index)]?.messages[0]?.id
    if (messageId) return { messageId, offset: viewport.top - bounds.top }
  }
  return null
}

function readWindowLayout(container: HTMLElement, widthFull: boolean, smallScreen: boolean) {
  if (container.clientWidth <= 0 || container.clientHeight <= 0 || document.fonts?.status === 'loading') return null
  const style = getComputedStyle(container)
  return JSON.stringify([
    container.clientWidth,
    container.clientHeight,
    window.devicePixelRatio,
    style.fontFamily,
    style.fontSize,
    style.lineHeight,
    widthFull,
    smallScreen,
    windowScrollObjectId(settingsStore.getState()),
  ])
}

export interface MessageListRef {
  scrollToTop: (behavior?: ScrollBehavior) => void
  scrollToBottom: (behavior?: ScrollBehavior) => void
  scrollToMessage: (messageId: string, behavior?: 'auto' | 'smooth') => boolean
  setIsNewMessage: (flag: boolean) => void
}

export type MessageListProps = {
  className?: string
  onLoadOlder?: () => void
  hasOlder?: boolean
  hasNewer?: boolean
  isLoadingOlder?: boolean
  isLoadingNewer?: boolean
  isJumping?: boolean
  onLoadNewer?: () => void
  onJumpToEdge?: (edge: 'head' | 'tail') => void
  windowPosition?: { id: number; edge: 'head' | 'tail' } | null
  onRequireComplete?: (messageId?: string) => void
  windowIdentity?: WindowTranscriptIdentity
} & ({ currentSession: Session; transcript?: never } | { currentSession?: never; transcript: SessionTranscript })

const MessageList = forwardRef<MessageListRef, MessageListProps>((props, ref) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const widthFull = useUIStore((s) => s.widthFull)
  const hideSystemPromptMessage = useSettingsStore((s) => s.hideSystemPromptMessage)

  const completeSession = props.currentSession
  const isCompleteSession = completeSession !== undefined
  const currentSession = completeSession ?? props.transcript!.header
  const navigationOwner = useMemo(() => Symbol(currentSession.id), [currentSession.id])

  const currentThreadHash = useMemo(
    () => (completeSession ? getCurrentThreadHistoryHash(completeSession) : {}),
    [completeSession]
  )
  const currentMessageList = useMemo(
    () => (completeSession ? getAllMessageList(completeSession) : props.transcript!.messages),
    [completeSession, props.transcript]
  )
  const sessionLocks = useSessionLockState(completeSession, currentSession.id)
  // Resolved once per session snapshot and passed down as a plain prop: with
  // multi-thousand-row sessions, per-row store subscriptions would re-run a
  // selector on every streaming chunk. Mode changes rewrite session.settings,
  // so the session prop already re-renders this component when it matters.
  const sessionMode = useMemo(
    () => resolveSessionMode(getSessionAgentModeEntry(currentSession.id, currentSession).value),
    [currentSession]
  )
  const promptCacheContextRef = useRef({
    mode: sessionMode,
    messages: completeSession?.messages ?? [],
    compactionPoints: completeSession?.compactionPoints,
    maxContextMessageCount: currentSession.settings?.maxContextMessageCount,
  })
  promptCacheContextRef.current = {
    mode: sessionMode,
    messages: completeSession?.messages ?? [],
    compactionPoints: completeSession?.compactionPoints,
    maxContextMessageCount: currentSession.settings?.maxContextMessageCount,
  }
  const shouldConfirmPromptCacheDelete = useCallback((messageId: string, target: PromptCacheDeleteTarget) => {
    const { mode, messages, compactionPoints, maxContextMessageCount } = promptCacheContextRef.current
    const context = evaluatePromptCacheDeleteContext(messages, messageId, {
      compactionPoints,
      maxContextMessageCount,
    })
    return shouldConfirmPromptCacheBreakForDelete(mode, messages, messageId, target, {
      contextMessages: context.messages,
      hasStartedAssistantRequest: context.hasStartedAssistantRequest,
      deletionChangesContext: context.deletionChangesContext,
    })
  }, [])

  const latestSummaryMessageId = useMemo(() => {
    for (let i = currentMessageList.length - 1; i >= 0; i--) {
      if (currentMessageList[i].isSummary) {
        return currentMessageList[i].id
      }
    }
    return null
  }, [currentMessageList])

  const renderItems = useMemo<MessageRenderItem[]>(
    () => buildMessageRenderItems(currentMessageList),
    [currentMessageList]
  )
  const previousItems = useRef<{ items: MessageRenderItem[]; index: number; positionId?: number } | null>(null)
  const firstItemIndex = useMemo(() => {
    if (!props.transcript) return 0
    const previous = previousItems.current
    if (previous && previous.positionId === props.windowPosition?.id) {
      const indices = new Map(
        renderItems.flatMap((item, index) => item.messages.map((message) => [message.id, index] as const))
      )
      for (let index = 0; index < previous.items.length; index++) {
        const currentIndex = indices.get(previous.items[index].messages[0].id)
        if (currentIndex !== undefined) return previous.index + index - currentIndex
      }
    }
    return 1000000000 - renderItems.length
  }, [props.transcript, props.windowPosition?.id, renderItems])
  useLayoutEffect(() => {
    previousItems.current = { items: renderItems, index: firstItemIndex, positionId: props.windowPosition?.id }
  }, [renderItems, firstItemIndex, props.windowPosition?.id])
  const initialViewWasWindow = useRef(props.transcript !== undefined).current
  const viewportAnchorRef = useRef<{ messageId: string; offset: number } | null>(null)
  const windowKey = useMemo(
    () =>
      props.transcript
        ? createWindowScrollKey(currentSession, props.windowIdentity, renderItems, firstItemIndex)
        : null,
    [props.transcript, props.windowIdentity, currentSession, renderItems, firstItemIndex]
  )

  // A streaming reply replaces the session object for every chunk. Build the
  // minimap once when generation starts, freeze it while chunks arrive, then
  // refresh it once with the final assistant preview after generation ends.
  const previousMinimapStateRef = useRef<{
    sessionId: string
    generationRunning: boolean
    messages: SessionMessage[]
    anchors: MessageMinimapAnchor[]
  }>({ sessionId: currentSession.id, generationRunning: false, messages: [], anchors: [] })
  const userMessageAnchors = useMemo<MessageMinimapAnchor[]>(() => {
    const previousState = previousMinimapStateRef.current

    // Small screens never show the rail, so skip the anchor scan entirely
    // (it would otherwise run on every streaming chunk on mobile).
    if (isSmallScreen) {
      previousMinimapStateRef.current = {
        sessionId: currentSession.id,
        generationRunning: false,
        messages: currentMessageList,
        anchors: EMPTY_MINIMAP_ANCHORS,
      }
      return EMPTY_MINIMAP_ANCHORS
    }

    if (
      sessionLocks.anyReplyGenerating &&
      previousState.sessionId === currentSession.id &&
      previousState.generationRunning &&
      canReuseMinimapAnchorsDuringGeneration(previousState.messages, currentMessageList)
    ) {
      return previousState.anchors
    }

    const assistantTextByUserId = new Map<string, string>()

    for (let i = 0; i < currentMessageList.length; i++) {
      const message = currentMessageList[i]
      if (!isUserNavigationMessage(message)) {
        continue
      }

      for (let j = i + 1; j < currentMessageList.length; j++) {
        const nextMessage = currentMessageList[j]
        if (nextMessage.role === 'user') {
          break
        }
        if (nextMessage.role === 'assistant' && !nextMessage.isSummary && !nextMessage.isForkMarker) {
          // Do not expose a transient partial preview. The completed text is
          // loaded by the first render after `anyReplyGenerating` becomes false.
          if (!nextMessage.generating) {
            assistantTextByUserId.set(message.id, getMessagePreviewText(nextMessage))
          }
          break
        }
      }
    }

    const anchors = renderItems.flatMap((item, itemIndex) =>
      item.messages.filter(isUserNavigationMessage).map((message) => ({
        messageId: message.id,
        itemIndex,
        text: getMessagePreviewText(message),
        assistantText: assistantTextByUserId.get(message.id),
      }))
    )

    const stableAnchors =
      previousState.sessionId === currentSession.id && areMinimapAnchorsEqual(previousState.anchors, anchors)
        ? previousState.anchors
        : anchors
    previousMinimapStateRef.current = {
      sessionId: currentSession.id,
      generationRunning: sessionLocks.anyReplyGenerating,
      messages: currentMessageList,
      anchors: stableAnchors,
    }
    return stableAnchors
  }, [currentMessageList, currentSession.id, renderItems, sessionLocks.anyReplyGenerating, isSmallScreen])
  const showMinimap = !isSmallScreen && userMessageAnchors.length > 0

  const virtuoso = useRef<VirtuosoHandle>(null)
  const [smoothFollowOutput] = useState(() =>
    createSmoothFollowOutputController({
      scrollToBottom: (behavior) => virtuoso.current?.scrollTo({ top: Infinity, behavior }),
      stopScrolling: (scrollTop) => virtuoso.current?.scrollTo({ top: scrollTop, behavior: 'auto' }),
      // Mobile WebViews can fall behind when a smooth scroll is retargeted on every streaming height change.
      getScrollBehavior: platform.type === 'mobile' ? () => 'auto' : undefined,
    })
  )
  const messageListRef = useRef<HTMLDivElement>(null)
  const [messageViewportHeight, setMessageViewportHeight] = useState(0)
  const [isNewMessage, setIsNewMessage] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const windowGeometryChanged = useRef(false)
  const [windowStart, setWindowStart] = useState<{
    ready: boolean
    entry?: WindowScrollEntry
    position?: ReturnType<typeof resolveWindowScrollPosition>
  }>(() => {
    const entry = windowKey ? getWindowScrollPosition(currentSession.id) : undefined
    return { ready: !entry, entry }
  })
  const latestWindow = useRef({
    key: windowKey,
    renderItems,
    widthFull,
    isSmallScreen,
    isNewMessage,
    generating: sessionLocks.anyReplyGenerating,
  })
  useLayoutEffect(() => {
    latestWindow.current = {
      key: windowKey,
      renderItems,
      widthFull,
      isSmallScreen,
      isNewMessage,
      generating: sessionLocks.anyReplyGenerating,
    }
  }, [windowKey, renderItems, widthFull, isSmallScreen, isNewMessage, sessionLocks.anyReplyGenerating])

  useLayoutEffect(() => {
    if (windowStart.ready) return
    // Virtuoso consumes measured ranges on mount. Validate a warm candidate against the actual
    // viewport before mounting the list; a cold window can begin its normal measurement immediately.
    const container = messageListRef.current
    const layout = container && readWindowLayout(container, widthFull, isSmallScreen)
    const position = resolveWindowScrollPosition(windowStart.entry, windowKey, layout ?? '', renderItems)
    if (position) {
      if ('snapshot' in position && position.following) smoothFollowOutput.resume()
      else smoothFollowOutput.pause()
      if (windowStart.entry)
        viewportAnchorRef.current = {
          messageId: windowStart.entry.anchor.messageId,
          offset: 'snapshot' in position ? windowStart.entry.anchor.offset : 0,
        }
    }
    setWindowStart({ ready: true, position })
  }, [windowStart, windowKey, renderItems, widthFull, isSmallScreen, smoothFollowOutput])

  useLayoutEffect(() => {
    if (isCompleteSession || !windowStart.ready) return
    const handle = virtuoso.current
    const container = messageListRef.current
    let valid = true
    const unsubscribe = observeWindowScrollInvalidation(currentSession.id, () => {
      valid = false
    })
    return () => {
      unsubscribe()
      discardWindowScrollPosition(currentSession.id)
      const current = latestWindow.current
      if (!valid || !handle || !container || !current.key || current.isNewMessage || current.generating) return
      const key = current.key
      const scroller = container.querySelector<HTMLElement>('[data-virtuoso-scroller]')
      const layout = readWindowLayout(container, current.widthFull, current.isSmallScreen)
      const anchor = readWindowAnchor(container, current.renderItems)
      if (!scroller || !layout || !anchor) return
      const scrollTop = scroller.scrollTop
      const following = smoothFollowOutput.isFollowing()
      if (following && scroller.scrollHeight - scroller.clientHeight - scrollTop > 4) return
      const save = (snapshot: StateSnapshot | null) =>
        saveWindowScrollPosition({ version: 1, key, layout, anchor, snapshot, following })
      if (windowGeometryChanged.current || key.signature === null) {
        save(null)
        return
      }
      handle.getState((state) => {
        const snapshot = boundedWindowSnapshot(state, current.renderItems.length)
        if (!snapshot || Math.abs(snapshot.scrollTop - scrollTop) > 4) return
        save(snapshot)
      })
    }
  }, [isCompleteSession, windowStart.ready, currentSession.id, smoothFollowOutput, props.windowPosition?.id])

  const setMessageListElement = useUIStore((s) => s.setMessageListElement)
  const setTranscriptNavigation = useUIStore((s) => s.setTranscriptNavigation)

  // message navigation handlers
  const [messageNavigationVisible, setMessageNavigationVisible] = useState(false)
  const handleMessageNavigationVisibleChanged = useCallback((v: boolean) => setMessageNavigationVisible(v), [])

  const handleScrollToTop = useCallback(() => {
    smoothFollowOutput.pause()
    if (props.hasOlder) {
      if (props.onJumpToEdge) props.onJumpToEdge('head')
      else props.onRequireComplete?.()
      return
    }
    smoothFollowOutput.pause()
    virtuoso.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [smoothFollowOutput, props.hasOlder, props.onJumpToEdge, props.onRequireComplete])

  const handleScrollToBottom = useCallback(() => {
    if (props.hasNewer) {
      props.onJumpToEdge?.('tail')
      return
    }
    smoothFollowOutput.resume()
    virtuoso.current?.scrollTo({ top: Infinity, behavior: 'smooth' })
  }, [smoothFollowOutput, props.hasNewer, props.onJumpToEdge])

  useLayoutEffect(() => {
    if (!props.windowPosition) return
    if (props.windowPosition.edge === 'head') smoothFollowOutput.pause()
    else smoothFollowOutput.resume()
  }, [props.windowPosition, smoothFollowOutput])

  const handleMinimapJump = useCallback(
    (anchor: MessageMinimapAnchor) => {
      smoothFollowOutput.pause()
      virtuoso.current?.scrollToIndex({ index: anchor.itemIndex, align: 'start', behavior: 'smooth' })
    },
    [smoothFollowOutput]
  )

  const handleScrollToPrev = useCallback(() => {
    smoothFollowOutput.pause()
    if (messageListRef?.current && virtuoso?.current) {
      const containerRect = messageListRef.current.getBoundingClientRect()
      for (let i = 0; i < renderItems.length; i++) {
        // 此处原本判断 role 的逻辑已在 renderItems 中处理
        const msgElement = messageListRef.current.querySelector(
          `[data-testid="virtuoso-item-list"] > [data-index="${i}"]`
        )
        if (msgElement) {
          const rect = msgElement.getBoundingClientRect()
          // 找到第一个出现在可视区域顶部的元素，滚动到上一条用户消息
          // +2 tolerance: smooth scroll + virtuoso height estimation can leave
          // the previous element's bottom a sub-pixel into the viewport,
          // causing the anchor to land one item too early.
          if (rect.bottom > containerRect.top + 2) {
            // If the current element's top is scrolled above the viewport and it
            // contains a user message (e.g. a long assistant response in a group),
            // scroll to the top of THIS element first to bring the question back.
            if (rect.top < containerRect.top - 2 && renderItems[i].messages.some(isUserNavigationMessage)) {
              virtuoso.current.scrollToIndex({
                index: i,
                align: 'start',
                behavior: 'smooth',
              })
              return
            }
            for (let j = i - 1; j >= 0; j--) {
              if (renderItems[j].messages.some(isUserNavigationMessage)) {
                virtuoso.current.scrollToIndex({
                  index: j,
                  align: 'start',
                  behavior: 'smooth',
                })
                return
              }
            }
            // 没有上一条用户消息了，滚动到顶部
            virtuoso.current.scrollToIndex({ index: 0, align: 'start', behavior: 'smooth' })
            return
          }
        }
      }
    }
  }, [renderItems, smoothFollowOutput])

  const handleScrollToNext = useCallback(() => {
    smoothFollowOutput.pause()
    if (messageListRef?.current && virtuoso?.current) {
      const containerRect = messageListRef.current.getBoundingClientRect()
      for (let i = 0; i < renderItems.length; i++) {
        const msgElement = messageListRef.current.querySelector(
          `[data-testid="virtuoso-item-list"] > [data-index="${i}"]`
        )
        if (msgElement) {
          const rect = msgElement.getBoundingClientRect()
          // 找到第一个出现在可视区域顶部的元素，滚动到下一条用户消息
          // +2 tolerance: see handleScrollToPrev comment
          if (rect.bottom > containerRect.top + 2) {
            for (let j = i + 1; j < renderItems.length; j++) {
              if (renderItems[j].messages.some(isUserNavigationMessage)) {
                virtuoso.current.scrollToIndex({ index: j, align: 'start', behavior: 'smooth' })
                return
              }
            }
            // 没有下一条用户消息了，滚动到底部
            virtuoso.current.scrollToIndex({ index: renderItems.length - 1, align: 'end', behavior: 'smooth' })
            return
          }
        }
      }
    }
  }, [renderItems, smoothFollowOutput])

  const [atBottom, setAtBottom] = useState(false)
  const [atTop, setAtTop] = useState(false)

  const [showScrollToPrev, setShowScrollToPrev] = useState(false)
  const lastScrollTop = useRef<number>()
  const lastMaxScrollTop = useRef<number>()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
      }
    }
  }, [])

  const handleScrollTopThrottled = useThrottledCallback((scrollTop: number, maxScrollTop: number) => {
    if (typeof scrollTop === 'number' && typeof lastScrollTop.current === 'number') {
      // A taller scrollport can clamp the bottom position without an upward navigation gesture.
      const layoutShrank = isLayoutClampedScroll(
        lastScrollTop.current,
        lastMaxScrollTop.current,
        scrollTop,
        maxScrollTop
      )
      if (scrollTop > 0 && scrollTop < lastScrollTop.current && !layoutShrank) {
        // 是向上滚动
        setShowScrollToPrev(true)
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        timerRef.current = setTimeout(() => setShowScrollToPrev(false), 3000)
      } else {
        setShowScrollToPrev(false)
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
      }
    }
    lastScrollTop.current = scrollTop
    lastMaxScrollTop.current = maxScrollTop
  }, 256)

  const handleScroll = useCallback<UIEventHandler>(
    (e) => {
      const scrollTop = e.currentTarget.scrollTop
      const maxScrollTop = e.currentTarget.scrollHeight - e.currentTarget.clientHeight
      if (props.hasNewer) {
        smoothFollowOutput.pause()
        setAtBottom(false)
      } else if (smoothFollowOutput.handleScroll(scrollTop, maxScrollTop)) {
        setAtBottom(false)
      } else if (smoothFollowOutput.isFollowing()) {
        setAtBottom(true)
      }
      if (e.currentTarget.scrollHeight - (scrollTop + e.currentTarget.clientHeight) >= 0) {
        handleScrollTopThrottled(scrollTop, maxScrollTop)
      }
      // Rendered ranges include overscan. Preserve only the item intersecting
      // the viewport and its pixel offset when this view needs complete data.
      const container = messageListRef.current
      if (!isCompleteSession && container) {
        const anchor = readWindowAnchor(container, renderItems)
        if (anchor) viewportAnchorRef.current = anchor
      }
    },
    [handleScrollTopThrottled, isCompleteSession, renderItems, smoothFollowOutput, props.hasNewer]
  )
  // message navigation handlers end

  useLayoutEffect(() => {
    const container = messageListRef.current
    if ((!isCompleteSession && !windowStart.ready) || !container || !virtuoso.current) return
    let active = true
    const navigation: TranscriptNavigation = {
      owner: navigationOwner,
      sessionId: currentSession.id,
      view: isCompleteSession ? 'complete' : 'window',
      scrollToIndex(location) {
        const handle = virtuoso.current
        if (
          !active ||
          !handle ||
          !container.isConnected ||
          messageListRef.current !== container ||
          uiStore.getState().transcriptNavigation !== navigation ||
          container.dataset.sessionId !== navigation.sessionId ||
          container.dataset.sessionView !== navigation.view
        )
          return false
        if (location.index === 'LAST') smoothFollowOutput.resume()
        else smoothFollowOutput.pause()
        handle.scrollToIndex(location)
        return true
      },
    }
    setTranscriptNavigation(navigation)
    return () => {
      active = false
      if (uiStore.getState().transcriptNavigation === navigation) setTranscriptNavigation(null)
    }
  }, [
    currentSession.id,
    isCompleteSession,
    navigationOwner,
    setTranscriptNavigation,
    smoothFollowOutput,
    windowStart.ready,
  ])

  useEffect(() => {
    const currentVirtuoso = virtuoso.current // 清理时 virtuoso.current 已经为 null
    return () => {
      if (!isCompleteSession) return
      currentVirtuoso?.getState((state) => {
        if (state.ranges.length > 0) {
          // useEffect 可能执行两次，这里根据 ranges 判断是否为第一次 useEffect 严格测试导致的执行
          setScrollPosition(currentSession.id, state)
        }
      })
    }
  }, [isCompleteSession, currentSession.id])
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅执行一次
  useEffect(() => {
    setMessageListElement(messageListRef)
  }, [])

  useEffect(() => {
    return () => smoothFollowOutput.dispose()
  }, [smoothFollowOutput])

  useEffect(() => {
    const element = messageListRef.current
    if (!element) {
      return
    }

    const updateViewportHeight = () => {
      setMessageViewportHeight(element.clientHeight)
    }

    updateViewportHeight()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportHeight)
      return () => {
        window.removeEventListener('resize', updateViewportHeight)
      }
    }

    const observer = new ResizeObserver(() => {
      updateViewportHeight()
    })

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  const platformType = useAtomValue(platformTypeAtom)

  // Work Mode drops the conversation's system prompt when building the request —
  // identity comes from the frozen Soul — so showing it would misrepresent what the
  // model receives, whatever the display setting says.
  const hideSystemPrompt = hideSystemPromptMessage || !isActionAvailableInMode('session-system-prompt', sessionMode)
  const showThreadHistory = isThreadHistoryAvailable(completeSession ?? {}, sessionMode)

  const renderMessageBlock = useCallback(
    (msg: SessionMessage, options: { isFirstItem: boolean; isLastItem: boolean }) => {
      // Keep system messages in renderItems so thread anchors and Virtuoso indices stay stable.
      const shouldHideSystemPrompt = hideSystemPrompt && msg.role === 'system'
      const thread = showThreadHistory ? currentThreadHash[msg.id] : undefined
      // Saved alternatives stay inside the pivot block (newest-first in ForkGroup), so the active
      // branch appears last. Forks can pivot on a system message ("Reply Again Below", first-reply
      // retries), so the switcher must stay reachable even while the system prompt is hidden.
      const forkGroup = completeSession?.messageForksHash?.[msg.id] &&
        completeSession.messageForksHash[msg.id].lists.length > 1 && (
          <ForkGroup
            sessionId={currentSession.id}
            sessionType={currentSession.type || 'chat'}
            msgId={msg.id}
            forks={completeSession.messageForksHash[msg.id]}
            sessionLocks={sessionLocks}
            sessionMode={sessionMode}
            assistantAvatarKey={currentSession.assistantAvatarKey}
            sessionPicUrl={currentSession.picUrl}
          />
        )

      if (shouldHideSystemPrompt) {
        return (
          <Stack key={msg.id} gap={0}>
            {thread && (
              <ThreadLabel
                thread={thread}
                sessionId={currentSession.id}
                sessionMode={sessionMode}
                currentThreadTarget={getCurrentThreadTarget(currentSession)}
              />
            )}
            {/* Virtuoso items must keep a measurable height so their canonical message indices
                remain stable; the placeholder also carries the first/last paddings the hidden
                message would have contributed, keeping the visible transcript's spacing. */}
            {!thread && (
              <div
                aria-hidden="true"
                className={cn('h-px', options.isFirstItem && 'pt-4', options.isLastItem && 'pb-4')}
              />
            )}
            {forkGroup}
          </Stack>
        )
      }

      return (
        <Stack key={msg.id} gap={0} pt={msg.role === 'user' ? 4 : 0}>
          {thread && (
            <ThreadLabel
              thread={thread}
              sessionId={currentSession.id}
              sessionMode={sessionMode}
              currentThreadTarget={getCurrentThreadTarget(currentSession)}
            />
          )}
          <ErrorBoundary name={`message-item`}>
            {msg.isForkMarker ? (
              <ForkMarkerMessage
                sourceSessionId={msg.forkedFromSessionId}
                className={options.isFirstItem ? 'pt-4' : options.isLastItem ? '!pb-4' : ''}
              />
            ) : msg.isSummary ? (
              <SummaryMessage
                msg={msg}
                className={options.isFirstItem ? 'pt-4' : options.isLastItem ? '!pb-4' : ''}
                isLatestSummary={currentSession.type !== 'picture' && msg.id === latestSummaryMessageId}
                onDelete={
                  currentSession.type === 'picture'
                    ? undefined
                    : () => {
                        const gate = getSessionActionGate('delete-summary', sessionLocks)
                        if (!gate.allowed) {
                          void notifySessionLockBlocked(gate.reason, t)
                          return
                        }
                        void removeMessage(currentSession.id, msg.id)
                      }
                }
                sessionId={currentSession.id}
                sessionMode={sessionMode}
                shouldConfirmPromptCacheDelete={shouldConfirmPromptCacheDelete}
                highlighted={msg.id === highlightedMessageId}
              />
            ) : (
              <Message
                id={msg.id}
                msg={msg}
                sessionId={currentSession.id}
                sessionType={currentSession.type || 'chat'}
                readOnly={currentSession.type === 'picture'}
                className={options.isFirstItem ? 'pt-4' : options.isLastItem ? '!pb-4' : ''}
                collapseThreshold={msg.role === 'system' ? 150 : undefined}
                buttonGroup={options.isLastItem && msg.role === 'assistant' ? 'always' : 'auto'}
                sessionLocks={sessionLocks}
                sessionMode={sessionMode}
                shouldConfirmPromptCacheDelete={shouldConfirmPromptCacheDelete}
                allowGeneratingStop
                assistantAvatarKey={currentSession.assistantAvatarKey}
                sessionPicUrl={currentSession.picUrl}
              />
            )}
          </ErrorBoundary>
          {forkGroup}
        </Stack>
      )
    },
    [
      currentSession,
      completeSession,
      currentThreadHash,
      hideSystemPrompt,
      sessionLocks,
      sessionMode,
      shouldConfirmPromptCacheDelete,
      showThreadHistory,
      latestSummaryMessageId,
      highlightedMessageId,
      t,
    ]
  )

  useImperativeHandle(ref, () => ({
    scrollToTop: (behavior = 'auto') => {
      smoothFollowOutput.pause()
      if (props.hasOlder) {
        if (props.onJumpToEdge) props.onJumpToEdge('head')
        else props.onRequireComplete?.()
        return
      }
      smoothFollowOutput.pause()
      virtuoso.current?.scrollTo({ top: 0, behavior })
    },
    scrollToBottom: (behavior = 'auto') => {
      if (props.hasNewer) {
        props.onJumpToEdge?.('tail')
        return
      }
      smoothFollowOutput.resume()
      virtuoso.current?.scrollTo({ top: Infinity, behavior })
    },
    scrollToMessage: (messageId, behavior = 'smooth') => {
      const itemIndex = renderItems.findIndex((item) => item.messages.some((message) => message.id === messageId))
      if (itemIndex < 0) {
        props.onRequireComplete?.(messageId)
        return Boolean(props.onRequireComplete)
      }

      smoothFollowOutput.pause()
      setHighlightedMessageId(messageId)
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
      }
      highlightTimerRef.current = setTimeout(() => setHighlightedMessageId(null), 2500)
      virtuoso.current?.scrollToIndex({ index: itemIndex, align: 'center', behavior })
      return true
    },
    setIsNewMessage: (value: boolean) => setIsNewMessage(value),
  }))

  return (
    <div className={cn('w-full h-full mx-auto', isSmallScreen && 'flex flex-col', props.className)}>
      <BlockCodeCollapsedStateProvider defaultCollapsed={!!settingsStore.getState().autoCollapseCodeBlock}>
        {isSmallScreen && (
          <Transition mounted={showScrollToPrev && (!atTop || !!props.hasOlder)} transition="fade">
            {(transitionStyle) => (
              <Flex style={transitionStyle} className="shrink-0 leading-tight bg-chatbox-background-secondary">
                {[
                  { text: t('Return to the top'), icon: IconArrowBarToUp, onClick: handleScrollToTop },
                  { text: t('Back to previous message'), icon: IconArrowUp, onClick: handleScrollToPrev },
                ].map((item, idx) => (
                  <Button
                    key={item.text}
                    variant="transparent"
                    className={cn('w-1/2', idx === 0 ? 'border-r border-r-chatbox-border-primary' : '')}
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
        <div
          className={cn(
            'overflow-hidden pr-0 relative',
            isSmallScreen ? 'min-h-0 flex-1' : 'h-full',
            showMinimap ? 'pl-[28px]' : 'pl-1 sm:pl-0'
          )}
          ref={messageListRef}
          data-session-id={currentSession.id}
          data-session-view={isCompleteSession ? 'complete' : 'window'}
          aria-busy={props.isJumping || props.isLoadingOlder || props.isLoadingNewer || undefined}
          onClickCapture={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-index]'))
              windowGeometryChanged.current = true
          }}
          onKeyDownCapture={() => {
            windowGeometryChanged.current = true
          }}
        >
          {/* Virtuoso smooths appended items but snaps same-item height growth; the controller below owns both cases. */}
          {(!props.transcript || windowStart.ready) && (
            <Virtuoso
              key={props.transcript ? `window-${props.windowPosition?.id ?? 0}` : 'complete'}
              style={{ scrollbarGutter: isSmallScreen ? 'auto' : 'stable' }}
              className={platformType === 'win32' ? 'scrollbar-custom' : ''}
              data={renderItems}
              firstItemIndex={firstItemIndex}
              startReached={props.hasOlder ? props.onLoadOlder : undefined}
              endReached={props.hasNewer ? props.onLoadNewer : undefined}
              components={WINDOW_BOUNDARY_COMPONENTS}
              context={
                props.transcript
                  ? {
                      hasOlder: props.hasOlder,
                      hasNewer: props.hasNewer,
                      isLoadingOlder: props.isLoadingOlder,
                      isLoadingNewer: props.isLoadingNewer,
                      onLoadOlder: props.onLoadOlder,
                      onLoadNewer: props.onLoadNewer,
                    }
                  : undefined
              }
              // MessageRenderItem already carries a stable key (message id / group ids).
              // Without computeItemKey, Virtuoso reconciles by index and reuses DOM nodes
              // across positions; when a message is inserted or removed mid-list (steering,
              // fork switching, compaction), React's keyed inner <Stack> then tries to remove
              // a node Virtuoso already moved, throwing "Failed to execute 'removeChild'".
              computeItemKey={(_, item) => item.key}
              ref={virtuoso}
              followOutput={false}
              {...(props.transcript && props.windowPosition
                ? {
                    ...(props.windowPosition.edge === 'head'
                      ? { initialScrollTop: 0 }
                      : { initialTopMostItemIndex: { index: 'LAST' as const, align: 'end' as const } }),
                  }
                : props.transcript && windowStart.position
                  ? 'snapshot' in windowStart.position
                    ? {
                        restoreStateFrom: windowStart.position.snapshot,
                        initialScrollTop: windowStart.position.snapshot.scrollTop,
                      }
                    : { initialTopMostItemIndex: { index: windowStart.position.anchorIndex, align: 'start' as const } }
                  : !props.transcript && !initialViewWasWindow && sessionScrollPositionCache.has(currentSession.id)
                    ? {
                        restoreStateFrom: sessionScrollPositionCache.get(currentSession.id),
                        // 需要额外设置 initialScrollTop，否则恢复位置后 scrollTop 为 0。这时如果用户没有滚动，那么下次保存时 scrollTop 将记为 0，导致下一次恢复时位置始终为顶部。
                        initialScrollTop: sessionScrollPositionCache.get(currentSession.id)?.scrollTop,
                      }
                    : {
                        initialTopMostItemIndex:
                          !props.transcript && smoothFollowOutput.isFollowing()
                            ? { index: 'LAST', align: 'end' }
                            : !props.transcript && viewportAnchorRef.current
                              ? {
                                  index: Math.max(
                                    0,
                                    renderItems.findIndex((item) =>
                                      item.messages.some(
                                        (message) => message.id === viewportAnchorRef.current?.messageId
                                      )
                                    )
                                  ),
                                  align: 'start',
                                  offset: viewportAnchorRef.current.offset,
                                }
                              : renderItems.length - 1,
                      })}
              increaseViewportBy={{ top: 2000, bottom: 2000 }}
              itemContent={(absoluteIndex, item) => {
                const index = absoluteIndex - firstItemIndex
                const itemClassName = widthFull ? 'w-full' : 'max-w-4xl mx-auto'
                const itemStyle = isSmallScreen ? { paddingInlineEnd: 16 } : undefined
                const isFirstItem = index === 0
                const isLastItem = index === renderItems.length - 1

                if (item.type === 'group') {
                  return (
                    <div className={itemClassName} style={itemStyle}>
                      <div
                        className="flex flex-col pt-5"
                        style={
                          messageViewportHeight > 0 && isNewMessage && isLastItem
                            ? { minHeight: `${messageViewportHeight * 0.85}px` }
                            : undefined
                        } // key
                      >
                        {item.messages.map((message, messageIndex) =>
                          renderMessageBlock(message, {
                            isFirstItem: isFirstItem && messageIndex === 0,
                            isLastItem: isLastItem && messageIndex === item.messages.length - 1,
                          })
                        )}
                        {/* <div aria-hidden="true" className="flex-1" /> */}
                      </div>
                    </div>
                  )
                }

                return (
                  <div className={itemClassName} style={itemStyle}>
                    {renderMessageBlock(item.messages[0], { isFirstItem, isLastItem })}
                  </div>
                )
              }}
              atTopStateChange={setAtTop}
              atBottomStateChange={(nextAtBottom) => {
                if (!props.hasNewer) smoothFollowOutput.handleAtBottomChange(nextAtBottom)
                setAtBottom(!props.hasNewer && (nextAtBottom || smoothFollowOutput.isFollowing()))
              }}
              totalListHeightChanged={smoothFollowOutput.handleHeightChange}
              onScroll={handleScroll}
            />
          )}

          {props.isJumping && (
            <Flex
              role="status"
              aria-live="polite"
              gap="xs"
              align="center"
              className="absolute top-2 left-1/2 -translate-x-1/2 rounded px-3 py-2 bg-chatbox-background-secondary shadow"
            >
              <Loader size="xs" />
              {t('Loading...')}
            </Flex>
          )}

          {showMinimap && <MessageMinimapRail anchors={userMessageAnchors} onJump={handleMinimapJump} />}

          {!isSmallScreen ? (
            <MessageNavigation
              visible={messageNavigationVisible}
              onVisibleChange={handleMessageNavigationVisibleChanged}
              onScrollToTop={handleScrollToTop}
              onScrollToBottom={handleScrollToBottom}
              onScrollToPrev={handleScrollToPrev}
              onScrollToNext={handleScrollToNext}
            />
          ) : (
            <Transition mounted={!atBottom || !!props.hasNewer} transition="slide-up">
              {(transitionStyle) => <ScrollToBottomButton onClick={handleScrollToBottom} style={transitionStyle} />}
            </Transition>
          )}
        </div>
      </BlockCodeCollapsedStateProvider>
    </div>
  )
})

export default memo(MessageList)

type WindowBoundaryContext = Pick<
  MessageListProps,
  'hasOlder' | 'hasNewer' | 'isLoadingOlder' | 'isLoadingNewer' | 'onLoadOlder' | 'onLoadNewer'
>

function WindowBoundary({ context, edge }: { context?: WindowBoundaryContext; edge: 'head' | 'tail' }) {
  const { t } = useTranslation()
  if (!context) return null
  const more = edge === 'head' ? context.hasOlder : context.hasNewer
  const loading = edge === 'head' ? context.isLoadingOlder : context.isLoadingNewer
  if (!more && edge === 'tail') return null
  return (
    <Flex mih={36} justify="center" align="center" gap="xs" role="status" aria-live="polite">
      {loading ? (
        <>
          <Loader size="xs" />
          {t('Loading...')}
        </>
      ) : more ? (
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={edge === 'head' ? context.onLoadOlder : context.onLoadNewer}
        >
          {t('Load More')}
        </Button>
      ) : (
        <span className="text-xs text-chatbox-tertiary">{t('Beginning of conversation')}</span>
      )}
    </Flex>
  )
}

const WINDOW_BOUNDARY_COMPONENTS = {
  Header: ({ context }: { context?: WindowBoundaryContext }) => <WindowBoundary context={context} edge="head" />,
  Footer: ({ context }: { context?: WindowBoundaryContext }) => <WindowBoundary context={context} edge="tail" />,
}

type ThreadLabelProps = {
  sessionId: string
  sessionMode: SessionMode
  thread: SessionThreadBrief
  currentThreadTarget?: CurrentThreadTarget
}
const ThreadLabel: FC<ThreadLabelProps> = memo(({ thread, sessionId, sessionMode, currentThreadTarget }) => {
  const { t } = useTranslation()
  const setShowHistoryDrawer = useSetAtom(atoms.showThreadHistoryDrawerAtom)

  const handleOpenHistoryDrawer = useCallback(() => {
    setShowHistoryDrawer(thread.id || true)
  }, [setShowHistoryDrawer, thread.id])

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
    if (!thread.id || (thread.id === sessionId && !currentThreadTarget)) return
    return removeThread(sessionId, thread.id, currentThreadTarget)
  }, [sessionId, thread.id, currentThreadTarget])

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
