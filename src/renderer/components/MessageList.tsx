import NiceModal from '@ebay/nice-modal-react'
import { Box, Button, Flex } from '@mantine/core'
import AddIcon from '@mui/icons-material/AddCircleOutline'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import EditIcon from '@mui/icons-material/Edit'
import SegmentIcon from '@mui/icons-material/Segment'
import SwapCallsIcon from '@mui/icons-material/SwapCalls'
import { IconButton, MenuItem } from '@mui/material'
import { IconArrowBackUp, IconFilePencil } from '@tabler/icons-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { type FC, Fragment, memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type StateSnapshot, Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { Session, SessionThreadBrief } from 'src/shared/types'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import * as atoms from '@/stores/atoms'
import * as scrollActions from '@/stores/scrollActions'
import * as sessionActions from '@/stores/sessionActions'
import { ConfirmDeleteMenuItem } from './ConfirmDeleteButton'
import Message from './Message'
import StyledMenu from './StyledMenu'

const sessionScrollPositionCache = new Map<string, StateSnapshot>()

export default function MessageList(props: { className?: string; currentSession: Session }) {
  const { currentSession } = props
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()

  const currentMessageList = useAtomValue(atoms.currentMessageListAtom)
  const currentThreadHash = useAtomValue(atoms.currentThreadHistoryHashAtom)
  const virtuoso = useRef<VirtuosoHandle>(null)
  const messageListRef = useRef<HTMLDivElement>(null)

  const setMessageListElement = useSetAtom(atoms.messageListElementAtom)
  const setMessageScrollingAtom = useSetAtom(atoms.messageScrollingAtom)
  const setAtTop = useSetAtom(atoms.messageScrollingAtTopAtom)
  const setAtBottom = useSetAtom(atoms.messageScrollingAtBottomAtom)
  const setMessageScrollingScrollPosition = useSetAtom(atoms.messageScrollingScrollPositionAtom)

  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅执行一次
  useEffect(() => {
    setMessageScrollingAtom(virtuoso)
    const currentVirtuoso = virtuoso.current // 清理时 virtuoso.current 已经为 null
    return () => {
      currentVirtuoso?.getState((state) => {
        if (state.ranges.length > 0) {
          // useEffect 可能执行两次，这里根据 ranges 判断是否为第一次 useEffect 严格测试导致的执行
          sessionScrollPositionCache.set(currentSession.id, state)
        }
      })
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅执行一次
  useEffect(() => {
    setMessageListElement(messageListRef)
  }, [])

  const [threadMenuAnchorEl, setThreadMenuAnchorEl] = useState<null | HTMLElement>(null)
  const [threadMenuClickedTopicId, setThreadMenuClickedTopicId] = useState<null | string>(null)

  const openThreadMenu = useCallback((event: React.MouseEvent<HTMLElement>, topicId: string) => {
    setThreadMenuAnchorEl(event.currentTarget)
    setThreadMenuClickedTopicId(topicId)
  }, [])

  const closeThreadMenu = useCallback(() => {
    setThreadMenuAnchorEl(null)
    setThreadMenuClickedTopicId(null)
  }, [])

  return (
    <div className={cn('w-full h-full mx-auto', props.className)}>
      <div className="overflow-auto h-full pr-0 pl-1 sm:pl-0" ref={messageListRef}>
        <Virtuoso
          style={{ scrollbarGutter: 'stable' }}
          data={currentMessageList}
          atTopStateChange={setAtTop}
          atBottomStateChange={setAtBottom}
          ref={virtuoso}
          followOutput={true}
          {...(sessionScrollPositionCache.has(currentSession.id)
            ? {
                restoreStateFrom: sessionScrollPositionCache.get(currentSession.id),
                // 需要额外设置 initialScrollTop，否则恢复位置后 scrollTop 为 0。这时如果用户没有滚动，那么下次保存时 scrollTop 将记为 0，导致下一次恢复时位置始终为顶部。
                initialScrollTop: sessionScrollPositionCache.get(currentSession.id)?.scrollTop,
              }
            : {
                initialTopMostItemIndex: currentMessageList.length - 1,
              })}
          increaseViewportBy={{ top: 2000, bottom: 2000 }}
          itemContent={(index, msg) => {
            return (
              <Fragment key={msg.id}>
                {currentThreadHash[msg.id] && (
                  <ThreadLabel thread={currentThreadHash[msg.id]} onThreadLabelClick={openThreadMenu} />
                )}
                <Message
                  id={msg.id}
                  msg={msg}
                  sessionId={currentSession.id}
                  sessionType={currentSession.type || 'chat'}
                  className={index === 0 ? 'pt-4' : ''}
                  collapseThreshold={msg.role === 'system' ? 150 : undefined}
                  preferCollapsedCodeBlock={index < currentMessageList.length - 10}
                />
                {currentSession.messageForksHash?.[msg.id] && (
                  <ForkNav msgId={msg.id} forks={currentSession.messageForksHash?.[msg.id]} />
                )}
              </Fragment>
            )
          }}
          components={{
            // biome-ignore lint/nursery/noNestedComponentDefinitions: todo
            Footer: () =>
              isSmallScreen &&
              currentMessageList &&
              currentMessageList.filter((m) => m.role !== 'system').length > 0 && (
                <Flex justify="center" align="center" gap="sm" mx="xs" pt="xxs" pb="sm">
                  <Box h="0.5px" bg="chatbox-border-primary" flex={1} />
                  {currentThreadHash[currentMessageList[currentMessageList.length - 1].id] ? (
                    <Button
                      leftSection={<IconArrowBackUp size={16} />}
                      classNames={{
                        root: ' shadow-sm',
                        section: '!mr-xxs',
                      }}
                      size="xs"
                      c="chatbox-tertiary"
                      variant="default"
                      radius="xl"
                      onClick={() => sessionActions.removeCurrentThread(currentSession.id)}
                    >
                      {t('Back to Previous')}
                    </Button>
                  ) : (
                    <Button
                      leftSection={<IconFilePencil size={16} />}
                      classNames={{
                        section: '!mr-xxs',
                      }}
                      size="xs"
                      c="chatbox-tertiary"
                      variant="default"
                      radius="xl"
                      onClick={() => sessionActions.startNewThread()}
                    >
                      {t('Start a New Thread')}
                    </Button>
                  )}
                  <Box h="0.5px" bg="chatbox-border-primary" flex={1} />
                </Flex>
              ),
          }}
          onWheel={() => {
            scrollActions.clearAutoScroll() // 鼠标滚轮滚动时，清除自动滚动
          }}
          onTouchMove={() => {
            scrollActions.clearAutoScroll() // 手机上触摸屏幕滑动时，清除自动滚动
          }}
          onScroll={() => {
            // 为什么不合并到 onWheel 中？
            // 实践中发现 onScroll 处理时效果会更加丝滑一些
            if (virtuoso.current) {
              virtuoso.current.getState((state) => {
                if (messageListRef.current) {
                  setMessageScrollingScrollPosition(state.scrollTop + messageListRef.current.clientHeight)
                }
              })
            }
          }}
          totalListHeightChanged={() => {
            if (virtuoso.current) {
              virtuoso.current.getState((state) => {
                if (messageListRef.current) {
                  setMessageScrollingScrollPosition(state.scrollTop + messageListRef.current.clientHeight)
                }
              })
            }
          }}
        />
        <ThreadMenu
          threadMenuAnchorEl={threadMenuAnchorEl}
          threadMenuClickedTopicId={threadMenuClickedTopicId}
          onThreadMenuClose={closeThreadMenu}
          currentSessionId={currentSession.id}
        />
      </div>
    </div>
  )
}

function ForkNav(props: { msgId: string; forks: NonNullable<Session['messageForksHash']>[string] }) {
  const { msgId, forks } = props
  const widthFull = useAtomValue(atoms.widthFullAtom)
  const [flash, setFlash] = useState(false)
  const prevLength = useRef(forks.lists.length)
  const { t } = useTranslation()

  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null)
  const [, setMenuDelete] = useState<boolean>(false)
  const openMenu = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget)
    setMenuDelete(false)
  }
  const closeMenu = () => {
    setMenuAnchorEl(null)
    setMenuDelete(false)
  }

  useEffect(() => {
    if (forks.lists.length > prevLength.current) {
      setFlash(true)
      const timer = setTimeout(() => setFlash(false), 2000)
      return () => clearTimeout(timer)
    }
    prevLength.current = forks.lists.length
  }, [forks.lists.length])

  return (
    <div className={cn('flex items-center justify-end', widthFull ? 'w-full' : 'max-w-4xl mx-auto')}>
      <div
        className={cn(
          'mt-[-35px] pr-4 inline-flex items-center gap-2',
          'opacity-50 hover:opacity-100',
          flash && 'animate-flash opacity-100 font-bold'
        )}
      >
        <IconButton
          aria-label="fork-left"
          size="small"
          className="hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
          onClick={() => sessionActions.switchFork(msgId, 'prev')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </IconButton>
        <div className="flex items-center gap-1 text-xs cursor-pointer" onClick={openMenu}>
          <span>{forks.position + 1}</span>
          <span>/</span>
          <span>{forks.lists.length}</span>
        </div>
        <IconButton
          aria-label="fork-right"
          size="small"
          className="hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
          onClick={() => sessionActions.switchFork(msgId, 'next')}
        >
          <ChevronRightIcon className="w-5 h-5" />
        </IconButton>
      </div>
      <StyledMenu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={closeMenu}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        PaperProps={{
          style: {
            minWidth: '120px',
          },
        }}
      >
        <MenuItem
          disableRipple
          onClick={() => {
            sessionActions.expandFork(msgId)
            closeMenu()
          }}
          className="bg-white"
        >
          <SegmentIcon fontSize="small" />
          {t('expand')}
        </MenuItem>
        <ConfirmDeleteMenuItem
          onDelete={() => {
            sessionActions.deleteFork(msgId)
            closeMenu()
          }}
        />
      </StyledMenu>
    </div>
  )
}

type ThreadLabelProps = {
  thread: SessionThreadBrief
  onThreadLabelClick?: (event: React.MouseEvent<HTMLElement>, threadId: string) => void
}
const ThreadLabel: FC<ThreadLabelProps> = memo((props) => {
  const { t } = useTranslation()
  const { thread, onThreadLabelClick } = props
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      onThreadLabelClick?.(event, thread.id)
    },
    [thread.id, onThreadLabelClick]
  )

  return (
    <div className="text-center pb-4 pt-8">
      <span
        className="cursor-pointer font-bold border-solid border rounded-xxl py-2 px-3 border-slate-400/25"
        onClick={onClick}
      >
        <span className="pr-1 opacity-60">#</span>
        <span className="truncate inline-block align-bottom max-w-[calc(50%-4rem)] md:max-w-[calc(30%-4rem)]">
          {thread.name || t('New Thread')}
        </span>
        {thread.createdAtLabel && <span className="pl-1 opacity-60 text-xs">{thread.createdAtLabel}</span>}
      </span>
    </div>
  )
})

