import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { Box, Grid } from '@mui/material'
import { RemoteConfig, Theme, Settings } from '@/../shared/types'
import CleanWidnow from '@/pages/CleanWindow'
import useAppTheme from '@/hooks/useAppTheme'
import useShortcut from '@/hooks/useShortcut'
import useScreenChange, { useSidebarWidth } from '@/hooks/useScreenChange'
import * as remote from '@/packages/remote'
import { useI18nEffect } from '@/hooks/useI18nEffect'
import Toasts from '@/components/Toasts'
import * as settingActions from '@/stores/settingActions'
import RemoteDialogWindow from '@/pages/RemoteDialogWindow'
import { useSystemLanguageWhenInit } from '@/hooks/useDefaultSystemLanguage'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import * as atoms from '@/stores/atoms'
import SearchDialog from '@/pages/SearchDialog'
import Sidebar from '@/Sidebar'
import PictureDialog from '@/pages/PictureDialog'
import * as premiumActions from '@/stores/premiumActions'
import platform from '@/platform'
import { getOS } from '@/packages/navigator'
import ExitFullscreenButton from '@/components/ExitFullscreenButton'
import NiceModal from '@ebay/nice-modal-react'
import '@/modals'
import {
  Avatar,
  Button,
  Checkbox,
  Combobox,
  createTheme,
  DefaultMantineColor,
  Input,
  MantineColorsTuple,
  MantineProvider,
  Modal,
  NativeSelect,
  rem,
  Select,
  Switch,
  Text,
  TextInput,
  Title,
  useMantineColorScheme,
  virtualColor,
} from '@mantine/core'
import { QueryClientProvider } from '@tanstack/react-query'
import queryClient from '@/stores/queryClient'
import storage, { StorageKey } from '@/storage'

