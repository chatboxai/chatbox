import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Box, Flex, Input, Text } from '@mantine/core'
import { AutomationAdjacentAttr, AutomationStateAttr, TestId } from '@shared/automation/testids'
import type { SessionMetaRecord } from '@shared/types'
import {
  IconArchive,
  IconArrowsMoveVertical,
  IconClockHour4,
  IconFolderShare,
  IconLoader2,
  IconPinned,
  IconPinnedFilled,
} from '@tabler/icons-react'
import clsx from 'clsx'
import dayjs from 'dayjs'
import { type MouseEvent, memo, type PointerEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { ShortcutKeysChip } from '@/components/Shortcut'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useTouchLayout } from '@/hooks/useTouchLayout'
import { navigateToSettings } from '@/modals/settings-navigation'
import { showSessionArchiveUndo } from '@/presentation/session/session-archive-notification'
import { router } from '@/router'
import { switchCurrentSession } from '@/stores/session/crud'
import { useSessionActivity } from '@/stores/sessionActivityStore'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import { AssistantAvatar } from '../common/Avatar'
import { ScalableIcon } from '../common/ScalableIcon'
import { useSidebarContextMenu } from './useSidebarContextMenu'

const ARCHIVED_SESSION_CLEANUP_THRESHOLD = 600

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

export interface Props {
  session: SessionMetaRecord
  selected: boolean
  hideAvatar?: boolean
  isReordering?: boolean
  onStartReordering?: () => void
  /**
   * Digit that opens this conversation while the switch modifier is held. Set
   * only while the list is peeking, so the row shows the key instead of its
   * trailing time and hover actions.
   */
  switchShortcutDigit?: number
}

