import { Haptics, ImpactStyle } from '@capacitor/haptics'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Box, Flex, Input, Text } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { SessionMetaRecord } from '@shared/types'
import { IconArchive, IconArrowsMoveVertical, IconLoader2, IconPinned, IconPinnedFilled } from '@tabler/icons-react'
import clsx from 'clsx'
import dayjs from 'dayjs'
import { type MouseEvent, memo, type PointerEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { navigateToSettings } from '@/modals/settings-navigation'
import platform from '@/platform'
import { router } from '@/router'
import { rendererApplication } from '@/app/renderer-application'
import { switchCurrentSession } from '@/stores/session/crud'
import { useSessionActivity } from '@/stores/sessionActivityStore'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import { AssistantAvatar } from '../common/Avatar'
import { ScalableIcon } from '../common/ScalableIcon'

const ARCHIVE_TIP_STORAGE_KEY = 'chatbox:lastArchiveSessionTipAt'
const ARCHIVE_TIP_INTERVAL = 24 * 60 * 60 * 1000
const ARCHIVED_SESSION_CLEANUP_THRESHOLD = 600
const MOBILE_LONG_PRESS_DELAY = 550
const MOBILE_LONG_PRESS_MOVE_TOLERANCE = 10

function formatSessionTime(createdAt: number) {
  const created = dayjs(createdAt)
  const now = dayjs()
  if (created.isSame(now, 'day')) {
    return created.format('HH:mm')
  }
  if (created.isSame(now, 'year')) {
    return created.format('MM/DD')
  }
  return created.format('YY/MM/DD')
}

function triggerLongPressHaptic() {
  if (platform.type === 'mobile') {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
      navigator.vibrate?.(10)
    })
    return
  }
  navigator.vibrate?.(10)
}

export interface Props {
  session: SessionMetaRecord
  selected: boolean
  isReordering?: boolean
  onStartReordering?: () => void
}

