import { ActionIcon, Box, Button, Divider, Flex, Image, NavLink, Stack, Text, Tooltip } from '@mantine/core'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import {
  IconCirclePlus,
  IconCode,
  IconInfoCircle,
  IconLayoutSidebarLeftCollapse,
  IconMessageChatbot,
  IconPhotoPlus,
  IconSettingsFilled,
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ThemeSwitchButton from './components/dev/ThemeSwitchButton'
import { ScalableIcon } from './components/ScalableIcon'
import SessionList from './components/SessionList'
import { FORCE_ENABLE_DEV_PAGES } from './dev/devToolsConfig'
import useNeedRoomForMacWinControls from './hooks/useNeedRoomForWinControls'
import { useIsSmallScreen, useSidebarWidth } from './hooks/useScreenChange'
import useVersion from './hooks/useVersion'
import { navigateToSettings } from './modals/Settings'
import { trackingEvent } from './packages/event'
import icon from './static/icon.png'
import { createEmpty } from './stores/sessionActions'
import { useLanguage } from './stores/settingsStore'
import { useUIStore } from './stores/uiStore'
import { CHATBOX_BUILD_PLATFORM } from './variables'

export default function Sidebar() {
  const { t } = useTranslation()
  const versionHook = useVersion()
  const language = useLanguage()
  const navigate = useNavigate()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)

  const sessionListViewportRef = useRef<HTMLDivElement>(null)

  const sidebarWidth = useSidebarWidth()

  const isSmallScreen = useIsSmallScreen()

  const [isResizing, setIsResizing] = useState(false)
  const resizeStartX = useRef<number>(0)
  const resizeStartWidth = useRef<number>(0)

  const { needRoomForMacWindowControls } = useNeedRoomForMacWinControls()

  const handleCreateNewSession = useCallback(() => {
    navigate({ to: `/` })

    if (isSmallScreen) {
      setShowSidebar(false)
    }
    trackingEvent('create_new_conversation', { event_category: 'user' })
  }, [navigate, setShowSidebar, isSmallScreen])

  const handleCreateNewPictureSession = useCallback(() => {
    void createEmpty('picture')
    if (sessionListViewportRef.current) {
      sessionListViewportRef.current.scrollTo(0, 0)
    }
    if (isSmallScreen) {
      setShowSidebar(false)
    }
    trackingEvent('create_new_picture_conversation', { event_category: 'user' })
  }, [isSmallScreen, setShowSidebar])

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (isSmallScreen) return
      e.preventDefault()
      e.stopPropagation()
      setIsResizing(true)
      resizeStartX.current = e.clientX
      resizeStartWidth.current = sidebarWidth
    },
    [isSmallScreen, sidebarWidth]
  )

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const isRTL = language === 'ar'
      const deltaX = isRTL ? resizeStartX.current - e.clientX : e.clientX - resizeStartX.current
      const newWidth = Math.max(200, Math.min(500, resizeStartWidth.current + deltaX))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, language, setSidebarWidth])

  return (
    <SwipeableDrawer
      anchor={language === 'ar' ? 'right' : 'left'}
      variant={isSmallScreen ? 'temporary' : 'persistent'}
      open={showSidebar}
      onClose={() => setShowSidebar(false)}
      onOpen={() => setShowSidebar(true)}
      ModalProps={{
        keepMounted: true, // Better open performance on mobile.
      }}
      sx={{
        '& .MuiDrawer-paper': {
          backgroundImage: 'none',
          boxSizing: 'border-box',
          width: isSmallScreen ? '75vw' : sidebarWidth,
          maxWidth: '75vw',
        },
      }}
      SlideProps={language === 'ar' ? { direction: 'left' } : undefined}
      PaperProps={
        language === 'ar' ? { sx: { direction: 'rtl', overflowY: 'initial' } } : { sx: { overflowY: 'initial' } }
      }
      disableSwipeToOpen={CHATBOX_BUILD_PLATFORM !== 'ios'} // 只在iOS设备上启用SwipeToOpen
      disableEnforceFocus={true} // 关闭 focus trap，避免在侧边栏打开时弹出的 modal 中 input 无法点击
    >
      <Stack
        h="100%"
        gap={0}
        pt="var(--mobile-safe-area-inset-top, 0px)"
        pb="var(--mobile-safe-area-inset-bottom, 0px)"
        className="relative"
      >
        {needRoomForMacWindowControls && <Box className="title-bar flex-[0_0_44px]" />}
        <Flex align="center" justify="space-between" px="md" py="sm">
          <Flex align="center" gap="sm">
            <Image src={icon} w={20} h={20} />
            <Text span c="chatbox-secondary" size="xl" lh={1.2} fw="700">
              Chatbox
            </Text>
            {FORCE_ENABLE_DEV_PAGES && <ThemeSwitchButton size="xs" />}
          </Flex>

          <Tooltip label={t('Collapse')} openDelay={1000} withArrow>
            <ActionIcon variant="subtle" color="chatbox-tertiary" size={20} onClick={() => setShowSidebar(false)}>
              <IconLayoutSidebarLeftCollapse />
            </ActionIcon>
          </Tooltip>
        </Flex>

        <SessionList sessionListViewportRef={sessionListViewportRef} />

        <Stack gap={0} px="xs" pb="xs">
          <Divider />
          <Flex gap="xs" pt="xs" mb="xs">
            <Button variant="light" flex={1} onClick={handleCreateNewSession}>
              <ScalableIcon icon={IconCirclePlus} className="mr-2" />
              {t('New Chat')}
            </Button>
            <Button variant="light" px="sm" onClick={handleCreateNewPictureSession}>
              <ScalableIcon icon={IconPhotoPlus} />
            </Button>
          </Flex>
          <NavLink
            c="chatbox-secondary"
            className="rounded"
            label={t('My Copilots')}
            leftSection={<ScalableIcon icon={IconMessageChatbot} size={20} />}
            onClick={() => {
              navigate({
                to: '/copilots',
              })
              if (isSmallScreen) {
                setShowSidebar(false)
              }
            }}
            variant="light"
            p="xs"
          />
          <NavLink
            c="chatbox-secondary"
            className="rounded"
            label={t('Settings')}
            leftSection={<ScalableIcon icon={IconSettingsFilled} size={20} />}
            onClick={() => {
              navigateToSettings()
              if (isSmallScreen) {
                setShowSidebar(false)
              }
            }}
            variant="light"
            p="xs"
          />
          {FORCE_ENABLE_DEV_PAGES && (
            <NavLink
              c="chatbox-secondary"
              className="rounded"
              label="Dev Tools"
              leftSection={<ScalableIcon icon={IconCode} size={20} />}
              onClick={() => {
                navigate({
                  to: '/dev',
                })
                if (isSmallScreen) {
                  setShowSidebar(false)
                }
              }}
              variant="light"
              p="xs"
            />
          )}
          <NavLink
            c="chatbox-tertiary"
            className="rounded"
            label={`${t('About')} ${/\d/.test(versionHook.version) ? `(${versionHook.version})` : ''}`}
            leftSection={<ScalableIcon icon={IconInfoCircle} size={20} />}
            onClick={() => {
              navigate({
                to: '/about',
              })
              if (isSmallScreen) {
                setShowSidebar(false)
              }
            }}
            variant="light"
            p="xs"
          />
        </Stack>
        {!isSmallScreen && (
          <Box
            onMouseDown={handleResizeStart}
            className={clsx(
              `sidebar-resizer absolute top-0 bottom-0 w-1 cursor-col-resize z-[1] bg-chatbox-border-primary opacity-0 hover:opacity-70 transition-opacity duration-200`,
              language === 'ar' ? '-left-1' : '-right-1'
            )}
          />
        )}
      </Stack>
    </SwipeableDrawer>
  )
}
