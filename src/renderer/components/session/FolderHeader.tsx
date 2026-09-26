import { ActionIcon, Flex, Text } from '@mantine/core'
import type { SessionFolder } from '@shared/types'
import {
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconFolder,
  IconPencil,
  IconPlaylistAdd,
  IconTrash,
} from '@tabler/icons-react'
import clsx from 'clsx'
import NiceModal from '@ebay/nice-modal-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { deleteFolder } from '@/stores/sessionFolders'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import { ScalableIcon } from '../common/ScalableIcon'

export interface Props {
  folder: SessionFolder
}

function FolderHeader(props: Props) {
  const { folder } = props
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const collapsed = useUIStore((s) => s.collapsedFolders[folder.id] === true)
  const toggleFolderCollapsed = useUIStore((s) => s.toggleFolderCollapsed)
  // Keep the trigger visible while its menu is open: floating-ui cannot
  // position against a display:none reference, so a hover-hidden trigger
  // makes the open dropdown jump to the viewport's top-left corner the
  // moment the pointer leaves the row (e.g. moving onto the menu itself).
  const [menuOpened, setMenuOpened] = useState(false)

  const menuItems: ActionMenuItemProps[] = [
    {
      text: t('Add Chats to Folder') || '',
      icon: IconPlaylistAdd,
      onClick: () => {
        void NiceModal.show('folder-session-picker', { folder })
      },
    },
    {
      text: t('Rename Folder') || '',
      icon: IconPencil,
      onClick: () => {
        void NiceModal.show('folder-settings', { mode: 'rename', folder })
      },
    },
    {
      text: t('Delete Folder') || '',
      icon: IconTrash,
      color: 'chatbox-error',
      doubleCheck: true,
      onClick: () => {
        void deleteFolder(folder.id)
      },
    },
  ]

  return (
    <Flex
      align="center"
      className="cursor-pointer select-none rounded-lg hover:bg-chatbox-background-gray-secondary group/folder-header"
      mx="xs"
      px="xs"
      py={6}
      gap={8}
      aria-expanded={!collapsed}
      onClick={() => toggleFolderCollapsed(folder.id)}
    >
      <ScalableIcon
        icon={collapsed ? IconChevronRight : IconChevronDown}
        size={14}
        className="shrink-0 text-chatbox-tertiary"
      />
      <ScalableIcon icon={IconFolder} size={16} className="shrink-0 text-chatbox-tertiary" />
      <Text span flex={1} lineClamp={1} size="sm" fw={600} c="chatbox-secondary">
        {folder.name}
      </Text>
      <Flex
        className={clsx(
          isSmallScreen || menuOpened ? 'flex' : 'group-hover/folder-header:flex hidden'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <ActionMenu
          type="auto"
          trigger="click"
          items={menuItems}
          position="bottom-end"
          opened={isSmallScreen ? undefined : menuOpened}
          onChange={isSmallScreen ? undefined : setMenuOpened}
        >
          <ActionIcon variant="transparent" size={20} color="chatbox-tertiary" aria-label={t('More') || undefined}>
            <ScalableIcon icon={IconDots} className="text-inherit" size={16} />
          </ActionIcon>
        </ActionMenu>
      </Flex>
    </Flex>
  )
}

export default FolderHeader
