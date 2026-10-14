import { registerPlugin } from '@capacitor/core'
import { Box, Button, Flex, Image, NavLink, Stack, Text } from '@mantine/core'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import { TestId } from '@shared/automation/testids'
import {
  IconCode,
  IconDownload,
  IconHelpCircle,
  IconInfoCircle,
  IconLayoutSidebarLeftCollapse,
  IconMessageChatbot,
  IconPhotoPlus,
  IconPlus,
  type IconProps,
  IconSearch,
  IconSettings,
} from '@tabler/icons-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useAtomValue } from 'jotai'
import { type ElementType, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import Divider from './components/common/Divider'
import { ICON_SIZE, ICON_STROKE_WIDTH, IconButton, type IconButtonProps } from './components/common/IconButton'
import { ScalableIcon } from './components/common/ScalableIcon'
import ThemeSwitchButton from './components/dev/ThemeSwitchButton'
import { useAppTitleBarHeight } from './components/layout/AppTitleBar'
import { SidebarDesktopDownloadCard, useWebAppDownloadPromptVisible } from './components/layout/DesktopDownloadReminder'
import { SidebarLowQuotaReminder } from './components/layout/LowQuotaReminder'
import { overlayStackAtom } from './components/layout/Overlay'
import { formatShortcut } from './components/Shortcut'
import SessionList from './components/session/SessionList'
import { FORCE_ENABLE_DEV_PAGES } from './dev/devToolsConfig'
import { useIsSmallScreen, useSidebarWidth } from './hooks/useScreenChange'
import useVersion from './hooks/useVersion'
import { navigateToSettings } from './modals/settings-navigation'
import { trackingEvent } from './packages/event'
import { buildChatboxUrl } from './packages/remote'
import platform from './platform'
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
  const hasOverlay = useAtomValue(overlayStackAtom).length > 0
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)

  const sessionListViewportRef = useRef<HTMLDivElement>(null)
  const [isSessionListAtTop, setIsSessionListAtTop] = useState(true)

  const sidebarWidth = useSidebarWidth()

  const isSmallScreen = useIsSmallScreen()
  const showDownloadApp = CHATBOX_BUILD_PLATFORM === 'web'
  const webAppDownloadPromptVisible = useWebAppDownloadPromptVisible()
  const showDesktopDownloadCard = showDownloadApp && !isSmallScreen && webAppDownloadPromptVisible

  const [isResizing, setIsResizing] = useState(false)
  const resizeStartX = useRef<number>(0)
  const resizeStartWidth = useRef<number>(0)

  const titleBarHeight = useAppTitleBarHeight()
  const isSessionRoute = useRouterState({ select: (state) => state.location.pathname.startsWith('/session/') })
  const footerButtonSize = isSmallScreen ? 'lg' : 'md'
  const footerIconSize = isSmallScreen ? ICON_SIZE.touch : ICON_SIZE.nav

  const closeOnSmallScreen = useCallback(() => {
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }, [isSmallScreen, setShowSidebar])

  const handleOpenSearch = useCallback(() => {
    setOpenSearchDialog(true, !isSessionRoute)
    closeOnSmallScreen()
  }, [closeOnSmallScreen, isSessionRoute, setOpenSearchDialog])

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

  const handleDownloadApp = useCallback(() => {
    void platform.openLink(
      buildChatboxUrl(`/redirect_app/homepage/${language}?utm_source=web&utm_content=sidebar_download_app#download`)
    )
    if (isSmallScreen) {
      setShowSidebar(false)
    }
    trackingEvent('download_app', { event_category: 'user' })
  }, [isSmallScreen, language, setShowSidebar])

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
    setIosTextInteractionEnabled(!(isSmallScreen && showSidebar && !hasOverlay))

    return () => {
      setIosTextInteractionEnabled(true)
    }
  }, [isSmallScreen, showSidebar, hasOverlay])

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
          ...(titleBarHeight
            ? {
                top: `calc(var(--mobile-safe-area-inset-top, 0px) + ${titleBarHeight}px)`,
                height: 'auto',
                bottom: 0,
              }
            : {}),
        },
      }}
      SlideProps={language === 'ar' ? { direction: 'left' } : undefined}
      PaperProps={{
        sx: {
          overflowY: 'initial',
          ...(language === 'ar' ? { direction: 'rtl' } : {}),
          // ModalProps.sx replaces the root sx on the temporary drawer, so its width is set on the paper.
          ...(isSmallScreen ? { width: '75vw' } : {}),
        },
      }}
      disableSwipeToOpen={CHATBOX_BUILD_PLATFORM !== 'ios'} // 只在iOS设备上启用SwipeToOpen
    >
      <Stack
        data-testid={TestId.sidebar.root}
        h="100%"
        gap={0}
        pt={titleBarHeight ? 0 : 'var(--mobile-safe-area-inset-top, 0px)'}
        pb="var(--mobile-safe-area-inset-bottom, 0px)"
        className="relative"
      >
        {/* Wide layouts show the app name and the collapse button in the app title bar. */}
        {isSmallScreen && (
          <Flex align="center" justify="space-between" gap="xs" px="md" py="sm" className="border-0">
            <Flex
              align="center"
              gap="xs"
              miw={0}
              flex={1}
              onClick={() => navigate({ to: '/about' })}
              className="cursor-pointer"
            >
              <Image src={icon} w={20} h={20} />
              <Text span c="chatbox-primary" fz={16} lh="24px" fw={600} truncate>
                Chatbox
              </Text>
              {/\d/.test(versionHook.version) && (
                <Text span c="chatbox-tertiary" size="sm">
                  {versionHook.version}
                </Text>
              )}
              {FORCE_ENABLE_DEV_PAGES && <ThemeSwitchButton size="xs" />}
            </Flex>
          </Flex>
        )}
        {!isSmallScreen && <Box h="xs" />}

        <Stack gap={2} px="xs" pb="xs" className="relative shrink-0">
          {!isSmallScreen && <NewChatButton onClick={handleCreateNewSession} />}
          <SidebarNavRow
            testId={TestId.sidebar.search}
            label={t('Search')}
            icon={IconSearch}
            shortcut={isSmallScreen ? undefined : ['mod', 'K']}
            onClick={handleOpenSearch}
          />
          <SidebarNavRow
            testId={TestId.sidebar.newImage}
            label={t('Create Image')}
            icon={IconPhotoPlus}
            onClick={handleCreateNewPictureSession}
          />
          <SidebarNavRow
            label={t('My Copilots')}
            icon={IconMessageChatbot}
            onClick={() => {
              navigate({ to: '/copilots' })
              closeOnSmallScreen()
            }}
          />
          <Box
            data-testid={TestId.sidebar.scrollDivider}
            aria-hidden="true"
            pos="absolute"
            bottom={0}
            left="var(--mantine-spacing-xs)"
            right="var(--mantine-spacing-xs)"
            className="pointer-events-none"
            style={{ opacity: isSessionListAtTop ? 0 : 1 }}
          >
            <Divider />
          </Box>
        </Stack>

        <SessionList sessionListViewportRef={sessionListViewportRef} atTopStateChange={setIsSessionListAtTop} />

        <SidebarUpdateBanner />

        <Box px="xs" pb="xs" className="empty:hidden">
          <SidebarLowQuotaReminder />
        </Box>

        {showDesktopDownloadCard && (
          <Box px="xs" pb="xs">
            <SidebarDesktopDownloadCard />
          </Box>
        )}

        <Stack gap="xs" px="xs" pb="xs">
          <Divider />
          {showDownloadApp && !showDesktopDownloadCard && (
            <SidebarNavRow
              testId={TestId.sidebar.downloadApp}
              label={t('Download app')}
              icon={IconDownload}
              onClick={handleDownloadApp}
            />
          )}
          {isSmallScreen && <NewChatButton onClick={handleCreateNewSession} />}
          <Flex align="center" gap={2}>
            <Box flex={1} miw={0}>
              <SidebarNavRow
                testId={TestId.sidebar.settingsTrigger}
                label={t('Settings')}
                icon={IconSettings}
                onClick={() => {
                  navigateToSettings()
                  closeOnSmallScreen()
                }}
              />
            </Box>
            {!versionHook.isExceeded && (
              <Tooltip label={t('Help')} openDelay={500} withArrow>
                <IconButton
                  icon={IconHelpCircle}
                  size={footerButtonSize}
                  iconSize={footerIconSize}
                  aria-label={t('Help')}
                  color="chatbox-tertiary"
                  onClick={() => {
                    navigate({ to: '/guide' })
                    closeOnSmallScreen()
                  }}
                />
              </Tooltip>
            )}
            {FORCE_ENABLE_DEV_PAGES && CHATBOX_BUILD_PLATFORM !== 'web' && (
              <Tooltip label="Dev Tools" openDelay={500} withArrow>
                <IconButton
                  icon={IconCode}
                  size={footerButtonSize}
                  iconSize={footerIconSize}
                  aria-label="Dev Tools"
                  color="chatbox-tertiary"
                  onClick={() => navigate({ to: '/dev' })}
                />
              </Tooltip>
            )}
            <AboutButton
              versionHook={versionHook}
              size={footerButtonSize}
              iconSize={footerIconSize}
              onClick={() => {
                navigate({ to: '/about' })
                closeOnSmallScreen()
              }}
            />
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
        className="rounded-md cursor-pointer bg-chatbox-background-gray-secondary hover:bg-chatbox-background-gray-secondary-hover"
        onClick={installUpdate}
      >
        <ScalableIcon icon={IconDownload} size={ICON_SIZE.inline} className="text-chatbox-brand flex-shrink-0" />
        <Text size="sm" c="chatbox-primary" lineClamp={1} flex={1}>
          {`${t('Update ready to install')}${updateVersion ? ` (v${updateVersion})` : ''}`}
        </Text>
      </Flex>
    </Box>
  )
}

function NewChatButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  return (
    <Button
      variant="light"
      fullWidth
      h={isSmallScreen ? 44 : 36}
      mb={isSmallScreen ? 0 : 4}
      justify="flex-start"
      data-testid={TestId.sidebar.newChat}
      leftSection={<ScalableIcon icon={IconPlus} size={ICON_SIZE.nav} strokeWidth={ICON_STROKE_WIDTH} />}
      rightSection={
        isSmallScreen ? undefined : (
          <span className="text-xs font-normal opacity-70">{formatShortcut(['mod', 'N'])}</span>
        )
      }
      classNames={{ inner: 'w-full', label: 'flex-1' }}
      onClick={onClick}
    >
      {t('New Chat')}
    </Button>
  )
}

function SidebarNavRow(props: {
  label: string
  icon: ElementType<IconProps>
  onClick: () => void
  testId?: string
  shortcut?: string[]
}) {
  const isSmallScreen = useIsSmallScreen()
  return (
    <NavLink
      data-testid={props.testId}
      c="chatbox-secondary"
      className="rounded-md"
      h={isSmallScreen ? 44 : 36}
      px="xs"
      py={0}
      label={props.label}
      leftSection={<ScalableIcon icon={props.icon} size={ICON_SIZE.nav} strokeWidth={ICON_STROKE_WIDTH} />}
      rightSection={
        props.shortcut ? (
          <Text span size="xs" c="chatbox-tertiary">
            {formatShortcut(props.shortcut)}
          </Text>
        ) : undefined
      }
      onClick={props.onClick}
      variant="subtle"
    />
  )
}