function Root() {
  const navigate = useNavigate()
  const spellCheck = useAtomValue(atoms.spellCheckAtom)
  const language = useAtomValue(atoms.languageAtom)

  const setOpenAboutDialog = useSetAtom(atoms.openAboutDialogAtom)

  const setRemoteConfig = useSetAtom(atoms.remoteConfigAtom)
  useEffect(() => {
    // 通过定时器延迟启动，防止处理状态底层存储的异步加载前错误的初始数据
    const tid = setTimeout(() => {
      ;(async () => {
        const remoteConfig = await remote
          .getRemoteConfig('setting_chatboxai_first')
          .catch(() => ({ setting_chatboxai_first: false } as RemoteConfig))
        setRemoteConfig((conf) => ({ ...conf, ...remoteConfig }))
        // 是否需要弹出设置窗口
        if (settingActions.needEditSetting()) {
          const res = await NiceModal.show('welcome')
          if (res) {
            if (res === 'custom') {
              const provider: string = await NiceModal.show('provider-selector')
              // 用户选择Add Custom Provider的话，暂时无法直接拉起添加自定义供应商的弹窗，先跳去默认的供应商配置页
              if (provider === 'custom') {
                navigate({
                  to: '/settings/provider/chatbox-ai',
                  search: {
                    custom: 'true',
                  },
                })
              } else {
                navigate({
                  to: '/settings/provider/$providerId',
                  params: {
                    providerId: provider,
                  },
                })
              }
            } else {
              navigate({
                to: '/settings/provider/chatbox-ai',
              })
            }
          }

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
  }, [])

  const [showSidebar] = useAtom(atoms.showSidebarAtom)
  const sidebarWidth = useSidebarWidth()

  const _theme = useAtomValue(atoms.themeAtom)
  const { setColorScheme } = useMantineColorScheme()
  useEffect(() => {
    if (_theme === Theme.Dark) {
      setColorScheme('dark')
    } else if (_theme === Theme.Light) {
      setColorScheme('light')
    } else {
      setColorScheme('auto')
    }
  }, [_theme])

  // FIXME: 为了从LocalStroage中初始化这两个atom，否则首次get这两个atom可能得到默认值
  useAtom(atoms.chatSessionSettingsAtom)
  useAtom(atoms.pictureSessionSettingsAtom)

  useEffect(() => {
    ;(async () => {
      const settings = await storage.getItem(StorageKey.Settings, {} as Settings)
      const sid = JSON.parse(localStorage.getItem('_currentSessionIdCachedAtom') || '""') as string
      if (sid && settings?.startupPage === 'session') {
        navigate({
          to: `/session/${sid}`,
          replace: true,
        })
      }
    })()
  }, [])

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
          <Outlet />
        </Box>
      </Grid>
      {/* 对话设置 */}
      {/* <AppStoreRatingDialog /> */}
      {/* 代码预览 */}
      {/* <ArtifactDialog /> */}
      {/* 对话列表清理 */}
      {/* <ChatConfigWindow /> */}
      {/* 似乎未使用 */}
      <CleanWidnow />
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
    </Box>
  )
}

const creteMantineTheme = (scale = 1) =>
  createTheme({
    /** Put your mantine theme override here */
    scale,
    primaryColor: 'chatbox-brand',
    colors: {
      'chatbox-brand': virtualColor({
        name: 'chatbox-brand',
        dark: 'blue',
        light: 'blue',
      }),
      'chatbox-gray': virtualColor({
        name: 'chatbox-gray',
        dark: 'gray',
        light: 'gray',
      }),
      'chatbox-success': virtualColor({
        name: 'chatbox-success',
        dark: 'teal',
        light: 'teal',
      }),
      'chatbox-error': virtualColor({
        name: 'chatbox-error',
        dark: 'red',
        light: 'red',
      }),
      'chatbox-warning': virtualColor({
        name: 'chatbox-warning',
        dark: 'yellow',
        light: 'yellow',
      }),

      'chatbox-primary': [
        'var(--mantine-color-white)',
        'var(--mantine-color-white)',
        'var(--mantine-color-white)',
        'var(--mantine-color-white)',
        'var(--mantine-color-white)',
        'var(--mantine-color-gray-9)',
        'var(--mantine-color-gray-9)',
        'var(--mantine-color-gray-9)',
        'var(--mantine-color-gray-9)',
        'var(--mantine-color-gray-9)',
      ],
      'chatbox-secondary': [
        'var(--mantine-color-gray-4)',
        'var(--mantine-color-gray-4)',
        'var(--mantine-color-gray-4)',
        'var(--mantine-color-gray-4)',
        'var(--mantine-color-gray-4)',
        'var(--mantine-color-gray-7)',
        'var(--mantine-color-gray-7)',
        'var(--mantine-color-gray-7)',
        'var(--mantine-color-gray-7)',
        'var(--mantine-color-gray-7)',
      ],
      'chatbox-tertiary': [
        'var(--mantine-color-dark-2)',
        'var(--mantine-color-dark-2)',
        'var(--mantine-color-dark-2)',
        'var(--mantine-color-dark-2)',
        'var(--mantine-color-dark-2)',
        'var(--mantine-color-gray-6)',
        'var(--mantine-color-gray-6)',
        'var(--mantine-color-gray-6)',
        'var(--mantine-color-gray-6)',
        'var(--mantine-color-gray-6)',
      ],

      'chatbox-border-primary': [
        'var(--mantine-color-gray-7)',
        'var(--mantine-color-gray-7)',
        'var(--mantine-color-gray-7)',
        'var(--mantine-color-gray-7)',
        'var(--mantine-color-gray-7)',
        'var(--mantine-color-gray-3)',
        'var(--mantine-color-gray-3)',
        'var(--mantine-color-gray-3)',
        'var(--mantine-color-gray-3)',
        'var(--mantine-color-gray-3)',
      ],
      'chatbox-border-secondary': [
        'var(--mantine-color-gray-6)',
        'var(--mantine-color-gray-6)',
        'var(--mantine-color-gray-6)',
        'var(--mantine-color-gray-6)',
        'var(--mantine-color-gray-6)',
        'var(--mantine-color-gray-4)',
        'var(--mantine-color-gray-4)',
        'var(--mantine-color-gray-4)',
        'var(--mantine-color-gray-4)',
        'var(--mantine-color-gray-4)',
      ],

      'chatbox-background-primary': [
        'var(--mantine-color-dark-7)',
        'var(--mantine-color-dark-7)',
        'var(--mantine-color-dark-7)',
        'var(--mantine-color-dark-7)',
        'var(--mantine-color-dark-7)',
        'var(--mantine-color-white)',
        'var(--mantine-color-white)',
        'var(--mantine-color-white)',
        'var(--mantine-color-white)',
        'var(--mantine-color-white)',
      ],
      'chatbox-background-secondary': [
        'var(--mantine-color-dark-5)',
        'var(--mantine-color-dark-5)',
        'var(--mantine-color-dark-5)',
        'var(--mantine-color-dark-5)',
        'var(--mantine-color-dark-5)',
        'var(--mantine-color-gray-1)',
        'var(--mantine-color-gray-1)',
        'var(--mantine-color-gray-1)',
        'var(--mantine-color-gray-1)',
        'var(--mantine-color-gray-1)',
      ],
      'chatbox-background-tertiary': [
        'var(--mantine-color-dark-4)',
        'var(--mantine-color-dark-4)',
        'var(--mantine-color-dark-4)',
        'var(--mantine-color-dark-4)',
        'var(--mantine-color-dark-4)',
        'var(--mantine-color-gray-3)',
        'var(--mantine-color-gray-3)',
        'var(--mantine-color-gray-3)',
        'var(--mantine-color-gray-3)',
        'var(--mantine-color-gray-3)',
      ],
      'chatbox-background-disabled': [
        'var(--mantine-color-dark-6)',
        'var(--mantine-color-dark-6)',
        'var(--mantine-color-dark-6)',
        'var(--mantine-color-dark-6)',
        'var(--mantine-color-dark-6)',
        'var(--mantine-color-gray-2)',
        'var(--mantine-color-gray-2)',
        'var(--mantine-color-gray-2)',
        'var(--mantine-color-gray-2)',
        'var(--mantine-color-gray-2)',
      ],
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
        styles: (theme, props) => ({
          wrapper: {
            '--input-height-sm': rem('32px'),
            ...(props.error
              ? {
                  '--input-color': 'var(--mantine-color-chatbox-error-text)',
                  '--input-bd': 'var(--mantine-color-chatbox-error-text)',
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
        styles: (theme, props) => {
          return {
            label: {
              color: props.checked
                ? 'var(--mantine-color-chatbox-primary-text)'
                : 'var(--mantine-color-chatbox-tertiary-text)',
            },
          }
        },
      }),
      Checkbox: Checkbox.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: (theme, props) => ({
          label: {
            color: props.checked
              ? 'var(--mantine-color-chatbox-primary-text)'
              : 'var(--mantine-color-chatbox-tertiary-text)',
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
            color: 'var(--mantine-color-chatbox-primary-text)',
            fontSize: 'var(--mantine-font-size-sm)',
          },
          close: {
            width: rem('24px'),
            height: rem('24px'),
            color: 'var(--mantine-color-chatbox-secondary-text)',
          },
        }),
      }),
      Combobox: Combobox.extend({
        defaultProps: {
          shadow: 'md',
        },
      }),
      Avatar: Avatar.extend({
        styles: () => ({
          image: {
            objectFit: 'contain',
          },
        }),
      }),
    },
  })

export const Route = createRootRoute({
  component: () => {
    useI18nEffect()
    premiumActions.useAutoValidate() // 每次启动都执行 license 检查，防止用户在lemonsqueezy管理页面中取消了当前设备的激活
    useSystemLanguageWhenInit()
    useShortcut()
    useScreenChange()
    const theme = useAppTheme()
    const _theme = useAtomValue(atoms.themeAtom)
    const settings = useAtomValue(atoms.settingsAtom)
    const scale = settings.fontSize / 14
    const mantineTheme = useMemo(() => creteMantineTheme(scale), [scale])

    return (
      <QueryClientProvider client={queryClient}>
        <MantineProvider
          theme={mantineTheme}
          defaultColorScheme={_theme === Theme.Dark ? 'dark' : _theme === Theme.Light ? 'light' : 'auto'}
        >
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <NiceModal.Provider>
              <Root />
            </NiceModal.Provider>
          </ThemeProvider>
        </MantineProvider>
      </QueryClientProvider>
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
  | 'chatbox-border-primary'
  | 'chatbox-border-secondary'
  | DefaultMantineColor

declare module '@mantine/core' {
  export interface MantineThemeColorsOverride {
    colors: Record<ExtendedCustomColors, MantineColorsTuple>
  }
}
