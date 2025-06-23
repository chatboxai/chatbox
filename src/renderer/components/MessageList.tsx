import { useCallback, useEffect, useRef, useState } from 'react'
import Message from './Message'
import * as atoms from '../stores/atoms'
import { useAtomValue, useSetAtom } from 'jotai'
import { Virtuoso, VirtuosoHandle, StateSnapshot } from 'react-virtuoso'
import * as scrollActions from '../stores/scrollActions'
import * as sessionActions from '../stores/sessionActions'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import StyledMenu from './StyledMenu'
import { MenuItem, useTheme, IconButton } from '@mui/material'
import SwapCallsIcon from '@mui/icons-material/SwapCalls'
import SegmentIcon from '@mui/icons-material/Segment'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import AddIcon from '@mui/icons-material/AddCircleOutline'
import { Session } from 'src/shared/types'
import { ConfirmDeleteMenuItem } from './ConfirmDeleteButton'
import { Button, Flex, Text } from '@mantine/core'
import { IconArrowBackUp, IconFilePencil } from '@tabler/icons-react'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

const sessionScrollPositionCache = new Map<string, StateSnapshot>()

export default function MessageList(props: { className?: string; currentSession: Session }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const isSmallScreen = useIsSmallScreen()

  const currentSession = props.currentSession
  const currentMessageList = useAtomValue(atoms.currentMessageListAtom)
  const currentThreadHash = useAtomValue(atoms.currentThreadHistoryHashAtom)
  const virtuoso = useRef<VirtuosoHandle>(null)
  const messageListRef = useRef<HTMLDivElement>(null)

  const setMessageListElement = useSetAtom(atoms.messageListElementAtom)
  const setMessageScrollingAtom = useSetAtom(atoms.messageScrollingAtom)
  const setAtTop = useSetAtom(atoms.messageScrollingAtTopAtom)
  const setAtBottom = useSetAtom(atoms.messageScrollingAtBottomAtom)
  const setMessageScrollingScrollPosition = useSetAtom(atoms.messageScrollingScrollPositionAtom)
  const setShowHistoryDrawer = useSetAtom(atoms.showThreadHistoryDrawerAtom)

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
  useEffect(() => {
    setMessageListElement(messageListRef)
  }, [])

  const [threadMenuAnchorEl, setThreadMenuAnchorEl] = useState<null | HTMLElement>(null)
  const [threadMenuClickedTopicId, setThreadMenuClickedTopicId] = useState<null | string>(null)
  const openThreadMenu = (event: React.MouseEvent<HTMLElement>, topicId: string) => {
    setThreadMenuAnchorEl(event.currentTarget)
    setThreadMenuClickedTopicId(topicId)
  }
  const closeThreadMenu = () => {
    setThreadMenuAnchorEl(null)
    setThreadMenuClickedTopicId(null)
  }

  const openHistoryDrawer = useCallback(() => {
    setShowHistoryDrawer(threadMenuClickedTopicId || true)
    closeThreadMenu()
  }, [threadMenuClickedTopicId])

  return (
    <div className={cn('w-full h-full mx-auto', props.className)}>
      <div className="overflow-auto h-full pr-0 pl-1 sm:pl-0" ref={messageListRef}>
        <Virtuoso
          data={currentMessageList}
          atTopStateChange={(atTop) => {
            setAtTop(atTop)
          }}
          atBottomStateChange={(atBottom) => {
            setAtBottom(atBottom)
          }}
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
              // <div key={msg.id}>
              <>
                {index !== 0 && currentThreadHash[msg.id] && (
                  <div className="text-center pb-4 pt-8" key={'divider-' + msg.id}>
                    <span
                      className="cursor-pointer font-bold border-solid border rounded-xxl py-2 px-3 border-slate-400/25"
                      onClick={(event) => openThreadMenu(event, currentThreadHash[msg.id].id)}
                    >
                      <span className="pr-1 opacity-60">#</span>
                      <span className="truncate inline-block align-bottom max-w-[calc(50%-4rem)] md:max-w-[calc(30%-4rem)]">
                        {currentThreadHash[msg.id].name || t('New Thread')}
                      </span>
                      {currentThreadHash[msg.id].createdAtLabel && (
                        <span className="pl-1 opacity-60 text-xs">{currentThreadHash[msg.id].createdAtLabel}</span>
                      )}
                    </span>
                  </div>
                )}
                <Message
                  id={msg.id}
                  key={'msg-' + msg.id}
                  msg={msg}
                  sessionId={currentSession.id}
                  sessionType={currentSession.type || 'chat'}
                  className={index === 0 ? 'pt-4' : ''}
                  collapseThreshold={msg.role === 'system' ? 150 : undefined}
                  preferCollapsedCodeBlock={index < currentMessageList.length - 10}
                />
                {currentSession.messageForksHash?.[msg.id] && (
                  <ForkNav
                    key={`fork_nav_${msg.id}`}
                    msgId={msg.id}
                    forks={currentSession.messageForksHash?.[msg.id]}
                  />
                )}
              </>
              // </div>
            )
          }}
          components={{
            Footer: () =>
              isSmallScreen &&
              currentMessageList &&
              currentMessageList.length > 0 && (
                <Flex justify="center">
                  {currentThreadHash[currentMessageList[currentMessageList.length - 1].id] ? (
                    <Button
                      leftSection={<IconArrowBackUp size={20} />}
                      variant="default"
                      radius="xl"
                      mb="md"
                      onClick={() => sessionActions.removeCurrentThread(currentSession.id)}
                    >
                      {t('Back to Previous')}
                    </Button>
                  ) : (
                    <Button
                      leftSection={<IconFilePencil size={20} />}
                      variant="default"
                      radius="xl"
                      mb="md"
                      onClick={() => sessionActions.startNewThread()}
                    >
                      {t('Start a New Thread')}
                    </Button>
                  )}
                </Flex>
              ),
          }}
          onWheel={(e) => {
            scrollActions.clearAutoScroll() // 鼠标滚轮滚动时，清除自动滚动
          }}
          onTouchMove={(e) => {
            scrollActions.clearAutoScroll() // 手机上触摸屏幕滑动时，清除自动滚动
          }}
          onScroll={(e) => {
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
        <StyledMenu
          anchorEl={threadMenuAnchorEl}
          open={Boolean(threadMenuAnchorEl)}
          onClose={closeThreadMenu}
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
          <MenuItem disableRipple onClick={openHistoryDrawer}>
            <SegmentIcon fontSize="small" />
            {t('Show in Thread List')}
          </MenuItem>
          <MenuItem
            disableRipple
            onClick={() => {
              if (threadMenuClickedTopicId) {
                sessionActions.switchThread(currentSession.id, threadMenuClickedTopicId)
              }
              closeThreadMenu()
            }}
          >
            <SwapCallsIcon fontSize="small" />
            {t('Continue this thread')}
          </MenuItem>
          <MenuItem
            disableRipple
            divider
            onClick={() => {
              if (threadMenuClickedTopicId) {
                sessionActions.moveThreadToConversations(currentSession.id, threadMenuClickedTopicId)
              }
              closeThreadMenu()
            }}
          >
            <AddIcon fontSize="small" />
            {t('Move to Conversations')}
          </MenuItem>
          <ConfirmDeleteMenuItem
            onDelete={() => {
              if (threadMenuClickedTopicId) {
                sessionActions.removeThread(currentSession.id, threadMenuClickedTopicId)
              }
              closeThreadMenu()
            }}
          />
        </StyledMenu>
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
  const theme = useTheme()

  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null)
  const [menuDelete, setMenuDelete] = useState<boolean>(false)
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
