import { ActionIcon, Box, Flex, Input, Text } from '@mantine/core'
import type { Folder } from '@shared/types/folder'
import {
  IconChevronRight,
  IconDots,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconMessagePlus,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { type MouseEvent, memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionMenu, { type ActionMenuItemProps } from '@/components/ActionMenu'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

export interface SidebarFolderItemProps {
  folder: Folder
  depth: number
  expanded: boolean
  isDropTarget?: boolean
  showTreeLine?: boolean
  /** When true the row mounts directly in inline-rename mode (create flow). */
  initialEditing?: boolean
  onToggle(): void
  onRename(name: string): void
  onCreateChat(): void
  onCreateSubfolder(): void
  onDelete(): void
}

const INDENT_PX = 16

/**
 * Folder row for the sidebar tree. Renders:
 * - expand/collapse chevron (rotated when expanded)
 * - folder icon (open/closed)
 * - inline-editable name
 * - vertical tree-line on the left for children (visual nesting rhythm)
 * - hover actions: new chat, new subfolder, more menu
 *
 * Tap toggles expand on mobile; long-press opens the context menu (handled by
 * ActionMenu contextual trigger wired to the row).
 */
function SidebarFolderItem(props: SidebarFolderItemProps) {
  const { folder, depth, expanded, isDropTarget, showTreeLine = true, initialEditing } = props
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const [editing, setEditing] = useState(Boolean(initialEditing))
  const [draftName, setDraftName] = useState(folder.name)
  const [menuOpened, setMenuOpened] = useState(false)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== folder.name) {
      props.onRename(trimmed)
    } else {
      setDraftName(folder.name)
    }
  }

  const cancelRename = () => {
    setEditing(false)
    setDraftName(folder.name)
  }

  const stopPropagation = (e: MouseEvent) => {
    e.stopPropagation()
  }

  const handleRowClick = () => {
    if (editing) return
    props.onToggle()
  }

  const menuItems: ActionMenuItemProps[] = [
    {
      text: t('New Chat in Folder') || '',
      icon: IconMessagePlus,
      onClick: props.onCreateChat,
    },
    {
      text: t('Create Subfolder') || '',
      icon: IconFolderPlus,
      onClick: props.onCreateSubfolder,
    },
    {
      text: t('Rename Folder') || '',
      icon: IconPencil,
      onClick: () => {
        setDraftName(folder.name)
        setEditing(true)
      },
    },
    {
      divider: true,
    },
    {
      text: t('Delete Folder') || '',
      icon: IconTrash,
      color: 'chatbox-error',
      doubleCheck: true,
      onClick: () => {
        void props.onDelete()
      },
    },
  ]

  return (
    <Box className="relative" style={{ paddingLeft: depth * INDENT_PX }} onClick={handleRowClick}>
      {showTreeLine && depth > 0 && <TreeLine />}
      <Flex
        align="center"
        gap={6}
        mx="xs"
        pl="xs"
        pr="xs"
        py={7}
        className={clsx(
          'cursor-pointer rounded-sm select-none group/folder-item',
          isDropTarget && 'bg-chatbox-background-brand-secondary',
          !isSmallScreen && 'hover:bg-chatbox-background-gray-secondary',
          isSmallScreen && menuOpened && 'bg-chatbox-background-gray-secondary'
        )}
      >
        <ActionIcon variant="transparent" color="chatbox-tertiary" size={16} className="flex-shrink-0">
          <IconChevronRight
            size={14}
            style={{
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 120ms ease',
            }}
          />
        </ActionIcon>

        <ScalableIcon
          icon={expanded ? IconFolderOpen : IconFolder}
          size={16}
          className="text-chatbox-secondary flex-shrink-0"
        />

        {editing ? (
          <Input
            variant="unstyled"
            size="xs"
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.currentTarget.value)}
            onClick={stopPropagation}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelRename()
              }
            }}
            className="flex-1"
          />
        ) : (
          <Text span flex={1} lineClamp={1} c="chatbox-primary">
            {folder.name}
          </Text>
        )}

        {!editing && !isSmallScreen && (
          <Flex gap={2} className="hidden group-hover/folder-item:flex">
            <ActionIcon
              variant="transparent"
              size={18}
              color="chatbox-tertiary"
              aria-label={t('Rename Folder') || ''}
              onPointerDown={stopPropagation}
              onClick={(e) => {
                stopPropagation(e)
                setDraftName(folder.name)
                setEditing(true)
              }}
            >
              <IconPencil size={15} />
            </ActionIcon>
            <ActionIcon
              variant="transparent"
              size={18}
              color="chatbox-tertiary"
              onPointerDown={stopPropagation}
              onClick={(e) => {
                stopPropagation(e)
                props.onCreateChat()
              }}
            >
              <IconMessagePlus size={15} />
            </ActionIcon>
            <ActionIcon
              variant="transparent"
              size={18}
              color="chatbox-tertiary"
              onPointerDown={stopPropagation}
              onClick={(e) => {
                stopPropagation(e)
                props.onCreateSubfolder()
              }}
            >
              <IconFolderPlus size={15} />
            </ActionIcon>
          </Flex>
        )}
      </Flex>

      {/* More menu (desktop hover dot + mobile contextual). Mobile opens via
          long-press handled by ActionMenu contextual trigger wrapping the row. */}
      {!editing && !isSmallScreen && (
        <Box className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover/folder-item:block">
          <ActionMenu type="desktop" items={menuItems} position="bottom-end">
            <ActionIcon
              variant="transparent"
              size={18}
              color="chatbox-tertiary"
              onPointerDown={stopPropagation}
              onClick={stopPropagation}
            >
              <IconDots size={15} />
            </ActionIcon>
          </ActionMenu>
        </Box>
      )}

      {/* Mobile context menu wraps the whole row */}
      {isSmallScreen && !editing && (
        <ActionMenu
          type="contextual"
          trigger="manual"
          items={menuItems}
          opened={menuOpened}
          onChange={setMenuOpened}
          position="bottom-end"
          offset={0}
        >
          <Box className="absolute inset-0" />
        </ActionMenu>
      )}
    </Box>
  )
}

/** Thin vertical tree-line drawn on the left edge of child rows. */
function TreeLine() {
  return (
    <span
      aria-hidden
      className="absolute top-0 bottom-0 w-px bg-chatbox-border-primary opacity-40"
      style={{ left: 0 }}
    />
  )
}

export default memo(SidebarFolderItem)
