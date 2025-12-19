import { type RemoteConfig, Theme } from '@/../shared/types'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import ExitFullscreenButton from '@/components/ExitFullscreenButton'
import Toasts from '@/components/Toasts'
import useAppTheme from '@/hooks/useAppTheme'
import { useSystemLanguageWhenInit } from '@/hooks/useDefaultSystemLanguage'
import { useI18nEffect } from '@/hooks/useI18nEffect'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { useSidebarWidth } from '@/hooks/useScreenChange'
import useShortcut from '@/hooks/useShortcut'
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
  Input,
  type MantineColorsTuple,
  MantineProvider,
  Modal,
  NativeSelect,
  Popover,
  rem,
  Select,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
  useMantineColorScheme,
  virtualColor,
} from '@mantine/core'
import { Box, Grid } from '@mui/material'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import { useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef } from 'react'
import SettingsModal, { navigateToSettings } from '@/modals/Settings'
import { getOS } from '@/packages/navigator'
import * as remote from '@/packages/remote'
import PictureDialog from '@/pages/PictureDialog'
import RemoteDialogWindow from '@/pages/RemoteDialogWindow'
import SearchDialog from '@/pages/SearchDialog'
import platform from '@/platform'
import { router } from '@/router'
import Sidebar from '@/Sidebar'
import * as atoms from '@/stores/atoms'
import * as premiumActions from '@/stores/premiumActions'
import * as settingActions from '@/stores/settingActions'
import { settingsStore, useLanguage, useSettingsStore, useTheme } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'

function Root() {
  const location = useLocation()
  const spellCheck = useSettingsStore((state) => state.spellCheck)
  const language = useLanguage()
  const initialized = useRef(false)

  const setOpenAboutDialog = useUIStore((s) => s.setOpenAboutDialog)

  const setRemoteConfig = useSetAtom(atoms.remoteConfigAtom)

  useEffect(() => {
    if (initialized.current) {
      return
    }
    // 通过定时器延迟启动，防止处理状态底层存储的异步加载前错误的初始数据
    const tid = setTimeout(() => {
      // biome-ignore lint/nursery/noFloatingPromises: inline call
      ;(async () => {
        const remoteConfig = await remote
          .getRemoteConfig('setting_chatboxai_first')
          .catch(() => ({ setting_chatboxai_first: false }) as RemoteConfig)
        setRemoteConfig((conf) => ({ ...conf, ...remoteConfig }))
        // 是否需要弹出设置窗口
        initialized.current = true
        if (settingActions.needEditSetting() && location.pathname !== '/settings/mcp') {
          await NiceModal.show('welcome')
          return
        }
        // 是否需要弹出关于窗口（更新后首次启动）
        // 目前仅在桌面版本更新后首次启动、且网络环境为"外网"的情况下才自动弹窗
        const shouldShowAboutDialogWhenStartUp = await platform.shouldShowAboutDialogWhenStartUp()
        if (shouldShowAboutDialogWhenStartUp && remoteConfig.setting_chatboxai_first) {
          setOpenAboutDialog(true)
          return
        }
      })()
    }, 2000)

    return () => clearTimeout(tid)
  }, [setOpenAboutDialog, setRemoteConfig, location.pathname])

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
    ;(() => {
      const { startupPage } = settingsStore.getState()
      const sid = JSON.parse(localStorage.getItem('_currentSessionIdCachedAtom') || '""') as string
      if (sid && startupPage === 'session') {
        router.navigate({
          to: `/session/${sid}`,
          replace: true,
        })
      }
    })()
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
          router.navigate({ to: path })
        }
      })
    }
  }, [])

  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()
  useEffect(() => {
    if (needRoomForMacWindowControls) {
      document.documentElement.setAttribute('data-need-room-for-mac-controls', 'true')
    } else {
      document.documentElement.removeAttribute('data-need-room-for-mac-controls')
    }
  }, [needRoomForMacWindowControls])

  return (
    <Box className="box-border App" spellCheck={spellCheck} dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {platform.type === 'desktop' && (getOS() === 'Windows' || getOS() === 'Linux') && <ExitFullscreenButton />}
      <Grid container className="h-full">
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
      {/* <AppStoreRatingDialog /> */}
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
      {/* 似乎是从后端拉一个弹窗的配置 */}
      <RemoteDialogWindow />
      {/* 手机端举报内容 */}
      {/* <ReportContentDialog /> */}
      {/* 搜索 */}
      <SearchDialog />
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
    primaryColor: 'chatbox-brand',
    colors: {
      'chatbox-brand': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-brand)')),
      'chatbox-gray': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-gray)')),
      'chatbox-success': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-success)')),
      'chatbox-error': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-error)')),
      'chatbox-warning': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-warning)')),

      'chatbox-primary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-primary)')),
      'chatbox-secondary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-secondary)')),
      'chatbox-tertiary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-tertiary)')),
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
          c: 'chatbox-primary',
        },
      }),
      Title: Title.extend({
        defaultProps: {
          c: 'chatbox-primary',
        },
      }),
      Button: Button.extend({
        defaultProps: {
          color: 'chatbox-brand',
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
                  '--input-color': 'var(--chatbox-tint-error)',
                  '--input-bd': 'var(--chatbox-tint-error)',
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
            marginBottom: 'var(--chatbox-spacing-xxs)',
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
            marginBottom: 'var(--chatbox-spacing-xxs)',
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
            marginBottom: 'var(--chatbox-spacing-xxs)',
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
            marginBottom: 'var(--chatbox-spacing-xxs)',
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
              color: props.checked ? 'var(--chatbox-tint-primary)' : 'var(--chatbox-tint-tertiary)',
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
            color: props.checked ? 'var(--chatbox-tint-primary)' : 'var(--chatbox-tint-tertiary)',
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
            color: 'var(--chatbox-tint-primary)',
            fontSize: 'var(--mantine-font-size-sm)',
          },
          close: {
            width: rem('24px'),
            height: rem('24px'),
            color: 'var(--chatbox-tint-secondary)',
          },
          content: {
            backgroundColor: 'var(--chatbox-background-primary)',
          },
          overlay: {
            '--overlay-bg': 'var(--chatbox-background-mask-overlay)',
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
            color: 'var(--chatbox-tint-primary)',
            fontSize: 'var(--mantine-font-size-sm)',
          },
          close: {
            width: rem('24px'),
            height: rem('24px'),
            color: 'var(--chatbox-tint-secondary)',
          },
          content: {
            backgroundColor: 'var(--chatbox-background-primary)',
          },
          overlay: {
            '--overlay-bg': 'var(--chatbox-background-mask-overlay)',
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
    },
  })

export const Route = createRootRoute({
  component: () => {
    useI18nEffect()
    premiumActions.useAutoValidate() // 每次启动都执行 license 检查，防止用户在lemonsqueezy管理页面中取消了当前设备的激活
    useSystemLanguageWhenInit()
    useShortcut()
    const theme = useAppTheme()
    const _theme = useTheme()
    const fontSize = useSettingsStore((state) => state.fontSize)
    const scale = fontSize / 14
    const mantineTheme = useMemo(() => creteMantineTheme(scale), [scale])

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
  | 'chatbox-brand'
  | 'chatbox-gray'
  | 'chatbox-success'
  | 'chatbox-error'
  | 'chatbox-warning'
  | 'chatbox-primary'
  | 'chatbox-secondary'
  | 'chatbox-tertiary'
  | DefaultMantineColor

declare module '@mantine/core' {
  export interface MantineThemeColorsOverride {
    colors: Record<ExtendedCustomColors, MantineColorsTuple>
  }
}
