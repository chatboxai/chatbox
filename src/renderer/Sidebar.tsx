import { registerPlugin } from '@capacitor/core'
import { ActionIcon, Box, Button, Flex, Stack, Text } from '@mantine/core'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import { TestId } from '@shared/automation/testids'
import {
  IconCirclePlus,
  IconCode,
  IconDownload,
  IconHelpCircle,
  IconInfoCircle,
  IconMessageChatbot,
  IconPhotoPlus,
  IconSearch,
  IconSettingsFilled,
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import Divider from './components/common/Divider'
import { ScalableIcon } from './components/common/ScalableIcon'
import SessionList from './components/session/SessionList'
import { FORCE_ENABLE_DEV_PAGES } from './dev/devToolsConfig'
import useNeedRoomForWinControls from './hooks/useNeedRoomForWinControls'
import { useIsSmallScreen, useSidebarWidth } from './hooks/useScreenChange'
import useVersion from './hooks/useVersion'
import { navigateToSettings } from './modals/Settings'
import { trackingEvent } from './packages/event'
import { getSidebarModalSx } from './sidebar-drawer'
import { useLanguage } from './stores/settingsStore'
import { useUIStore } from './stores/uiStore'
import { installUpdate, useUpdateStore } from './stores/updateStore'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from './variables'

interface ChatboxWebViewPlugin {
  setTextInteractionEnabled(options: { enabled: boolean }): Promise<void>
}

const ChatboxWebView = registerPlugin<ChatboxWebViewPlugin>('ChatboxWebView')

function setIosTextInteractionEnabled(enabled: boolean) {
  if (CHATBOX_BUILD_TARGET !== 'mobile_app' || CHATBOX_BUILD_PLATFORM !== 'ios') {
    return
  }

  void ChatboxWebView.setTextInteractionEnabled({ enabled }).catch((error: unknown) => {
    console.warn('Failed to update iOS text interaction:', error)
  })
}

export default function Sidebar() {
  const { t } = useTranslation()
  const versionHook = useVersion()
  const language = useLanguage()
  const navigate = useNavigate()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)

  const sessionListViewportRef = useRef<HTMLDivElement>(null)

  const sidebarWidth = useSidebarWidth()

  const isSmallScreen = useIsSmallScreen()
  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()

  const [isResizing, setIsResizing] = useState(false)
  const resizeStartX = useRef<number>(0)
  const resizeStartWidth = useRef<number>(0)

  const handleCreateNewSession = useCallback(() => {
    navigate({ to: `/` })

    if (isSmallScreen) {
      setShowSidebar(false)
    }
    trackingEvent('create_new_conversation', { event_category: 'user' })
  }, [navigate, setShowSidebar, isSmallScreen])

  const handleCreateNewPictureSession = useCallback(() => {
    navigate({ to: '/image-creator' })
    if (isSmallScreen) {
      setShowSidebar(false)
    }
    trackingEvent('open_image_creator', { event_category: 'user' })
  }, [isSmallScreen, setShowSidebar, navigate])

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

  useEffect(() => {
    setIosTextInteractionEnabled(!(isSmallScreen && showSidebar))

    return () => {
      setIosTextInteractionEnabled(true)
    }
  }, [isSmallScreen, showSidebar])

  return (
    <SwipeableDrawer
      anchor={language === 'ar' ? 'right' : 'left'}
      variant={isSmallScreen ? 'temporary' : 'persistent'}
      open={showSidebar}
      onClose={() => setShowSidebar(false)}
      onOpen={() => setShowSidebar(true)}
      ModalProps={{
        keepMounted: true, // Better open performance on mobile.
        disableEnforceFocus: true, // 关闭 focus trap，避免在侧边栏打开时弹出的 modal 中 input 无法点击
        sx: getSidebarModalSx(showSidebar),
      }}
      sx={{
        '& .MuiDrawer-paper': {
          backgroundColor: 'transparent',
          backgroundImage: 'none',
          border: 0,
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
    >
      <Stack
        data-testid={TestId.sidebar.root}
        h="100%"
        gap={0}
        pt="var(--mobile-safe-area-inset-top, 0px)"
        pb="var(--mobile-safe-area-inset-bottom, 0px)"
        className="relative chatbox-sidebar"
      >
        {needRoomForMacWindowControls && <Box className="title-bar flex-[0_0_44px]" />}
        <Flex align="center" justify="space-between" gap="xs" px="md" py="sm" className="border-0">
          <Flex align="center" gap="sm" style={{ minWidth: 0, flex: 1 }}>
            <Flex
              align="center"
              gap="sm"
              onClick={() => navigate({ to: '/about' })}
              style={{ cursor: 'pointer', minWidth: 0 }}
            >
              <Text span c="chatbox-secondary" size="xl" lh={1.2} fw="700" truncate>
                Chatbox
              </Text>
              {/* Desktop shows the version in the bottom About link, so only surface it here on mobile */}
              {isSmallScreen && /\d/.test(versionHook.version) && (
                <Text span c="chatbox-tertiary" size="sm">
                  {versionHook.version}
                </Text>
              )}
            </Flex>
          </Flex>

          <Flex align="center" gap={2} style={{ flexShrink: 0 }}>
            <Tooltip label={t('Search')} openDelay={1000} withArrow>
              <ActionIcon
                variant="subtle"
                color="chatbox-tertiary"
                size={26}
                radius="md"
                onClick={() => setOpenSearchDialog(true, true)}
              >
                <IconSearch size={18} />
              </ActionIcon>
            </Tooltip>
          </Flex>
        </Flex>

        <Stack gap={6} px="sm" pb="sm" className="chatbox-sidebar-primary-actions">
          <Button
            variant="subtle"
            fullWidth
            radius="md"
            justify="flex-start"
            className="chatbox-sidebar-primary-action"
            data-testid={TestId.sidebar.newChat}
            onClick={handleCreateNewSession}
          >
            <ScalableIcon icon={IconCirclePlus} className="mr-2" />
            {t('New Chat')}
          </Button>
          <Button
            variant="subtle"
            fullWidth
            radius="md"
            justify="flex-start"
            className="chatbox-sidebar-primary-action"
            data-testid={TestId.sidebar.newImage}
            onClick={handleCreateNewPictureSession}
          >
            <ScalableIcon icon={IconPhotoPlus} className="mr-2" />
            {t('Create Image')}
          </Button>
        </Stack>

        <SessionList sessionListViewportRef={sessionListViewportRef} />

        <SidebarUpdateBanner />

        <Stack gap={0} px="sm" pb="sm" className="chatbox-sidebar-footer">
          <Divider />
          <Flex gap={4} pt="xs" align="center" justify="space-between" className="chatbox-sidebar-icon-nav">
            <SidebarIconButton
              label={t('My Copilots')}
              icon={IconMessageChatbot}
              onClick={() => {
                navigate({ to: '/copilots' })
                if (isSmallScreen) setShowSidebar(false)
              }}
            />
            <SidebarIconButton
              label={t('Settings')}
              icon={IconSettingsFilled}
              data-testid={TestId.sidebar.settingsTrigger}
              onClick={() => {
                navigateToSettings()
                if (isSmallScreen) setShowSidebar(false)
              }}
            />
            {!versionHook.isExceeded && (
              <SidebarIconButton
                label={t('Help')}
                icon={IconHelpCircle}
                onClick={() => {
                  navigate({ to: '/guide' })
                  if (isSmallScreen) setShowSidebar(false)
                }}
              />
            )}
            {FORCE_ENABLE_DEV_PAGES && (
              <SidebarIconButton label="Dev Tools" icon={IconCode} onClick={() => navigate({ to: '/dev' })} />
            )}
            <AboutIconButton versionHook={versionHook} navigate={navigate} setShowSidebar={setShowSidebar} />
          </Flex>
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

function SidebarIconButton({
  label,
  icon: Icon,
  onClick,
  ...props
}: {
  label: string
  icon: typeof IconMessageChatbot
  onClick: () => void
  'data-testid'?: string
}) {
  return (
    <Tooltip label={label} openDelay={500} withArrow>
      <ActionIcon
        {...props}
        aria-label={label}
        variant="subtle"
        color="chatbox-secondary"
        size={34}
        radius="md"
        onClick={onClick}
        className="chatbox-sidebar-icon-button"
      >
        <ScalableIcon icon={Icon} size={19} />
      </ActionIcon>
    </Tooltip>
  )
}

/**
 * Desktop: shows update banner when an update is downloaded and ready to install.
 * Not shown on mobile (mobile uses dot indicator on About link).
 */
function SidebarUpdateBanner() {
  const isMobile = CHATBOX_BUILD_TARGET === 'mobile_app'
  if (isMobile) return null
  return <SidebarUpdateBannerInner />
}

function SidebarUpdateBannerInner() {
  const { t } = useTranslation()
  const updateStatus = useUpdateStore((s) => s.status)
  const updateVersion = useUpdateStore((s) => s.version)

  if (updateStatus !== 'downloaded') return null

  return (
    <Box px="xs" pb={4}>
      <Flex
        align="center"
        gap="xs"
        px="sm"
        py={6}
        className="rounded-lg cursor-pointer bg-chatbox-background-brand-secondary"
        onClick={installUpdate}
      >
        <ScalableIcon icon={IconDownload} size={16} className="text-chatbox-brand flex-shrink-0" />
        <Text size="sm" c="chatbox-brand" lineClamp={1} flex={1}>
          {`${t('Update ready to install')}${updateVersion ? ` (v${updateVersion})` : ''}`}
        </Text>
      </Flex>
    </Box>
  )
}

/**
 * About NavLink with update dot indicator.
 * Desktop: shows dot when electron-updater detects update (downloaded/available).
 * Mobile: shows dot when remote API says needCheckUpdate.
 */
function useShowUpdateDot(versionHook: ReturnType<typeof useVersion>) {
  const updateStatus = useUpdateStore((s) => s.status)
  const isMobile = CHATBOX_BUILD_TARGET === 'mobile_app'
  return isMobile ? versionHook.needCheckUpdate : updateStatus === 'downloaded'
}

function AboutIconButton({
  versionHook,
  navigate,
  setShowSidebar,
}: {
  versionHook: ReturnType<typeof useVersion>
  navigate: ReturnType<typeof useNavigate>
  setShowSidebar: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const showDot = useShowUpdateDot(versionHook)

  return (
    <Tooltip
      label={`${t('About')} ${/\d/.test(versionHook.version) ? `(${versionHook.version})` : ''}`}
      openDelay={500}
      withArrow
    >
      <Box className="relative">
        <ActionIcon
          aria-label={t('About')}
          variant="subtle"
          color="chatbox-tertiary"
          size={34}
          radius="md"
          onClick={() => {
            navigate({ to: '/about' })
            if (isSmallScreen) setShowSidebar(false)
          }}
          className="chatbox-sidebar-icon-button"
        >
          <ScalableIcon icon={IconInfoCircle} size={19} />
        </ActionIcon>
        {showDot && <Box w={7} h={7} bg="chatbox-brand" className="absolute right-1 top-1 rounded-full" />}
      </Box>
    </Tooltip>
  )
}