function SessionItem(props: Props) {
  const { session, selected } = props
  const { t } = useTranslation()
  const activity = useSessionActivity(session.id)
  const pinActionLabel = session.starred ? t('Unpin') : t('Pin')
  const archiveActionLabel = t('Archive')
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const onClick = () => {
    if (props.isReordering || renaming) {
      return
    }
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }
    switchCurrentSession(session.id)
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }
  const isSmallScreen = useIsSmallScreen()
  // const smallSize = theme.typography.pxToRem(20)

  const [archiving, setArchiving] = useState(false)
  const [actionTooltipDismissed, setActionTooltipDismissed] = useState(false)
  const [mobileMenuOpened, setMobileMenuOpened] = useState(false)
  const [longPressing, setLongPressing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggeredRef = useRef(false)
  const longPressStartPointRef = useRef<{ x: number; y: number } | null>(null)
  const renameClickStartedOnSelectedSessionRef = useRef(selected)

  const stopItemClick = (event: MouseEvent | PointerEvent) => {
    event.stopPropagation()
    event.preventDefault()
  }

  const dismissActionTooltip = () => {
    setActionTooltipDismissed(true)
  }

  const startRenaming = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    if (
      isSmallScreen ||
      platform.type === 'mobile' ||
      props.isReordering ||
      !renameClickStartedOnSelectedSessionRef.current
    ) {
      return
    }
    setDraftName(session.name)
    setRenaming(true)
  }

  const finishRenaming = () => {
    const name = draftName.trim()
    setRenaming(false)
    if (!name || name === session.name) {
      return
    }
    void rendererApplication.sessions.updateSession(session.id, { name }).catch((error) => {
      console.error('Failed to rename session:', error)
    })
  }

  const showArchiveTipOncePerDay = () => {
    const now = Date.now()
    const lastTipAt = Number(localStorage.getItem(ARCHIVE_TIP_STORAGE_KEY) || 0)
    if (now - lastTipAt < ARCHIVE_TIP_INTERVAL) {
      return
    }
    localStorage.setItem(ARCHIVE_TIP_STORAGE_KEY, String(now))
    toastActions.add(t('Archived. Manage archived chats in Settings.') || '', 8000, {
      label: t('Manage') || '',
      settingsPath: '/archive',
    })
  }

  const archiveCurrentSession = async () => {
    if (archiving) {
      return
    }
    setArchiving(true)
    try {
      await rendererApplication.sessions.archiveSession(session.id)
      if (selected) {
        await router.navigate({ to: '/', replace: true })
      }
      const archivedSessionCount = await rendererApplication.sessions.countArchivedSessionsMeta()
      if (archivedSessionCount > ARCHIVED_SESSION_CLEANUP_THRESHOLD) {
        const confirmed = await NiceModal.show('confirm', {
          title: t('Too many archived chats'),
          message: t('You have archived more than {{count}} chats. Do you want to clean them up now?', {
            count: ARCHIVED_SESSION_CLEANUP_THRESHOLD,
          }),
          confirmText: t('Clean up'),
        })
        if (confirmed === true) {
          navigateToSettings('/archive')
        }
      } else {
        showArchiveTipOncePerDay()
      }
    } catch (error) {
      console.error('Failed to archive session:', error)
      setArchiving(false)
    }
  }

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressStartPointRef.current = null
    setLongPressing(false)
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (!isSmallScreen || props.isReordering) {
      return
    }
    clearLongPressTimer()
    longPressTriggeredRef.current = false
    longPressStartPointRef.current = { x: event.clientX, y: event.clientY }
    setLongPressing(true)
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      setLongPressing(false)
      triggerLongPressHaptic()
      setMobileMenuOpened(true)
    }, MOBILE_LONG_PRESS_DELAY)
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (!isSmallScreen || !longPressStartPointRef.current) {
      return
    }
    const deltaX = Math.abs(event.clientX - longPressStartPointRef.current.x)
    const deltaY = Math.abs(event.clientY - longPressStartPointRef.current.y)
    if (deltaX > MOBILE_LONG_PRESS_MOVE_TOLERANCE || deltaY > MOBILE_LONG_PRESS_MOVE_TOLERANCE) {
      clearLongPressTimer()
    }
  }

  const handlePointerLeave = () => {
    clearLongPressTimer()
    setActionTooltipDismissed(false)
  }

  const handleContextMenu = (event: MouseEvent) => {
    if (!isSmallScreen) {
      return
    }
    event.preventDefault()
  }

  const handleMobileMenuChange = (opened: boolean) => {
    setMobileMenuOpened(opened)
    if (!opened) {
      clearLongPressTimer()
      longPressTriggeredRef.current = false
    }
  }

  const mobileMenuItems: ActionMenuItemProps[] = [
    {
      text: pinActionLabel || '',
      icon: session.starred ? IconPinnedFilled : IconPinned,
      onClick: () => {
        void rendererApplication.sessions.updateSession(session.id, { starred: !session.starred })
      },
    },
    {
      text: t('Adjust order') || '',
      icon: IconArrowsMoveVertical,
      disabled: !props.onStartReordering,
      onClick: props.onStartReordering,
    },
    {
      text: archiveActionLabel || '',
      icon: IconArchive,
      disabled: archiving,
      onClick: () => {
        void archiveCurrentSession()
      },
    },
  ]

  const content = (
    <Flex
      data-testid={TestId.sidebar.sessionItem}
      data-session-id={session.id}
      align="center"
      className={clsx(
        'cursor-pointer rounded-lg group/session-item',
        'select-none',
        props.isReordering && 'cursor-grab active:cursor-grabbing',
        isSmallScreen
          ? props.isReordering
            ? 'bg-chatbox-background-primary'
            : longPressing
              ? 'bg-chatbox-background-gray-secondary'
              : ''
          : selected
            ? 'bg-chatbox-background-brand-secondary'
            : 'hover:bg-chatbox-background-gray-secondary'
      )}
      ml="xs"
      mr={isSmallScreen ? 'xs' : 0}
      pl="xs"
      pr={props.isReordering ? 44 : 'xs'}
      py={8}
      gap={10}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPressTimer}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={clearLongPressTimer}
    >
      <AssistantAvatar
        avatarKey={session.assistantAvatarKey}
        picUrl={session.picUrl}
        sessionType={session.type}
        size="sm"
        type="chat"
        c={selected ? 'chatbox-brand' : 'chatbox-primary'}
      />

      {renaming ? (
        <Input
          data-testid={TestId.sidebar.sessionTitle}
          aria-label={t('Name') || undefined}
          autoFocus
          flex={1}
          size="xs"
          value={draftName}
          onChange={(event) => setDraftName(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={finishRenaming}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              finishRenaming()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setRenaming(false)
            }
          }}
          className="min-w-0"
          classNames={{
            input: clsx(
              '!h-6 !min-h-6 !px-1.5 !text-sm',
              selected ? '!text-chatbox-tint-brand' : '!text-chatbox-tint-primary'
            ),
          }}
        />
      ) : (
        <Text
          data-testid={TestId.sidebar.sessionTitle}
          span
          flex={1}
          lineClamp={1}
          c={selected ? 'chatbox-brand' : 'chatbox-primary'}
          fw={activity === 'completed' ? 600 : undefined}
          onMouseDown={(event) => {
            if (event.detail === 1) {
              renameClickStartedOnSelectedSessionRef.current = selected
            }
          }}
          onDoubleClick={startRenaming}
        >
          {session.name}
        </Text>
      )}

      {activity !== 'idle' && !renaming && (
        <Box
          component="span"
          data-session-activity={activity}
          role="status"
          aria-label={activity === 'generating' ? t('Generating...') : t('Completed')}
          title={activity === 'generating' ? t('Generating...') : t('Completed')}
          className={clsx(
            'shrink-0 flex h-5 w-5 items-center justify-center',
            !isSmallScreen && 'group-hover/session-item:hidden'
          )}
        >
          {activity === 'generating' ? (
            <ScalableIcon icon={IconLoader2} size={15} className="animate-spin text-chatbox-brand" />
          ) : (
            <Box component="span" w={8} h={8} bg="chatbox-brand" className="rounded-full" />
          )}
        </Box>
      )}

      {!isSmallScreen && !renaming && activity === 'idle' && (
        <Text
          span
          c="chatbox-disabled"
          className="shrink-0 text-[10px] tabular-nums opacity-50 group-hover/session-item:hidden"
        >
          {formatSessionTime(session.createdAt)}
        </Text>
      )}

      <Flex gap={2} className={clsx(isSmallScreen || renaming ? 'hidden' : 'group-hover/session-item:flex hidden')}>
        <Tooltip label={pinActionLabel} openDelay={1000} withArrow disabled={actionTooltipDismissed}>
          <ActionIcon
            data-testid={TestId.sidebar.sessionPin}
            aria-label={pinActionLabel}
            variant="transparent"
            size={20}
            color={session.starred ? 'chatbox-brand' : 'chatbox-tertiary'}
            onPointerDown={stopItemClick}
            onClick={(event) => {
              stopItemClick(event)
              dismissActionTooltip()
              void rendererApplication.sessions.updateSession(session.id, { starred: !session.starred })
            }}
          >
            {session.starred ? (
              <ScalableIcon icon={IconPinnedFilled} className="text-inherit" size={16} />
            ) : (
              <ScalableIcon icon={IconPinned} className="text-inherit" size={16} />
            )}
          </ActionIcon>
        </Tooltip>

        <Tooltip label={archiveActionLabel} openDelay={1000} withArrow disabled={actionTooltipDismissed}>
          <ActionIcon
            data-testid={TestId.sidebar.sessionArchive}
            aria-label={archiveActionLabel}
            variant="transparent"
            size={20}
            color="chatbox-tertiary"
            loading={archiving}
            onPointerDown={stopItemClick}
            onClick={async (event) => {
              stopItemClick(event)
              if (archiving) {
                return
              }
              dismissActionTooltip()
              await archiveCurrentSession()
            }}
          >
            <ScalableIcon icon={IconArchive} className="text-inherit" size={16} />
          </ActionIcon>
        </Tooltip>
      </Flex>
    </Flex>
  )

  if (!isSmallScreen) {
    return content
  }

  return (
    <ActionMenu
      type="contextual"
      trigger="manual"
      items={mobileMenuItems}
      opened={mobileMenuOpened}
      onChange={handleMobileMenuChange}
      position="bottom-end"
      offset={0}
    >
      {content}
    </ActionMenu>
  )
}

export default memo(SessionItem)
