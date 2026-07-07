import { Theme } from '@shared/types'
import { z } from 'zod'
import CommandPalette from '@/components/CommandPalette'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import Toasts from '@/components/common/Toasts'
import ExitFullscreenButton from '@/components/layout/ExitFullscreenButton'
import useAppTheme from '@/hooks/useAppTheme'
import { useSystemLanguageWhenInit } from '@/hooks/useDefaultSystemLanguage'
import { useI18nEffect } from '@/hooks/useI18nEffect'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { useSidebarWidth } from '@/hooks/useScreenChange'
import useShortcut from '@/hooks/useShortcut'
import useVersion from '@/hooks/useVersion'
import '@/modals'
import NiceModal from '@ebay/nice-modal-react'
import {
  Avatar,
  Button,
  Checkbox,
  Combobox,
  colorsTuple,
  createTheme,
  type DefaultMantineColor,
  Drawer,
  Flex,
  Input,
  type MantineColorsTuple,
  MantineProvider,
  Modal,
  NativeSelect,
  Popover,
  rem,
  Select,
  Slider,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core'
import { Box, Grid } from '@mui/material'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { useQuery } from '@tanstack/react-query'
import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef } from 'react'
import SettingsModal, { navigateToSettings } from '@/modals/Settings'
import { prefetchModelRegistry } from '@/packages/model-registry'
import { getOS } from '@/packages/navigator'
import PictureDialog from '@/pages/PictureDialog'
import SearchDialog from '@/pages/SearchDialog'
import platform from '@/platform'
import { router } from '@/router'
import Sidebar from '@/Sidebar'
import storage from '@/storage'
import { useSession } from '@/stores/chatStore'
import {
  hasConfiguredProvider,
  initSettingsStore,
  settingsStore,
  useLanguage,
  useSettingsStore,
  useTheme,
} from '@/stores/settingsStore'
import { uiStore, useUIStore } from '@/stores/uiStore'
import { blobToDataUrl } from './image-creator/-components/constants'

