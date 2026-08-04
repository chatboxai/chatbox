import { registerPlugin } from '@capacitor/core'
import NiceModal from '@ebay/nice-modal-react'
import { Box, Flex, Stack } from '@mantine/core'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import type { Folder } from '@shared/types/folder'
import { IconDownload } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SidebarFooter from '@/components/sidebar/SidebarFooter'
import SidebarHeader from '@/components/sidebar/SidebarHeader'
import SidebarTree from '@/components/sidebar/SidebarTree'
import useNeedRoomForMacWinControls from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen, useSidebarWidth } from '@/hooks/useScreenChange'
import useVersion from '@/hooks/useVersion'
import { navigateToSettings } from '@/modals/Settings'
import { trackingEvent } from '@/packages/event'
import { getSidebarModalSx } from '@/sidebar-drawer'
import { createEmpty } from '@/stores/session/crud'
import { useLanguage } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { installUpdate, useUpdateStore } from '@/stores/updateStore'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from '@/variables'

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

  const handleCreateNewChat = useCallback(() => {
    // TODO(sidebar-phase5): pass parentId = null explicitly once createEmpty supports it.
    void createEmpty('chat')
    trackingEvent('create_new_conversation', { event_category: 'user' })
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }, [isSmallScreen, setShowSidebar])

  const handleCreateNewFolder = useCallback(async () => {
    // Prompt the user for a folder name, then create a top-level folder.
    // Resolves to the created Folder (or undefined when cancelled).
    const folder = await NiceModal.show<Folder | undefined>('create-folder', {})
    if (folder) {
      trackingEvent('create_new_folder', { event_category: 'user' })
    }
  }, [])

  const handleCollapse = useCallback(() => {
    setShowSidebar(false)
  }, [setShowSidebar])

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

  const handleSettingsClick = useCallback(() => {
    navigateToSettings()
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }, [isSmallScreen, setShowSidebar])

  const handleHelpClick = useCallback(() => {
    navigate({ to: '/guide' })
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }, [navigate, isSmallScreen, setShowSidebar])

  const handleAboutClick = useCallback(() => {
    navigate({ to: '/about' })
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }, [navigate, isSmallScreen, setShowSidebar])

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

        <SidebarHeader
          version={versionHook.version}
          isSmallScreen={isSmallScreen}
          onSearchClick={() => setOpenSearchDialog(true, true)}
          onCreateFolderClick={handleCreateNewFolder}
          onCreateChatClick={handleCreateNewChat}
          onCollapseClick={handleCollapse}
        />

        {/* Phase 3: pinned section + hierarchical folder/chat tree (replaces
            the old flat SessionList). Pinned rendering, tree-lines, expand/
            collapse, inline rename and context menus live in SidebarTree. */}
        <SidebarTree sessionListViewportRef={sessionListViewportRef} />

        <SidebarUpdateBanner />

        <SidebarFooter
          buildNumber={versionHook.buildNumber}
          isSmallScreen={isSmallScreen}
          hideHelp={Boolean(versionHook.isExceeded)}
          mobileUpdateAvailable={versionHook.needCheckUpdate}
          onSettingsClick={handleSettingsClick}
          onHelpClick={handleHelpClick}
          onAboutClick={handleAboutClick}
        />

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
 * Not shown on mobile (mobile uses dot indicator on the About icon).
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
        <span className="text-sm text-chatbox-brand line-clamp-1 flex-1">
          {`${t('Update ready to install')}${updateVersion ? ` (v${updateVersion})` : ''}`}
        </span>
      </Flex>
    </Box>
  )
}
