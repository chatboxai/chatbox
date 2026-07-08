import {
  ActionIcon,
  Box,
  Button,
  Drawer,
  Flex,
  Image,
  NavLink,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core'
import {
  IconCirclePlus,
  IconCode,
  IconInfoCircle,
  IconLayoutSidebarLeftCollapse,
  IconPhotoPlus,
  IconSettingsFilled,
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from './components/common/Divider'
import { ScalableIcon } from './components/common/ScalableIcon'
import SessionAttachmentRagDevPane from './components/dev/SessionAttachmentRagDevPane'
import ThemeSwitchButton from './components/dev/ThemeSwitchButton'
import SessionList from './components/session/SessionList'
import TaskSessionList from './components/session/TaskSessionList'
import { FORCE_ENABLE_DEV_PAGES } from './dev/devToolsConfig'
import useNeedRoomForMacWinControls from './hooks/useNeedRoomForWinControls'
import { useIsSmallScreen, useSidebarWidth } from './hooks/useScreenChange'
import useVersion from './hooks/useVersion'
import { navigateToSettings } from './modals/Settings'
import { trackingEvent } from './packages/event'
import icon from './static/icon.png'
import { settingsStore, useLanguage } from './stores/settingsStore'
import { taskSessionStore } from './stores/taskSessionStore'
import { useUIStore } from './stores/uiStore'
import { featureFlags } from './utils/feature-flags'

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

  const sidebarContent = (
    <Stack h="100%" gap={0} className="relative">
      {needRoomForMacWindowControls && <Box className="title-bar flex-[0_0_44px]" />}
      <Flex align="center" justify="space-between" px="md" py="sm">
        <Flex align="center" gap="sm">
          <Flex align="center" gap="sm" onClick={() => navigate({ to: '/about' })} style={{ cursor: 'pointer' }}>
            <Image src={icon} w={20} h={20} />
            <Box>
              <Flex align="center" gap="sm">
                <Text span c="workspaice-secondary" size="xl" lh={1.2} fw="700">
                  WorkspAIce
                </Text>
                {/\d/.test(versionHook.version) && (
                  <Text span c="workspaice-tertiary" size="sm">
                    {versionHook.version}
                  </Text>
                )}
              </Flex>
            </Box>
          </Flex>
          {FORCE_ENABLE_DEV_PAGES && <ThemeSwitchButton size="xs" />}
        </Flex>

        <Tooltip label={t('Collapse')} openDelay={1000} withArrow>
          <ActionIcon
            variant="subtle"
            color="workspaice-tertiary"
            size={20}
            aria-label={t('Collapse')}
            onClick={() => setShowSidebar(false)}
          >
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
        <SessionList sessionListViewportRef={sessionListViewportRef} />
      )}

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
              <Button variant="light" fullWidth data-testid="new-image-button" onClick={handleCreateNewPictureSession}>
                <ScalableIcon icon={IconPhotoPlus} className="mr-2" />
                {t('Create Image')}
              </Button>
            </>
          )}
        </Stack>

        {isSmallScreen ? (
          <Flex gap="md" align="center">
            <ActionIcon
              variant="transparent"
              color="workspaice-secondary"
              size={24}
              aria-label={t('Settings')}
              onClick={() => {
                navigateToSettings()
                setShowSidebar(false)
              }}
            >
              <ScalableIcon icon={IconSettingsFilled} size={20} />
            </ActionIcon>

            <SmallScreenAboutIcon navigate={navigate} setShowSidebar={setShowSidebar} />
          </Flex>
        ) : (
          <>
            <NavLink
              c="workspaice-secondary"
              className="rounded"
              label={t('Settings')}
              data-testid="settings-nav-link"
              leftSection={<ScalableIcon icon={IconSettingsFilled} size={20} />}
              onClick={() => navigateToSettings()}
              variant="light"
              p="xs"
            />
            {FORCE_ENABLE_DEV_PAGES && (
              <NavLink
                c="workspaice-secondary"
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
            `sidebar-resizer absolute top-0 bottom-0 w-1 cursor-col-resize z-[1] bg-workspaice-border-primary opacity-0 hover:opacity-70 transition-opacity duration-200`,
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
  )

  if (isSmallScreen) {
    return (
      <Drawer
        opened={showSidebar}
        onClose={() => setShowSidebar(false)}
        position={language === 'ar' ? 'right' : 'left'}
        size="75vw"
        padding={0}
        withCloseButton={false}
        keepMounted
        // 关闭 focus trap，避免在侧边栏打开时弹出的 modal 中 input 无法点击
        trapFocus={false}
        styles={{
          body: { height: '100%', padding: 0 },
          content: { overflowY: 'initial' },
        }}
      >
        <Box dir={language === 'ar' ? 'rtl' : 'ltr'} h="100%">
          {sidebarContent}
        </Box>
      </Drawer>
    )
  }

  // 桌面端：固定侧栏（原 MUI persistent drawer）；内容区自行按 sidebarWidth 让位（见 routes/__root.tsx）
  return (
    <Box
      component="nav"
      className="fixed top-0 bottom-0 z-[100]"
      style={{
        insetInlineStart: 0,
        width: sidebarWidth,
        display: showSidebar ? undefined : 'none',
      }}
    >
      {sidebarContent}
    </Box>
  )
}

function AboutNavLink({
  versionHook,
  navigate,
}: {
  versionHook: ReturnType<typeof useVersion>
  navigate: ReturnType<typeof useNavigate>
}) {
  const { t } = useTranslation()

  return (
    <NavLink
      c="workspaice-tertiary"
      className="rounded"
      label={
        <Flex align="center" gap={6}>
          <span>{`${t('About')} ${/\d/.test(versionHook.version) ? `(${versionHook.version})` : ''}`}</span>
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
 * Small screen About icon.
 */
function SmallScreenAboutIcon({
  navigate,
  setShowSidebar,
}: {
  navigate: ReturnType<typeof useNavigate>
  setShowSidebar: (v: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Box className="relative">
      <ActionIcon
        variant="transparent"
        color="workspaice-secondary"
        size={24}
        aria-label={t('About')}
        onClick={() => {
          navigate({ to: '/about' })
          setShowSidebar(false)
        }}
      >
        <ScalableIcon icon={IconInfoCircle} size={20} />
      </ActionIcon>
    </Box>
  )
}