function BackgroundImageOverlay() {
  const location = useLocation()
  const globalBackgroundImageKey = useSettingsStore((s) => s.backgroundImageKey)
  const showSidebar = useUIStore((s) => s.showSidebar)
  const sidebarWidth = useSidebarWidth()
  const isRootPage = location.pathname === '/'
  const isSessionPage = location.pathname.startsWith('/session/') && location.pathname.length > '/session/'.length
  const sessionId =
    isSessionPage && location.pathname !== '/session/new' ? location.pathname.slice('/session/'.length) : null
  const { session } = useSession(sessionId)
  const effectiveKey =
    session?.backgroundImage?.type === 'storage-key'
      ? session?.backgroundImage?.storageKey
      : session?.backgroundImage?.type === 'url'
        ? undefined
        : globalBackgroundImageKey
  const { data: blob } = useQuery({
    queryKey: ['image-in-storage', effectiveKey],
    queryFn: async () => {
      if (!effectiveKey) return null
      const b = await storage.getBlob(effectiveKey).catch(() => null)
      return b ?? null
    },
    enabled: !!effectiveKey,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const imageUrl =
    session?.backgroundImage?.type === 'url'
      ? session.backgroundImage.url
      : effectiveKey && blob
        ? blobToDataUrl(blob)
        : undefined

  if (!isRootPage && !isSessionPage) return null
  if (!imageUrl) return null
  return (
    <div className="absolute z-0 top-0 left-0 w-full h-full">
      <div
        className="absolute top-0 left-0 w-full h-full bg-cover bg-center bg-no-repeat opacity-[0.16]"
        style={{
          backgroundImage: `
          url("${imageUrl.replace(/"/g, '%22')}")
        `,
        }}
      />
      <div className="hidden sm:block absolute top-0 left-0 w-full h-40 bg-gradient-to-b from-workspaice-background-primary from-0 to-transparent to-100%" />
      {showSidebar && (
        <div
          className="hidden sm:block absolute top-0 left-0 h-full bg-gradient-to-r from-workspaice-background-primary from-[25%] to-transparent to-100%"
          style={{
            width: `${sidebarWidth * 2}px`,
          }}
        />
      )}

      <Flex h={48} className="sm:hidden bg-workspaice-background-primary" />

      <Flex className="sm:hidden relative h-36 bg-gradient-to-b from-workspaice-background-primary from-0 to-transparent to-100%" />

      <Flex className="sm:hidden absolute bottom-0 left-0 w-full h-36 bg-gradient-to-t from-workspaice-background-primary from-0 to-transparent to-100%" />
    </div>
  )
}

function Root() {
  useVersion()
  const location = useLocation()
  const spellCheck = useSettingsStore((state) => state.spellCheck)
  const language = useLanguage()
  const initialized = useRef(false)

  const setOpenAboutDialog = useUIStore((s) => s.setOpenAboutDialog)

  useEffect(() => {
    if (initialized.current) {
      return
    }
    // biome-ignore lint/nursery/noFloatingPromises: inline call
    ;(async () => {
      // Wait for stores to hydrate from persistent storage
      await initSettingsStore()
      void prefetchModelRegistry()

      if (location.pathname === '/settings/mcp') {
        initialized.current = true
        return
      }

      initialized.current = true

      // 首次启动引导（FABLE F1）：没有配置任何 provider 且未被关闭过时，展示欢迎弹窗。
      if (!uiStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsub = uiStore.persist.onFinishHydration(() => {
            unsub()
            resolve()
          })
        })
      }
      if (!hasConfiguredProvider() && !uiStore.getState().onboardingDismissed) {
        const result = await NiceModal.show('welcome')
        if (result !== 'setup') {
          // “稍后设置”：不再自动弹出；点击“设置 Provider”则留待下次启动继续引导
          uiStore.getState().dismissOnboarding()
        }
        return
      }

      const shouldShowAboutDialogWhenStartUp = await platform.shouldShowAboutDialogWhenStartUp()
      if (shouldShowAboutDialogWhenStartUp) {
        setOpenAboutDialog(true)
        return
      }
    })()
  }, [setOpenAboutDialog, location.pathname])

  const showSidebar = useUIStore((s) => s.showSidebar)
  const sidebarWidth = useSidebarWidth()

  const _theme = useTheme()
  const { setColorScheme } = useMantineColorScheme()
  // biome-ignore lint/correctness/useExhaustiveDependencies: setColorScheme is stable
  useEffect(() => {
    if (_theme === Theme.Dark) {
      setColorScheme('dark')
    } else if (_theme === Theme.Light) {
      setColorScheme('light')
    } else {
      setColorScheme('auto')
    }
  }, [_theme])

  useEffect(() => {
    router.navigate({ to: '/', replace: true })
  }, [])

  useEffect(() => {
    if (platform.onNavigate) {
      // 移动端和其他平台的导航监听器
      return platform.onNavigate((path) => {
        // 如果是 settings 路径，使用 navigateToSettings 以保持与主页面设置按钮一致的行为
        // 在桌面端会打开 Modal，在移动端会正常导航
        if (path.startsWith('/settings')) {
          // 提取 settings 之后的路径部分（包含查询参数）
          const settingsPath = path.substring('/settings'.length)
          navigateToSettings(settingsPath || '/')
        } else {
          router.navigate({ to: path as '/', search: (prev) => prev })
        }
      })
    }
  }, [])

  // Route → sidebar mode sync
  const setSidebarMode = useUIStore((s) => s.setSidebarMode)
  useEffect(() => {
    const pathname = location.pathname
    if (pathname === '/task' || pathname.startsWith('/task/')) {
      setSidebarMode('task')
    } else if (pathname === '/' || pathname.startsWith('/session/')) {
      setSidebarMode('chat')
    }
    // Other routes (settings, about, etc.) don't change sidebarMode
  }, [location.pathname, setSidebarMode])

  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()
  useEffect(() => {
    if (needRoomForMacWindowControls) {
      document.documentElement.setAttribute('data-need-room-for-mac-controls', 'true')
    } else {
      document.documentElement.removeAttribute('data-need-room-for-mac-controls')
    }
  }, [needRoomForMacWindowControls])

  return (
    <Box className="box-border App relative" spellCheck={spellCheck} dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <BackgroundImageOverlay />
      {platform.type === 'desktop' && (getOS() === 'Windows' || getOS() === 'Linux') && <ExitFullscreenButton />}
      <Grid container className="h-full relative z-[1]">
        <Sidebar />
        <Box
          className="h-full w-full"
          sx={{
            flexGrow: 1,
            ...(showSidebar
              ? language === 'ar'
                ? { paddingRight: { sm: `${sidebarWidth}px` } }
                : { paddingLeft: { sm: `${sidebarWidth}px` } }
              : {}),
          }}
        >
          <ErrorBoundary name="main">
            <Outlet />
          </ErrorBoundary>
        </Box>
      </Grid>
      {/* 对话设置 */}
      {/* 代码预览 */}
      {/* <ArtifactDialog /> */}
      {/* 对话列表清理 */}
      {/* <ChatConfigWindow /> */}
      {/* 似乎未使用 */}
      {/* <CleanWidnow /> */}
      {/* 对话列表清理 */}
      {/* <ClearConversationListWindow /> */}
      {/* 导出聊天记录 */}
      {/* <ExportChatDialog /> */}
      {/* 编辑消息 */}
      {/* <MessageEditDialog /> */}
      {/* 添加链接 */}
      {/* <OpenAttachLinkDialog /> */}
      {/* 图片预览 */}
      <PictureDialog />
      {/* 搜索 */}
      <SearchDialog />
      {/* 全局命令面板 ⌘K */}
      <CommandPalette />
      {/* 没有配置模型时的欢迎弹窗 */}
      {/* <WelcomeDialog /> */}
      <Toasts /> {/* mui */}
      <SettingsModal />
    </Box>
  )
}

