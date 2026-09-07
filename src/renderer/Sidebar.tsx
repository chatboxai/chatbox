import { registerPlugin } from '@capacitor/core'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Box, Button, Flex, Image, NavLink, Stack, Text } from '@mantine/core'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import { TestId } from '@shared/automation/testids'
import {
  IconArchive,
  IconCirclePlus,
  IconCode,
  IconDownload,
  IconHelpCircle,
  IconInfoCircle,
  IconLayoutSidebarLeftCollapse,
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
import ThemeSwitchButton from './components/dev/ThemeSwitchButton'
import SessionList from './components/session/SessionList'
import { FORCE_ENABLE_DEV_PAGES } from './dev/devToolsConfig'
import useNeedRoomForMacWinControls from './hooks/useNeedRoomForWinControls'
import { useIsSmallScreen, useSidebarWidth } from './hooks/useScreenChange'
import useVersion from './hooks/useVersion'
import { navigateToSettings } from './modals/settings-navigation'
import { trackingEvent } from './packages/event'
import { getSidebarModalSx } from './sidebar-drawer'
import icon from './static/icon.png'
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
        className="relative"
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
              <Image src={icon} w={20} h={20} />
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
            {FORCE_ENABLE_DEV_PAGES && <ThemeSwitchButton size="xs" />}
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
            <Tooltip label={t('Clear Conversation List')} openDelay={1000} withArrow>
              <ActionIcon
                variant="subtle"
                color="chatbox-tertiary"
                size={26}
                radius="md"
                onClick={() => NiceModal.show('clear-session-list')}
              >
                <IconArchive size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('Collapse')} openDelay={1000} withArrow>
              <ActionIcon
                data-testid={TestId.sidebar.collapse}
                aria-label={t('Collapse') || undefined}
                variant="subtle"
                color="chatbox-tertiary"
                size={26}
                radius="md"
                onClick={() => setShowSidebar(false)}
              >
                <IconLayoutSidebarLeftCollapse size={18} />
              </ActionIcon>
            </Tooltip>
          </Flex>
        </Flex>

        <SessionList sessionListViewportRef={sessionListViewportRef} />

        <SidebarUpdateBanner />

        <Stack gap={0} px="xs" pb="xs">
          <Divider />
          <Stack gap="xs" pt="xs" mb="xs">
            <Button
              variant="light"
              fullWidth
              radius="lg"
              data-testid={TestId.sidebar.newChat}
              onClick={handleCreateNewSession}
            >
              <ScalableIcon icon={IconCirclePlus} className="mr-2" />
              {t('New Chat')}
            </Button>
            <Button
              variant="light"
              fullWidth
              radius="lg"
              data-testid={TestId.sidebar.newImage}
              onClick={handleCreateNewPictureSession}
            >
              <ScalableIcon icon={IconPhotoPlus} className="mr-2" />
              {t('Create Image')}
            </Button>
          </Stack>

          {isSmallScreen ? (
            <Flex gap="md" align="center">
              <NavLink
                c="chatbox-secondary"
                className="rounded-lg"
                label={t('My Copilots')}
                leftSection={<ScalableIcon icon={IconMessageChatbot} size={20} />}
                onClick={() => {
                  navigate({
                    to: '/copilots',
                  })
                  setShowSidebar(false)
                }}
                variant="light"
                p="xs"
              />

              {!versionHook.isExceeded && (
                <ActionIcon
                  variant="transparent"
                  color="chatbox-secondary"
                  size={24}
                  onClick={() => {
                    navigate({ to: '/guide' })
                    setShowSidebar(false)
                  }}
                >
                  <ScalableIcon icon={IconHelpCircle} size={20} />
                </ActionIcon>
              )}
              <ActionIcon
                data-testid={TestId.sidebar.settingsTrigger}
                variant="transparent"
                color="chatbox-secondary"
                size={24}
                onClick={() => {
                  navigateToSettings()
                  setShowSidebar(false)
                }}
              >
                <ScalableIcon icon={IconSettingsFilled} size={20} />
              </ActionIcon>

              <SmallScreenAboutIcon versionHook={versionHook} navigate={navigate} setShowSidebar={setShowSidebar} />
            </Flex>
          ) : (
            <>
              <NavLink
                c="chatbox-secondary"
                className="rounded-lg"
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
                data-testid={TestId.sidebar.settingsTrigger}
                c="chatbox-secondary"
                className="rounded-lg"
                label={t('Settings')}
                leftSection={<ScalableIcon icon={IconSettingsFilled} size={20} />}
                onClick={() => navigateToSettings()}
                variant="light"
                p="xs"
              />
              {!versionHook.isExceeded && (
                <NavLink
                  c="chatbox-secondary"
                  className="rounded-lg"
                  label={t('Help')}
                  leftSection={<ScalableIcon icon={IconHelpCircle} size={20} />}
                  onClick={() => navigate({ to: '/guide' })}
                  variant="light"
                  p="xs"
                />
              )}
              {FORCE_ENABLE_DEV_PAGES && (
                <NavLink
                  c="chatbox-secondary"
                  className="rounded-lg"
                  label="Dev Tools"
                  leftSection={<ScalableIcon icon={IconCode} size={20} />}
                  onClick={() => navigate({ to: '/dev' })}
                  variant="light"
                  p="xs"
                />
              )}
              <AboutNavLink versionHook={versionHook} navigate={navigate} />
            </>
          )}
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

function AboutNavLink({
  versionHook,
  navigate,
}: {
  versionHook: ReturnType<typeof useVersion>
  navigate: ReturnType<typeof useNavigate>
}) {
  const { t } = useTranslation()
  const showDot = useShowUpdateDot(versionHook)

  return (
    <NavLink
      c="chatbox-tertiary"
      className="rounded-lg"
      label={
        <Flex align="center" gap={6}>
          <span>{`${t('About')} ${/\d/.test(versionHook.version) ? `(${versionHook.version})` : ''}`}</span>
          {showDot && <Box w={8} h={8} miw={8} bg="chatbox-brand" style={{ borderRadius: '50%' }} />}
        </Flex>
      }
      leftSection={<ScalableIcon icon={IconInfoCircle} size={20} />}
      onClick={() => navigate({ to: '/about' })}
      variant="light"
      p="xs"
    />
  )
}

/**
 * Small screen About icon with dot indicator for mobile.
 */
function SmallScreenAboutIcon({
  versionHook,
  navigate,
  setShowSidebar,
}: {
  versionHook: ReturnType<typeof useVersion>
  navigate: ReturnType<typeof useNavigate>
  setShowSidebar: (v: boolean) => void
}) {
  const showDot = useShowUpdateDot(versionHook)

  return (
    <Box className="relative">
      <ActionIcon
        variant="transparent"
        color="chatbox-secondary"
        size={24}
        onClick={() => {
          navigate({ to: '/about' })
          setShowSidebar(false)
        }}
      >
        <ScalableIcon icon={IconInfoCircle} size={20} />
      </ActionIcon>
      {showDot && (
        <Box w={8} h={8} bg="chatbox-brand" className="absolute -top-0.5 -right-0.5" style={{ borderRadius: '50%' }} />
      )}
    </Box>
  )
}