/**
 * About button with update dot indicator.
 * Desktop: shows dot when electron-updater detects update (downloaded/available).
 * Mobile: shows dot when remote API says needCheckUpdate.
 */
function useShowUpdateDot(versionHook: ReturnType<typeof useVersion>) {
  const updateStatus = useUpdateStore((s) => s.status)
  const isMobile = CHATBOX_BUILD_TARGET === 'mobile_app'
  return isMobile ? versionHook.needCheckUpdate : updateStatus === 'downloaded'
}

function AboutButton({
  versionHook,
  size,
  iconSize,
  onClick,
}: {
  versionHook: ReturnType<typeof useVersion>
  size: IconButtonProps['size']
  iconSize: number
  onClick: () => void
}) {
  const { t } = useTranslation()
  const showDot = useShowUpdateDot(versionHook)
  const label = `${t('About')}${/\d/.test(versionHook.version) ? ` (${versionHook.version})` : ''}`

  return (
    <Tooltip label={label} openDelay={500} withArrow>
      <Box className="relative">
        <IconButton
          icon={IconInfoCircle}
          size={size}
          iconSize={iconSize}
          aria-label={label}
          data-testid={TestId.sidebar.about}
          color="chatbox-tertiary"
          onClick={onClick}
        />
        {showDot && (
          <Box w={8} h={8} bg="chatbox-brand" className="absolute top-1 right-1 pointer-events-none rounded-full" />
        )}
      </Box>
    </Tooltip>
  )
}