const creteMantineTheme = (scale = 1) =>
  createTheme({
    /** Put your mantine theme override here */
    scale,
    primaryColor: 'workspaice-brand',
    colors: {
      'workspaice-brand': colorsTuple(Array.from({ length: 10 }, () => 'var(--workspaice-tint-brand)')),
      'workspaice-accent2': colorsTuple(Array.from({ length: 10 }, () => 'var(--workspaice-tint-accent2)')),
      'workspaice-gray': colorsTuple(Array.from({ length: 10 }, () => 'var(--workspaice-tint-gray)')),
      'workspaice-success': colorsTuple(Array.from({ length: 10 }, () => 'var(--workspaice-tint-success)')),
      'workspaice-error': colorsTuple(Array.from({ length: 10 }, () => 'var(--workspaice-tint-error)')),
      'workspaice-warning': colorsTuple(Array.from({ length: 10 }, () => 'var(--workspaice-tint-warning)')),

      'workspaice-primary': colorsTuple(Array.from({ length: 10 }, () => 'var(--workspaice-tint-primary)')),
      'workspaice-secondary': colorsTuple(Array.from({ length: 10 }, () => 'var(--workspaice-tint-secondary)')),
      'workspaice-tertiary': colorsTuple(Array.from({ length: 10 }, () => 'var(--workspaice-tint-tertiary)')),
    },
    headings: {
      fontWeight: 'Bold',
      sizes: {
        h1: {
          fontSize: 'calc(2.5rem * var(--mantine-scale))', // 40px
          lineHeight: '1.2', // 48px
        },
        h2: {
          fontSize: 'calc(2rem * var(--mantine-scale))', // 32px
          lineHeight: '1.25', //  40px
        },
        h3: {
          fontSize: 'calc(1.5rem * var(--mantine-scale))', // 24px
          lineHeight: '1.3333333333', // 32px
        },
        h4: {
          fontSize: 'calc(1.125rem * var(--mantine-scale))', // 18px
          lineHeight: '1.3333333333', // 24px
        },
        h5: {
          fontSize: 'calc(1rem * var(--mantine-scale))', // 16px
          lineHeight: '1.25', // 20px
        },
        h6: {
          fontSize: 'calc(0.75rem * var(--mantine-scale))', // 12px
          lineHeight: '1.3333333333', // 16px
        },
      },
    },
    fontSizes: {
      xxs: 'calc(0.625rem * var(--mantine-scale))', // 10px
      xs: 'calc(0.75rem * var(--mantine-scale))', // 12px
      sm: 'calc(0.875rem * var(--mantine-scale))', // 14px
      md: 'calc(1rem * var(--mantine-scale))', // 16px
      lg: 'calc(1.125rem * var(--mantine-scale))', // 18px
      xl: 'calc(1.25rem * var(--mantine-scale))', // 20px
    },
    lineHeights: {
      xxs: '1.3', // 13px
      xs: '1.3333333333', // 16px
      sm: '1.4285714286', // 20px
      md: '1.5', // 24px
      lg: '1.5555555556', // 28px
      xl: '1.6', // 32px
    },
    radius: {
      xs: 'calc(0.125rem * var(--mantine-scale))',
      sm: 'calc(0.25rem * var(--mantine-scale))',
      md: 'calc(0.5rem * var(--mantine-scale))',
      lg: 'calc(1rem * var(--mantine-scale))',
      xl: 'calc(1.5rem * var(--mantine-scale))',
      xxl: 'calc(2rem * var(--mantine-scale))',
    },
    spacing: {
      '3xs': 'calc(0.125rem * var(--mantine-scale))',
      xxs: 'calc(0.25rem * var(--mantine-scale))',
      xs: 'calc(0.5rem * var(--mantine-scale))',
      sm: 'calc(0.75rem * var(--mantine-scale))',
      md: 'calc(1rem * var(--mantine-scale))',
      lg: 'calc(1.25rem * var(--mantine-scale))',
      xl: 'calc(1.5rem * var(--mantine-scale))',
      xxl: 'calc(2rem * var(--mantine-scale))',
    },
    components: {
      Text: Text.extend({
        defaultProps: {
          size: 'sm',
          c: 'workspaice-primary',
        },
      }),
      Title: Title.extend({
        defaultProps: {
          c: 'workspaice-primary',
        },
      }),
      Button: Button.extend({
        defaultProps: {
          color: 'workspaice-brand',
        },
        styles: () => ({
          root: {
            '--button-height-sm': rem('32px'),
            '--button-height-compact-xs': rem('24px'),
            fontWeight: '400',
          },
        }),
      }),
      Input: Input.extend({
        styles: (_theme, props) => ({
          wrapper: {
            '--input-height-sm': rem('32px'),
            ...(props.error
              ? {
                  '--input-color': 'var(--workspaice-tint-error)',
                  '--input-bd': 'var(--workspaice-tint-error)',
                }
              : {}),
          },
        }),
      }),
      TextInput: TextInput.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--workspaice-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
          },
        }),
      }),
      Textarea: TextInput.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--workspaice-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
          },
        }),
      }),
      Select: Select.extend({
        defaultProps: {
          size: 'sm',
          allowDeselect: false,
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--workspaice-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
          },
        }),
      }),
      NativeSelect: NativeSelect.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--workspaice-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
          },
        }),
      }),
      Switch: Switch.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: (_theme, props) => {
          return {
            label: {
              color: props.checked ? 'var(--workspaice-tint-primary)' : 'var(--workspaice-tint-tertiary)',
            },
          }
        },
      }),
      Checkbox: Checkbox.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: (_theme, props) => ({
          label: {
            color: props.checked ? 'var(--workspaice-tint-primary)' : 'var(--workspaice-tint-tertiary)',
          },
        }),
      }),
      Modal: Modal.extend({
        defaultProps: {
          zIndex: 2000,
        },
        styles: () => ({
          title: {
            fontWeight: '600',
            color: 'var(--workspaice-tint-primary)',
            fontSize: 'var(--mantine-font-size-sm)',
          },
          close: {
            width: rem('24px'),
            height: rem('24px'),
            color: 'var(--workspaice-tint-secondary)',
          },
          content: {
            backgroundColor: 'var(--workspaice-background-primary)',
          },
          overlay: {
            '--overlay-bg': 'var(--workspaice-background-mask-overlay)',
          },
        }),
      }),
      Drawer: Drawer.extend({
        defaultProps: {
          zIndex: 2000,
        },
        styles: () => ({
          title: {
            fontWeight: '600',
            color: 'var(--workspaice-tint-primary)',
            fontSize: 'var(--mantine-font-size-sm)',
          },
          close: {
            width: rem('24px'),
            height: rem('24px'),
            color: 'var(--workspaice-tint-secondary)',
          },
          content: {
            backgroundColor: 'var(--workspaice-background-primary)',
          },
          overlay: {
            '--overlay-bg': 'var(--workspaice-background-mask-overlay)',
          },
        }),
      }),
      Combobox: Combobox.extend({
        defaultProps: {
          shadow: 'md',
          zIndex: 2100,
        },
      }),
      Avatar: Avatar.extend({
        styles: () => ({
          image: {
            objectFit: 'contain',
          },
        }),
      }),
      Tooltip: Tooltip.extend({
        defaultProps: {
          zIndex: 3000,
        },
      }),
      Popover: Popover.extend({
        defaultProps: {
          zIndex: 3000,
        },
      }),
      Slider: Slider.extend({
        classNames: {
          trackContainer: 'max-sm:pointer-events-none',
          thumb: 'max-sm:pointer-events-auto',
        },
      }),
    },
  })

