import { ActionIcon, Box, Flex, Image, Text, Tooltip } from '@mantine/core'
import {
  IconArrowBarRight,
  IconFolderPlus,
  IconLayoutSidebarLeftCollapse,
  IconMessagePlus,
  IconSearch,
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import ThemeSwitchButton from '@/components/dev/ThemeSwitchButton'
import { FORCE_ENABLE_DEV_PAGES } from '@/dev/devToolsConfig'
import icon from '@/static/icon.png'

interface SidebarHeaderProps {
  /** App version string (digits only), surfaced next to the logo on small screens. */
  version: string
  isSmallScreen: boolean
  onSearchClick(): void
  onCreateFolderClick(): void
  onCreateChatClick(): void
  onCollapseClick(): void
}

/**
 * Sidebar header matching the refactor wireframe:
 *
 *   [Chatbox logo/name]            [Search] [New Folder] [New Chat] [Collapse]
 *
 * - Logo/name remains clickable to `/about` (existing behavior).
 * - The old archive/clear-list icon is removed; New Folder and New Chat icons
 *   take its place (both carry a "+" overlay to indicate "create").
 * - The collapse icon is a right arrow (`→`) representing "hide panel".
 */
export default function SidebarHeader({
  version,
  isSmallScreen,
  onSearchClick,
  onCreateFolderClick,
  onCreateChatClick,
  onCollapseClick,
}: SidebarHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <Flex
      align="center"
      justify="space-between"
      gap="xs"
      px="md"
      py="sm"
      className="border-0 border-b border-solid border-chatbox-border-primary"
    >
      <Flex align="center" gap="sm" style={{ minWidth: 0, flex: 1 }}>
        <Flex
          align="center"
          gap="sm"
          onClick={() => navigate({ to: '/about' })}
          style={{ cursor: 'pointer', minWidth: 0 }}
        >
          <Image src={icon} w={20} h={20} />
          <Text span c="chatbox-secondary" size="xl" lh={1.2} fw="700" truncate>
            Chatbox
          </Text>
          {/* Desktop shows the build number in the footer About icon, so only
              surface the version here on mobile (matches previous behavior). */}
          {isSmallScreen && /\d/.test(version) && (
            <Text span c="chatbox-tertiary" size="sm">
              {version}
            </Text>
          )}
        </Flex>
        {FORCE_ENABLE_DEV_PAGES && <ThemeSwitchButton size="xs" />}
      </Flex>

      <Flex align="center" gap={2} style={{ flexShrink: 0 }}>
        <Tooltip label={t('Search')} openDelay={1000} withArrow>
          <ActionIcon variant="subtle" color="chatbox-tertiary" size={26} radius="md" onClick={onSearchClick}>
            <IconSearch size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('New Folder')} openDelay={1000} withArrow>
          <ActionIcon variant="subtle" color="chatbox-tertiary" size={26} radius="md" onClick={onCreateFolderClick}>
            <IconFolderPlus size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('New Chat')} openDelay={1000} withArrow>
          <ActionIcon variant="subtle" color="chatbox-tertiary" size={26} radius="md" onClick={onCreateChatClick}>
            <IconMessagePlus size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('Collapse')} openDelay={1000} withArrow>
          <ActionIcon variant="subtle" color="chatbox-tertiary" size={26} radius="md" onClick={onCollapseClick}>
            {isSmallScreen ? <IconArrowBarRight size={18} /> : <IconLayoutSidebarLeftCollapse size={18} />}
          </ActionIcon>
        </Tooltip>
      </Flex>
    </Flex>
  )
}

// Re-exported so the empty header spacer (for macOS window controls) can be
// rendered by the shell without duplicating the import site.
export function SidebarHeaderSpacer() {
  return <Box className="title-bar flex-[0_0_44px]" />
}
