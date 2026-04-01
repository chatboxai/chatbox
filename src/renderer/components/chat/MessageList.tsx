import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Button, Flex, Stack, Text, Transition } from '@mantine/core'
import { useThrottledCallback } from '@mantine/hooks'
import type { Session, Message as SessionMessage, SessionThreadBrief } from '@shared/types'
import {
  IconAlignRight,
  IconArrowBarToUp,
  IconArrowUp,
  IconChevronLeft,
  IconChevronRight,
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
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { type StateSnapshot, Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { platformTypeAtom } from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import * as atoms from '@/stores/atoms'
import {
  deleteFork,
  expandFork,
  moveThreadToConversations,
  removeMessage,
  removeThread,
  switchFork,
  switchThread,
} from '@/stores/sessionActions'
import { getAllMessageList, getCurrentThreadHistoryHash } from '@/stores/sessionHelpers'
import { settingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu from '../ActionMenu'

import { ErrorBoundary } from '../common/ErrorBoundary'
import { ScalableIcon } from '../common/ScalableIcon'
import { BlockCodeCollapsedStateProvider } from '../Markdown'
import Message from './Message'
import MessageNavigation, { ScrollToBottomButton } from './MessageNavigation'
import SummaryMessage from './SummaryMessage'

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
}

export interface MessageListRef {
  scrollToTop: (behavior?: ScrollBehavior) => void
  scrollToBottom: (behavior?: ScrollBehavior) => void
  setIsNewMessage: (flag: boolean) => void
}

export interface MessageListProps {
  className?: string
  currentSession: Session
}

type MessageRenderItem =
  | {
      type: 'message'
      key: string
      messages: [SessionMessage]
    }
  | {
      type: 'group'
      key: string
      messages: [SessionMessage] | [SessionMessage, SessionMessage]
    }

const MessageList = forwardRef<MessageListRef, MessageListProps>((props, ref) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const widthFull = useUIStore((s) => s.widthFull)

  const { currentSession } = props

  const currentThreadHash = useMemo(
    () => currentSession && getCurrentThreadHistoryHash(currentSession),
    [currentSession]
  )
  const currentMessageList = useMemo(() => getAllMessageList(currentSession), [currentSession])

  const latestSummaryMessageId = useMemo(() => {
    for (let i = currentMessageList.length - 1; i >= 0; i--) {
      if (currentMessageList[i].isSummary) {
        return currentMessageList[i].id
      }
    }
    return null
  }, [currentMessageList])

  const renderItems = useMemo<MessageRenderItem[]>(() => {
    let latestUserIndex = -1

    for (let i = currentMessageList.length - 1; i >= 0; i--) {
      if (currentMessageList[i].role === 'user') {
        latestUserIndex = i
        break
      }
    }

    const shouldGroupLastTurn =
      latestUserIndex >= 0 &&
      (latestUserIndex === currentMessageList.length - 1 ||
        (latestUserIndex + 1 < currentMessageList.length &&
          currentMessageList[latestUserIndex + 1].role === 'assistant'))

    const items: MessageRenderItem[] = []

    for (let i = 0; i < currentMessageList.length; i++) {
      if (shouldGroupLastTurn && i === latestUserIndex) {
        const groupedMessages: [SessionMessage] | [SessionMessage, SessionMessage] =
          latestUserIndex + 1 < currentMessageList.length &&
          currentMessageList[latestUserIndex + 1].role === 'assistant'
            ? [currentMessageList[i], currentMessageList[i + 1]]
            : [currentMessageList[i]]

        items.push({
          type: 'group',
          key: `group-${groupedMessages.map((message) => message.id).join('-')}`,
          messages: groupedMessages,
        })
        if (groupedMessages.length === 2) {
          i++
        }
        continue
      }

      items.push({
        type: 'message',
        key: currentMessageList[i].id,
        messages: [currentMessageList[i]],
      })
    }

    return items
  }, [currentMessageList])

  const virtuoso = useRef<VirtuosoHandle>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const [messageViewportHeight, setMessageViewportHeight] = useState(0)
  const [isNewMessage, setIsNewMessage] = useState(false)

  const setMessageListElement = useUIStore((s) => s.setMessageListElement)
  const setMessageScrolling = useUIStore((s) => s.setMessageScrolling)

  // message navigation handlers
  const [messageNavigationVisible, setMessageNavigationVisible] = useState(false)
  const handleMessageNavigationVisibleChanged = useCallback((v: boolean) => setMessageNavigationVisible(v), [])

  const handleScrollToTop = useCallback(() => {
    virtuoso.current?.scrollToIndex({ index: 0, align: 'start', behavior: 'smooth' })
  }, [])

  const handleScrollToBottom = useCallback(() => {
    virtuoso.current?.scrollTo({ top: Infinity, behavior: 'smooth' })
  }, [])

  const handleScrollToPrev = useCallback(() => {
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
          if (rect.bottom > containerRect.top) {
            for (let j = i - 1; j >= 0; j--) {
              if (renderItems[j].messages.some((msg) => msg.role === 'user')) {
                virtuoso.current.scrollToIndex({
                  index: j,
                  align: 'start',
                  offset: isSmallScreen ? -28 : 0,
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
  }, [renderItems, isSmallScreen])

  const handleScrollToNext = useCallback(() => {
    if (messageListRef?.current && virtuoso?.current) {
      const containerRect = messageListRef.current.getBoundingClientRect()
      for (let i = 0; i < renderItems.length; i++) {
        const msgElement = messageListRef.current.querySelector(
          `[data-testid="virtuoso-item-list"] > [data-index="${i}"]`
        )
        if (msgElement) {
          const rect = msgElement.getBoundingClientRect()
          // 找到第一个出现在可视区域顶部的元素，滚动到下一条用户消息
          if (rect.bottom > containerRect.top) {
            for (let j = i + 1; j < renderItems.length; j++) {
              if (renderItems[j].messages.some((msg) => msg.role === 'user')) {
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
  }, [renderItems])

  const [atBottom, setAtBottom] = useState(false)
  const [atTop, setAtTop] = useState(false)

  const [showScrollToPrev, setShowScrollToPrev] = useState(false)
  const lastScrollTop = useRef<number>()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleScrollTopThrottled = useThrottledCallback((scrollTop?: number) => {
    if (typeof scrollTop === 'number' && typeof lastScrollTop.current === 'number') {
      if (scrollTop > 0 && scrollTop < lastScrollTop.current) {
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
  }, 256)

  const handleScroll = useCallback<UIEventHandler>(
    (e) => {
      const scrollTop = e.currentTarget.scrollTop
      if (e.currentTarget.scrollHeight - (scrollTop + e.currentTarget.clientHeight) >= 0) {
        handleScrollTopThrottled(scrollTop)
      }
    },
    [handleScrollTopThrottled]
  )
  // message navigation handlers end

  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅执行一次
  useEffect(() => {
    setMessageScrolling(virtuoso)
    const currentVirtuoso = virtuoso.current // 清理时 virtuoso.current 已经为 null
    return () => {
      currentVirtuoso?.getState((state) => {
        if (state.ranges.length > 0) {
          // useEffect 可能执行两次，这里根据 ranges 判断是否为第一次 useEffect 严格测试导致的执行
          setScrollPosition(currentSession.id, state)
        }
      })
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅执行一次
  useEffect(() => {
    setMessageListElement(messageListRef)
  }, [])

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

  const renderMessageBlock = useCallback(
    (msg: SessionMessage, options: { isFirstItem: boolean; isLastItem: boolean }) => {
      return (
        <Stack key={msg.id} gap={0} pt={msg.role === 'user' ? 4 : 0}>
          {currentThreadHash[msg.id] && (
            <ThreadLabel thread={currentThreadHash[msg.id]} sessionId={currentSession.id} />
          )}
          <ErrorBoundary name={`message-item`}>
            {msg.isSummary ? (
              <SummaryMessage
                msg={msg}
                className={options.isFirstItem ? 'pt-4' : options.isLastItem ? '!pb-4' : ''}
                isLatestSummary={msg.id === latestSummaryMessageId}
                onDelete={() => removeMessage(currentSession.id, msg.id)}
                sessionId={currentSession.id}
              />
            ) : (
              <Message
                id={msg.id}
                msg={msg}
                sessionId={currentSession.id}
                sessionType={currentSession.type || 'chat'}
                className={options.isFirstItem ? 'pt-4' : options.isLastItem ? '!pb-4' : ''}
                collapseThreshold={msg.role === 'system' ? 150 : undefined}
                buttonGroup={options.isLastItem && msg.role === 'assistant' ? 'always' : 'auto'}
                assistantAvatarKey={currentSession.assistantAvatarKey}
                sessionPicUrl={currentSession.picUrl}
              />
            )}
          </ErrorBoundary>
          {currentSession.messageForksHash?.[msg.id] && currentSession.messageForksHash[msg.id].lists.length > 1 && (
            <Flex justify="flex-end" pr="md" mr="md" className="self-end">
              <ForkNav sessionId={currentSession.id} msgId={msg.id} forks={currentSession.messageForksHash[msg.id]} />
            </Flex>
          )}
        </Stack>
      )
    },
    [currentSession, currentThreadHash, latestSummaryMessageId]
  )

  useImperativeHandle(ref, () => ({
    scrollToTop: (behavior = 'auto') => virtuoso.current?.scrollTo({ top: 0, behavior }),
    scrollToBottom: (behavior = 'auto') => virtuoso.current?.scrollTo({ top: Infinity, behavior }),
    setIsNewMessage: (value: boolean) => setIsNewMessage(value),
  }))

  return (
    <div className={cn('w-full h-full mx-auto', props.className)}>
      <BlockCodeCollapsedStateProvider defaultCollapsed={!!settingsStore.getState().autoCollapseCodeBlock}>
        <div className="overflow-hidden h-full pr-0 pl-1 sm:pl-0 relative" ref={messageListRef}>
          <Virtuoso
            style={{ scrollbarGutter: 'stable' }}
            className={platformType === 'win32' ? 'scrollbar-custom' : ''}
            data={renderItems}
            ref={virtuoso}
            followOutput="smooth"
            {...(sessionScrollPositionCache.has(currentSession.id)
              ? {
                  restoreStateFrom: sessionScrollPositionCache.get(currentSession.id),
                  // 需要额外设置 initialScrollTop，否则恢复位置后 scrollTop 为 0。这时如果用户没有滚动，那么下次保存时 scrollTop 将记为 0，导致下一次恢复时位置始终为顶部。
                  initialScrollTop: sessionScrollPositionCache.get(currentSession.id)?.scrollTop,
                }
              : {
                  initialTopMostItemIndex: renderItems.length - 1,
                })}
            increaseViewportBy={{ top: 2000, bottom: 2000 }}
            itemContent={(index, item) => {
              const itemClassName = widthFull ? 'w-full' : 'max-w-4xl mx-auto'
              const isFirstItem = index === 0
              const isLastItem = index === renderItems.length - 1

              if (item.type === 'group') {
                return (
                  <div className={itemClassName}>
                    <div
                      className="flex flex-col pt-5"
                      style={
                        messageViewportHeight > 0 && isNewMessage
                          ? { minHeight: `${messageViewportHeight}px` }
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
                <div className={itemClassName}>{renderMessageBlock(item.messages[0], { isFirstItem, isLastItem })}</div>
              )
            }}
            atTopStateChange={setAtTop}
            atBottomStateChange={setAtBottom}
            onScroll={handleScroll}
          />

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
            <>
              <Transition mounted={showScrollToPrev && !atTop} transition="fade-down">
                {(transitionStyle) => (
                  <Flex
                    style={transitionStyle}
                    className="absolute z-10 top-0 left-0 right-0 leading-tight bg-chatbox-background-secondary"
                  >
                    {[
                      { text: t('Return to the top'), icon: IconArrowBarToUp, onClick: handleScrollToTop },
                      {
                        text: t('Back to previous message'),
                        icon: IconArrowUp,
                        onClick: handleScrollToPrev,
                      },
                    ].map((item, idx) => (
                      <Button
                        key={item.text}
                        variant="transparent"
                        className={cn('w-1/2', idx === 0 ? 'border-r border-r-chatbox-border-primary' : '')}
                        classNames={{
                          section: '!mr-xxs',
                        }}
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
              <Transition mounted={!atBottom} transition="slide-up">
                {(transitionStyle) => <ScrollToBottomButton onClick={handleScrollToBottom} style={transitionStyle} />}
              </Transition>
            </>
          )}
        </div>
      </BlockCodeCollapsedStateProvider>
    </div>
  )
})

export default memo(MessageList)

function ForkNav(props: { sessionId: string; msgId: string; forks: NonNullable<Session['messageForksHash']>[string] }) {
  const { sessionId, msgId, forks } = props
  const [flash, setFlash] = useState(false)
  const prevLength = useRef(forks.lists.length)
  const { t } = useTranslation()

  useEffect(() => {
    if (forks.lists.length > prevLength.current) {
      setFlash(true)
      const timer = setTimeout(() => setFlash(false), 2000)
      return () => clearTimeout(timer)
    }
    prevLength.current = forks.lists.length
  }, [forks.lists.length])

  return (
    <Flex gap="xs" align="center">
      <ActionIcon
        variant="subtle"
        size={20}
        radius="xl"
        color={flash ? 'chatbox-secondary' : 'chatbox-tertiary'}
        onClick={() => void switchFork(sessionId, msgId, 'prev')}
      >
        <IconChevronLeft />
      </ActionIcon>
      <ActionMenu
        position="bottom"
        items={[
          {
            text: t('expand'),
            icon: IconAlignRight,
            onClick: () => expandFork(sessionId, msgId),
          },
          {
            divider: true,
          },
          {
            doubleCheck: true,
            text: t('delete'),
            icon: IconTrash,
            onClick: () => deleteFork(sessionId, msgId),
          },
        ]}
      >
        <Text c={flash ? 'chatbox-secondary' : 'chatbox-tertiary'} size="xs" className="cursor-pointer">
          {forks.position + 1} / {forks.lists.length}
        </Text>
      </ActionMenu>
      <ActionIcon
        variant="subtle"
        size={20}
        radius="xl"
        color={flash ? 'chatbox-secondary' : 'chatbox-tertiary'}
        onClick={() => switchFork(sessionId, msgId, 'next')}
      >
        <IconChevronRight />
      </ActionIcon>
    </Flex>
  )
}

type ThreadLabelProps = {
  sessionId: string
  thread: SessionThreadBrief
}
const ThreadLabel: FC<ThreadLabelProps> = memo(({ thread, sessionId }) => {
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
    if (!thread.id) return
    void removeThread(sessionId, thread.id)
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
          { divider: true },
          {
            doubleCheck: true,
            text: t('delete'),
            icon: IconTrash,
            onClick: handleDeleteThread,
          },
        ]}
      >
        <span
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