type ThreadMenuProps = {
  threadMenuAnchorEl: null | HTMLElement
  threadMenuClickedTopicId: null | string
  onThreadMenuClose?: () => void
  currentSessionId: string
}
const ThreadMenu: FC<ThreadMenuProps> = memo((props) => {
  const { t } = useTranslation()
  const { threadMenuAnchorEl, threadMenuClickedTopicId, onThreadMenuClose, currentSessionId } = props
  const setShowHistoryDrawer = useSetAtom(atoms.showThreadHistoryDrawerAtom)

  const openHistoryDrawer = useCallback(() => {
    setShowHistoryDrawer(threadMenuClickedTopicId || true)
    onThreadMenuClose?.()
  }, [threadMenuClickedTopicId, setShowHistoryDrawer, onThreadMenuClose])

  const onEditThreadNameClick = useCallback(() => {
    if (!threadMenuClickedTopicId) return
    NiceModal.show('thread-name-edit', { sessionId: currentSessionId, threadId: threadMenuClickedTopicId })

    onThreadMenuClose?.()
  }, [threadMenuClickedTopicId, currentSessionId, onThreadMenuClose])

  const onContinueThreadClick = useCallback(() => {
    if (!threadMenuClickedTopicId) return
    sessionActions.switchThread(currentSessionId, threadMenuClickedTopicId)
    onThreadMenuClose?.()
  }, [threadMenuClickedTopicId, currentSessionId, onThreadMenuClose])

  const onMoveToConversationsClick = useCallback(() => {
    if (!threadMenuClickedTopicId) return
    sessionActions.moveThreadToConversations(currentSessionId, threadMenuClickedTopicId)
    onThreadMenuClose?.()
  }, [threadMenuClickedTopicId, currentSessionId, onThreadMenuClose])

  const onDeleteThreadClick = useCallback(() => {
    if (!threadMenuClickedTopicId) return
    sessionActions.removeThread(currentSessionId, threadMenuClickedTopicId)
    onThreadMenuClose?.()
  }, [threadMenuClickedTopicId, currentSessionId, onThreadMenuClose])

  return (
    <StyledMenu
      anchorEl={threadMenuAnchorEl}
      open={Boolean(threadMenuAnchorEl)}
      onClose={onThreadMenuClose}
      onDoubleClick={openHistoryDrawer}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'center',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'center',
      }}
    >
      <MenuItem disableRipple onClick={onEditThreadNameClick}>
        <EditIcon fontSize="small" />
        {t('Edit Thread Name')}
      </MenuItem>

      <MenuItem disableRipple onClick={openHistoryDrawer}>
        <SegmentIcon fontSize="small" />
        {t('Show in Thread List')}
      </MenuItem>
      <MenuItem disableRipple onClick={onContinueThreadClick}>
        <SwapCallsIcon fontSize="small" />
        {t('Continue this thread')}
      </MenuItem>
      <MenuItem disableRipple divider onClick={onMoveToConversationsClick}>
        <AddIcon fontSize="small" />
        {t('Move to Conversations')}
      </MenuItem>
      <ConfirmDeleteMenuItem onDelete={onDeleteThreadClick} />
    </StyledMenu>
  )
})
