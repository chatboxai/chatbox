import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Text } from '@mantine/core'
import { IconCopy, IconDots, IconEdit, IconStar, IconStarFilled, IconTrash } from '@tabler/icons-react'
import clsx from 'clsx'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionMeta } from 'src/shared/types'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { router } from '@/router'
import {
  deleteSession as deleteSessionStore,
  getSession,
  updateSession as updateSessionStore,
} from '@/stores/chatStore'
import { copyAndSwitchSession, switchCurrentSession } from '@/stores/sessionActions'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu, { type ActionMenuItemProps } from './ActionMenu'
import { AssistantAvatar } from './Avatar'
import { ScalableIcon } from './ScalableIcon'

export interface Props {
  session: SessionMeta
  selected: boolean
}

function SessionItem(props: Props) {
  const { session, selected } = props
  const { t } = useTranslation()
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const onClick = () => {
    switchCurrentSession(session.id)
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }
  const isSmallScreen = useIsSmallScreen()
  // const smallSize = theme.typography.pxToRem(20)

  const [menuOpened, setMenuOpened] = useState(false)

  const actionMenuItems = useMemo<ActionMenuItemProps[]>(
    () => [
      {
        text: t('edit'),
        icon: IconEdit,
        onClick: async () => {
          await NiceModal.show('session-settings', {
            session: await getSession(session.id),
          })
        },
      },
      {
        text: t('copy'),
        icon: IconCopy,
        onClick: () => {
          copyAndSwitchSession(session)
        },
      },
      {
        text: session.starred ? t('unstar') : t('star'),
        icon: session.starred ? IconStarFilled : IconStar,
        onClick: () => {
          void updateSessionStore(session.id, (s) => {
            if (!s) {
              throw new Error(`Session ${session.id} not found`)
            }
            return { ...s, starred: !s?.starred }
          })
        },
      },
      { divider: true },
      {
        doubleCheck: true,
        text: t('delete'),
        icon: IconTrash,
        onClick: async () => {
          try {
            await deleteSessionStore(session.id)
            // Only navigate if deleting the currently selected session
            if (selected) {
              router.navigate({ to: '/', replace: true })
            }
          } catch (error) {
            console.error('Failed to delete session:', error)
          }
        },
      },
    ],
    [session, selected, t]
  )

  return (
    <Flex
      align="center"
      className={clsx(
        'cursor-pointer rounded-sm group/session-item',
        isSmallScreen
          ? ''
          : selected
            ? 'bg-chatbox-background-brand-secondary'
            : 'hover:bg-chatbox-background-gray-secondary'
      )}
      mx="xs"
      px="xs"
      py={10}
      gap={10}
      onClick={onClick}
    >
      <AssistantAvatar
        avatarKey={session.assistantAvatarKey}
        picUrl={session.picUrl}
        sessionType={session.type}
        size="sm"
        type="chat"
        c={selected ? 'chatbox-brand' : 'chatbox-primary'}
      />

      <Text span flex={1} lineClamp={1} c={selected ? 'chatbox-brand' : 'chatbox-primary'}>
        {session.name}
      </Text>

      <ActionMenu
        items={actionMenuItems}
        position="bottom-start"
        opened={menuOpened}
        onChange={(opened) => setMenuOpened(opened)}
      >
        <ActionIcon
          variant="transparent"
          size={20}
          color={session.starred ? 'chatbox-brand' : 'chatbox-tertiary'}
          className={isSmallScreen || session.starred || menuOpened ? '' : 'group-hover/session-item:visible invisible'}
          onClick={(event) => {
            event.stopPropagation()
            event.preventDefault()
          }}
        >
          {session.starred ? (
            <ScalableIcon icon={IconStarFilled} className="text-inherit" size={16} />
          ) : (
            <ScalableIcon icon={IconDots} className="text-inherit" size={16} />
          )}
        </ActionIcon>
      </ActionMenu>
    </Flex>
  )
}

export default memo(SessionItem)
