import { Box, Flex, Image, Text } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { FORCE_ENABLE_DEV_PAGES } from '@/dev/devToolsConfig'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen, useSidebarWidth } from '@/hooks/useScreenChange'
import platform from '@/platform'
import icon from '@/static/icon.png'
import { useUIStore } from '@/stores/uiStore'
import { IconButton } from '../common/IconButton'
import ThemeSwitchButton from '../dev/ThemeSwitchButton'
import WindowControls from './WindowControls'

/** Width kept clear for the macOS traffic lights. */
const MAC_WINDOW_CONTROLS_WIDTH = 80

const titleBarSlotAtom = atom<HTMLElement | null>(null)

/**
 * Height of the app title bar, or 0 when the layout has none (small screens keep a per-page header).
 * Web and touch devices get a taller bar for easier pointing.
 */
export function useAppTitleBarHeight() {
  const isSmallScreen = useIsSmallScreen()
  if (isSmallScreen) {
    return 0
  }
  return platform.isDesktopLike ? 40 : 44
}

/**
 * One row across the top of the window: app name and sidebar toggle over the sidebar, the current
 * page's title and actions over the content (rendered into the slot by `TitleBarContent`), and the
 * window buttons on Windows/Linux. Empty space drags the window.
 */
export function AppTitleBar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const height = useAppTitleBarHeight()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const sidebarWidth = useSidebarWidth()
  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()
  const setSlot = useSetAtom(titleBarSlotAtom)

  if (!height) {
    return null
  }

  const toggleLabel = showSidebar ? t('Collapse') : t('Expand')

  return (
    <Flex h={height} align="center" className="title-bar relative z-[1] flex-none" data-testid={TestId.layout.titleBar}>
      <Flex
        align="center"
        gap="xs"
        h="100%"
        pe="xs"
        ps={needRoomForMacWindowControls ? MAC_WINDOW_CONTROLS_WIDTH : 'md'}
        w={showSidebar ? sidebarWidth : undefined}
        className="flex-none box-border"
      >
        {showSidebar && (
          <Flex
            align="center"
            gap="xs"
            miw={0}
            className="controls cursor-pointer"
            onClick={() => navigate({ to: '/about' })}
          >
            <Image src={icon} w={18} h={18} />
            <Text span fz={14} fw={600} lh="20px" c="chatbox-primary" truncate>
              Chatbox
            </Text>
          </Flex>
        )}
        {showSidebar && FORCE_ENABLE_DEV_PAGES && (
          <Box className="controls">
            <ThemeSwitchButton size="xs" />
          </Box>
        )}
        {showSidebar && <Box flex={1} />}
        <Tooltip label={toggleLabel} openDelay={1000} withArrow>
          <IconButton
            className="controls"
            icon={showSidebar ? IconLayoutSidebarLeftCollapse : IconLayoutSidebarLeftExpand}
            color="chatbox-tertiary"
            aria-label={toggleLabel}
            data-testid={showSidebar ? TestId.sidebar.collapse : TestId.layout.expandSidebar}
            onClick={() => setShowSidebar(!showSidebar)}
          />
        </Tooltip>
      </Flex>
      <Flex ref={setSlot} align="center" gap="xs" flex={1} miw={0} h="100%" px="md" />
      <WindowControls height={height} />
    </Flex>
  )
}

/** Renders the current page's title row into the app title bar. */
export function TitleBarContent({ children }: { children: ReactNode }) {
  const slot = useAtomValue(titleBarSlotAtom)
  return slot ? createPortal(children, slot) : null
}
