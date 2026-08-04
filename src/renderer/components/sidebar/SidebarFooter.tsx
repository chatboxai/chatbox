import { ActionIcon, Box, Flex, Text, Tooltip } from '@mantine/core'
import { IconHelpCircle, IconInfoCircle, IconSettingsFilled } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useUpdateStore } from '@/stores/updateStore'
import { CHATBOX_BUILD_TARGET } from '@/variables'

interface SidebarFooterProps {
  buildNumber: string
  isSmallScreen: boolean
  /** Suppresses the Help entry when the store-review update guard is active. */
  hideHelp: boolean
  /** Mobile: remote API says an update is available. */
  mobileUpdateAvailable: boolean
  onSettingsClick(): void
  onHelpClick(): void
  onAboutClick(): void
}

/**
 * Sidebar footer matching the refactor wireframe: a compact icon row with only
 * three actions — Settings, Help, About. The About icon shows the build number
 * as plain text to its right, and an update dot when an update is available.
 *
 * The previous text-based bottom nav (New Chat, Create Image, My Copilots,
 * Settings, Help, About) is replaced by this row. "New Chat" moved into the
 * header icon; "Create Image" is intentionally removed from the sidebar (a TODO
 * comment in the shell marks its future home in the main toolbar).
 */
export default function SidebarFooter({
  buildNumber,
  isSmallScreen,
  hideHelp,
  mobileUpdateAvailable,
  onSettingsClick,
  onHelpClick,
  onAboutClick,
}: SidebarFooterProps) {
  const { t } = useTranslation()

  return (
    <Flex gap={isSmallScreen ? 'md' : 'lg'} align="center" px="md" py="sm">
      <Tooltip label={t('Settings')} openDelay={1000} withArrow>
        <ActionIcon variant="transparent" color="chatbox-secondary" size={24} onClick={onSettingsClick}>
          <IconSettingsFilled size={20} />
        </ActionIcon>
      </Tooltip>

      {!hideHelp && (
        <Tooltip label={t('Help')} openDelay={1000} withArrow>
          <ActionIcon variant="transparent" color="chatbox-secondary" size={24} onClick={onHelpClick}>
            <IconHelpCircle size={20} />
          </ActionIcon>
        </Tooltip>
      )}

      <Flex align="center" gap={4}>
        <Tooltip label={t('About')} openDelay={1000} withArrow>
          <Box className="relative" style={{ display: 'inline-flex' }}>
            <ActionIcon variant="transparent" color="chatbox-secondary" size={24} onClick={onAboutClick}>
              <IconInfoCircle size={20} />
            </ActionIcon>
            <UpdateDot mobileUpdateAvailable={mobileUpdateAvailable} />
          </Box>
        </Tooltip>
        {buildNumber && (
          <Text span c="chatbox-tertiary" size="xs" lh={1}>
            {buildNumber}
          </Text>
        )}
      </Flex>
    </Flex>
  )
}

function UpdateDot({ mobileUpdateAvailable }: { mobileUpdateAvailable: boolean }) {
  const updateStatus = useUpdateStore((s) => s.status)
  const isMobile = CHATBOX_BUILD_TARGET === 'mobile_app'
  // Desktop: electron-updater downloaded update. Mobile: remote needCheckUpdate.
  const show = isMobile ? mobileUpdateAvailable : updateStatus === 'downloaded'
  if (!show) return null
  return <Box w={8} h={8} bg="chatbox-brand" className="absolute -top-0.5 -right-0.5" style={{ borderRadius: '50%' }} />
}