function SessionItem(props: Props) {
  const { session, selected } = props
  const switchShortcutDigit = props.switchShortcutDigit
  const { t } = useTranslation()
  const activity = useSessionActivity(session.id, session.hasPausedToolCall === true)
  const activityLabel =
    activity === 'generating'
      ? t('Generating...')
      : activity === 'waiting'
        ? t('Waiting for you...')
        : activity === 'failed'
          ? t('Failed')
          : t('Completed')
  const pinActionLabel = session.starred ? t('Unpin') : t('Pin')
  const archiveActionLabel = t('Archive')
  const moveToProjectLabel = t('Move to project')
  const openMoveToProject = () => {
    void NiceModal.show('session-folder-move', { sessionId: session.id, folderId: session.folderId })
  }
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const onClick = () => {
    if (props.isReordering || renaming) {
      return
    }
    if (consumeClick()) {
      return
    }
    switchCurrentSession(session.id)
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }
  const isSmallScreen = useIsSmallScreen()
  const touchLayout = useTouchLayout()
  // const smallSize = theme.typography.pxToRem(20)

  const [archiving, setArchiving] = useState(false)
  const [actionTooltipDismissed, setActionTooltipDismissed] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const {
    menuOpened,
    menuPortalTarget,
    longPressing,
    consumeClick,
    handleContextMenu,
    handleMenuChange,
    handlePointerDown,
    handlePointerMove,
    clearLongPressTimer,
  } = useSidebarContextMenu({
    touchLayout,
    disabled: props.isReordering || renaming || switchShortcutDigit !== undefined,
    nativeContextMenu: renaming,
  })
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
    if (touchLayout || props.isReordering || !renameClickStartedOnSelectedSessionRef.current) {
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
    void rendererApplication.sessions.updateSessionHeader(session.id, { name }).catch((error) => {
      console.error('Failed to rename session:', error)
    })
  }

  const archiveCurrentSession = async () => {
    if (archiving) {
      return
    }
    setArchiving(true)
    try {
      await rendererApplication.sessions.archiveSession(session.id)
    } catch (error) {
      console.error('Failed to archive session:', error)
      toastActions.add(t('Failed to archive chat. Please try again.') || '')
      setArchiving(false)
      return
    }

    showSessionArchiveUndo({
      t,
      restore: () => rendererApplication.sessions.restoreSession(session.id),
      openSession: () => switchCurrentSession(session.id),
    })

    if (selected) {
      await router.navigate({ to: '/', replace: true }).catch((error) => {
        console.error('Failed to navigate after archiving session:', error)
      })
    }

    try {
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
      }
    } catch (error) {
      console.error('Failed to check archived session cleanup:', error)
    }
    setArchiving(false)
  }

  const handlePointerLeave = () => {
    clearLongPressTimer()
    setActionTooltipDismissed(false)
  }

  const menuItems: ActionMenuItemProps[] = [
    {
      text: pinActionLabel || '',
      icon: session.starred ? IconPinnedFilled : IconPinned,
      onClick: () => {
        void rendererApplication.sessions.updateSessionHeader(session.id, { starred: !session.starred })
      },
    },
    // A pinned chat stays in Pinned; it returns to its project once unpinned.
    ...(session.starred
      ? []
      : [
          {
            text: moveToProjectLabel || '',
            icon: IconFolderShare,
            onClick: openMoveToProject,
          },
        ]),
    // Hover layouts reorder by dragging; the menu entry starts the touch reorder mode.
    ...(touchLayout
      ? [
          {
            text: t('Adjust order') || '',
            icon: IconArrowsMoveVertical,
            disabled: !props.onStartReordering,
            onClick: props.onStartReordering,
          },
        ]
      : []),
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
      {...{ [AutomationAdjacentAttr.sessionId]: session.id }}
      {...{ [AutomationStateAttr.sessionPinned]: String(Boolean(session.starred)) }}
      align="center"
      className={clsx(
        'cursor-pointer rounded-md group/session-item',
        'select-none',
        props.isReordering && 'cursor-grab active:cursor-grabbing',
        props.isReordering
          ? 'bg-chatbox-background-primary'
          : selected
            ? 'bg-chatbox-background-secondary-hover'
            : touchLayout
              ? longPressing && 'bg-chatbox-background-gray-secondary'
              : 'hover:bg-chatbox-background-gray-secondary'
      )}
      ml="xs"
      mr={isSmallScreen ? 'xs' : 0}
      mih={isSmallScreen ? 44 : 36}
      pl="xs"
      pr={props.isReordering ? 44 : 'xs'}
      py={isSmallScreen ? 10 : 6}
      gap={10}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPressTimer}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={clearLongPressTimer}
    >
      {!props.hideAvatar && (
        <AssistantAvatar
          avatarKey={session.assistantAvatarKey}
          picUrl={session.picUrl}
          sessionType={session.type}
          size="sm"
          type="chat"
          c="chatbox-primary"
        />
      )}

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
            input: '!h-6 !min-h-6 !px-1.5 !text-sm !text-chatbox-tint-primary',
          }}
        />
      ) : (
        <Text
          data-testid={TestId.sidebar.sessionTitle}
          span
          flex={1}
          lineClamp={1}
          c="chatbox-primary"
          fw={selected ? 500 : undefined}
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
          aria-label={activityLabel}
          title={activityLabel}
          className={clsx(
            'shrink-0 flex h-5 w-5 items-center justify-center',
            !touchLayout && 'group-hover/session-item:hidden'
          )}
        >
          {activity === 'generating' ? (
            <ScalableIcon icon={IconLoader2} size={15} className="animate-spin text-chatbox-brand" />
          ) : activity === 'waiting' ? (
            <ScalableIcon icon={IconClockHour4} size={15} className="text-chatbox-tint-warning" />
          ) : (
            <Box
              component="span"
              w={8}
              h={8}
              bg={activity === 'failed' ? 'chatbox-error' : 'chatbox-brand'}
              className="rounded-full"
            />
          )}
        </Box>
      )}

      {!renaming && activity === 'idle' && switchShortcutDigit === undefined && (
        <Text span c="chatbox-tertiary" fz={11} className="shrink-0 tabular-nums group-hover/session-item:hidden">
          {formatSessionTime(session.createdAt)}
        </Text>
      )}

      {switchShortcutDigit !== undefined && !renaming && (
        // `flex` keeps the slot at the hint's own height: an inline wrapper would
        // add the inherited line box and make the peeked row taller than the rest.
        <Box component="span" data-testid={TestId.sidebar.sessionSwitchHint} aria-hidden className="flex shrink-0">
          <ShortcutKeysChip keys={['mod', String(switchShortcutDigit)]} />
        </Box>
      )}

      <Flex
        gap={2}
        className={clsx(
          touchLayout || renaming || switchShortcutDigit !== undefined
            ? 'hidden'
            : 'group-hover/session-item:flex hidden'
        )}
      >
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
              void rendererApplication.sessions.updateSessionHeader(session.id, { starred: !session.starred })
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

  return (
    <ActionMenu
      type="contextual"
      trigger="manual"
      items={menuItems}
      opened={menuOpened}
      portalProps={{ target: menuPortalTarget }}
      onChange={handleMenuChange}
      position={isSmallScreen ? 'bottom-end' : 'bottom-start'}
      offset={0}
    >
      {content}
    </ActionMenu>
  )
}

export default memo(SessionItem)