export const Route = createRootRoute({
  validateSearch: z.object({
    settings: z.string().optional(),
  }),
  component: () => {
    useI18nEffect()
    useSystemLanguageWhenInit()
    useShortcut()
    const theme = useAppTheme()
    const _theme = useTheme()
    const fontSize = useSettingsStore((state) => state.fontSize)
    useEffect(() => {
      document.documentElement.style.setProperty('--workspaice-msg-font-size', `${fontSize}px`)
    }, [fontSize])
    const mantineTheme = useMemo(() => creteMantineTheme(), [])

    return (
      <MantineProvider
        theme={mantineTheme}
        defaultColorScheme={_theme === Theme.Dark ? 'dark' : _theme === Theme.Light ? 'light' : 'auto'}
      >
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <NiceModal.Provider>
            <ErrorBoundary>
              <Root />
            </ErrorBoundary>
          </NiceModal.Provider>
        </ThemeProvider>
      </MantineProvider>
    )
  },
})

type ExtendedCustomColors =
  | 'workspaice-brand'
  | 'workspaice-accent2'
  | 'workspaice-gray'
  | 'workspaice-success'
  | 'workspaice-error'
  | 'workspaice-warning'
  | 'workspaice-primary'
  | 'workspaice-secondary'
  | 'workspaice-tertiary'
  | DefaultMantineColor

declare module '@mantine/core' {
  export interface MantineThemeColorsOverride {
    colors: Record<ExtendedCustomColors, MantineColorsTuple>
  }
}
