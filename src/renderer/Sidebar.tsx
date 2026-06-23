import { ActionIcon, Box, Button, Flex, Image, NavLink, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import {
  IconCirclePlus,
  IconCode,
  IconDownload,
  IconHelpCircle,
  IconInfoCircle,
  IconLayoutSidebarLeftCollapse,
  IconMessageChatbot,
  IconPhotoPlus,
  IconSettingsFilled,
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from './components/common/Divider'
import { ScalableIcon } from './components/common/ScalableIcon'
import SessionAttachmentRagDevPane from './components/dev/SessionAttachmentRagDevPane'
import ThemeSwitchButton from './components/dev/ThemeSwitchButton'
import GroupedSessionList from './components/session/GroupedSessionList'
import GroupRail from './components/session/GroupRail'
import ManagerSessionPin from './components/session/ManagerSessionPin'
import TaskSessionList from './components/session/TaskSessionList'
import { FORCE_ENABLE_DEV_PAGES } from './dev/devToolsConfig'
import useNeedRoomForMacWinControls from './hooks/useNeedRoomForWinControls'
import { useIsSmallScreen, useSidebarWidth } from './hooks/useScreenChange'
import useVersion from './hooks/useVersion'
import { navigateToSettings } from './modals/Settings'
import { trackingEvent } from './packages/event'
import platform from './platform'
import icon from './static/icon.png'
import { currentSidebarGroupIdAtom } from './stores/atoms/uiAtoms'
import { settingsStore, useLanguage } from './stores/settingsStore'
import { taskSessionStore } from './stores/taskSessionStore'
import { useUIStore } from './stores/uiStore'
import { installUpdate, useUpdateStore } from './stores/updateStore'
import { featureFlags } from './utils/feature-flags'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from './variables'

export default function Sidebar() {
  const { t } = useTranslation()
  const versionHook = useVersion()
  const language = useLanguage()
  const navigate = useNavigate()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const sidebarMode = useUIStore((s) => s.sidebarMode)
  const setSidebarMode = useUIStore((s) => s.setSidebarMode)
  const currentSidebarGroupId = useAtomValue(currentSidebarGroupIdAtom)

  const sessionListViewportRef = useRef<HTMLDivElement>(null)

  const sidebarWidth = useSidebarWidth()

  const isSmallScreen = useIsSmallScreen()

  const [isResizing, setIsResizing] = useState(false)
  const [showDevPane, setShowDevPane] = useState(false)
  const resizeStartX = useRef<number>(0)
  const resizeStartWidth = useRef<number>(0)
  const showDebugDevPane =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'true'

  const { needRoomForMacWindowControls } = useNeedRoomForMacWinControls()

  const handleCreateNewSession = useCallback(() => {
    navigate({ to: '/', search: { groupId: currentSidebarGroupId ?? undefined } })

    if (isSmallScreen) {
      setShowSidebar(false)
    }
    trackingEvent('create_new_conversation', { event_category: 'user' })
  }, [navigate, setShowSidebar, isSmallScreen, currentSidebarGroupId])

  const handleCreateNewPictureSession = useCallback(() => {
    navigate({ to: '/image-creator' })
    if (isSmallScreen) {
      setShowSidebar(false)
    }
    trackingEvent('open_image_creator', { event_category: 'user' })
  }, [isSmallScreen, setShowSidebar, navigate])

  const handleCreateNewTask = useCallback(() => {
    taskSessionStore.getState().setCurrentTaskId(null)
    navigate({ to: '/task' })
    if (isSmallScreen) {
      setShowSidebar(false)
    }
    trackingEvent('create_new_task', { event_category: 'user' })
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
      }}
      sx={{
        '& .MuiDrawer-paper': {
          backgroundColor: isSmallScreen ? undefined : 'transparent',
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
            <Flex align="center" gap="sm" onClick={() => navigate({ to: '/about' })} style={{ cursor: 'pointer' }}>
              <Image src={icon} w={20} h={20} />
              <Text span c="chatbox-secondary" size="xl" lh={1.2} fw="700">
                Chatbox
              </Text>
              {/\d/.test(versionHook.version) && (
                <Text span c="chatbox-tertiary" size="sm">
                  {versionHook.version}
                </Text>
              )}
            </Flex>
            {FORCE_ENABLE_DEV_PAGES && <ThemeSwitchButton size="xs" />}
          </Flex>

          <Tooltip label={t('Collapse')} openDelay={1000} withArrow>
            <ActionIcon variant="subtle" color="chatbox-tertiary" size={20} onClick={() => setShowSidebar(false)}>
              <IconLayoutSidebarLeftCollapse />
            </ActionIcon>
          </Tooltip>
        </Flex>

        {featureFlags.taskMode && (
          <SegmentedControl
            value={sidebarMode}
            onChange={(val) => {
              setSidebarMode(val as 'chat' | 'task')
              const { startupPage } = settingsStore.getState()
              if (val === 'chat') {
                const sid = JSON.parse(localStorage.getItem('_currentSessionIdCachedAtom') || '""') as string
                if (sid && startupPage === 'session') {
                  navigate({ to: '/session/$sessionId', params: { sessionId: sid } })
                } else {
                  navigate({ to: '/' })
                }
              } else if (val === 'task') {
                const taskId = taskSessionStore.getState().currentTaskId
                if (taskId && startupPage === 'session') {
                  navigate({ to: '/task/$taskId', params: { taskId } })
                } else {
                  navigate({ to: '/task' })
                }
              }
            }}
            data={[
              { label: t('Chat'), value: 'chat' },
              { label: t('Task'), value: 'task' },
            ]}
            size="xs"
            fullWidth
            mx="xs"
            mb="xs"
          />
        )}

        {sidebarMode === 'task' && featureFlags.taskMode ? (
          <TaskSessionList />
        ) : (
          <>
            <Flex flex={1} style={{ minHeight: 0 }}>
              <GroupRail />
              <GroupedSessionList sessionListViewportRef={sessionListViewportRef} />
            </Flex>
            <Box px="xs" pb={4}>
              <ManagerSessionPin />
            </Box>
          </>
        )}

        <SidebarUpdateBanner />

        <Stack gap={0} px="xs" pb="xs">
          <Divider />
          <Stack gap="xs" pt="xs" mb="xs">
            {sidebarMode === 'task' && featureFlags.taskMode ? (
              <Button variant="light" fullWidth onClick={handleCreateNewTask}>
                <ScalableIcon icon={IconCirclePlus} className="mr-2" />
                {t('New Task')}
              </Button>
            ) : (
              <>
                <Button variant="light" fullWidth data-testid="new-chat-button" onClick={handleCreateNewSession}>
                  <ScalableIcon icon={IconCirclePlus} className="mr-2" />
                  {t('New Chat')}
                </Button>
                <Button
                  variant="light"
                  fullWidth
                  data-testid="new-image-button"
                  onClick={handleCreateNewPictureSession}
                >
                  <ScalableIcon icon={IconPhotoPlus} className="mr-2" />
                  {t('Create Image')}
                </Button>
              </>
            )}
          </Stack>

          {isSmallScreen ? (
            <Flex gap="md" align="center">
              <NavLink
                c="chatbox-secondary"
                className="rounded"
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
                onClick={() => navigateToSettings()}
                variant="light"
                p="xs"
              />
              {!versionHook.isExceeded && (
                <NavLink
                  c="chatbox-secondary"
                  className="rounded"
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
                  className="rounded"
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
        {showDebugDevPane && (
          <>
            <Button
              size="xs"
              variant="filled"
              color="dark"
              leftSection={<ScalableIcon icon={IconCode} size={14} />}
              className={clsx('absolute z-[2] shadow-md', isSmallScreen ? 'bottom-20 right-3' : 'bottom-3 right-3')}
              onClick={() => setShowDevPane(true)}
            >
              Dev
            </Button>
            <SessionAttachmentRagDevPane opened={showDevPane} onClose={() => setShowDevPane(false)} />
          </>
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
        className="rounded-md cursor-pointer bg-chatbox-background-brand-secondary"
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
      className="rounded"
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
