import { createTheme, type ThemeOptions } from '@mui/material/styles'
import { getDefaultInterfaceColors, resolveInterfaceBrandColor } from '@shared/theme-colors'
import { useLayoutEffect, useMemo } from 'react'
import { settingsStore, useLanguage, useSettingsStore } from '@/stores/settingsStore'
import { uiStore, useUIStore } from '@/stores/uiStore'
import { type Language, Theme } from '../../shared/types'
import platform from '../platform'
import DesktopPlatform from '../platform/desktop_platform'

export const switchTheme = async (theme: Theme) => {
  let finalTheme = 'light' as 'light' | 'dark'
  if (theme === Theme.System) {
    finalTheme = (await platform.shouldUseDarkColors()) ? 'dark' : 'light'
  } else {
    finalTheme = theme === Theme.Dark ? 'dark' : 'light'
  }
  uiStore.setState({
    realTheme: finalTheme,
  })
  localStorage.setItem('initial-theme', finalTheme)
  if (platform instanceof DesktopPlatform) {
    await platform.switchTheme(finalTheme)
  }
}

export default function useAppTheme() {
  const theme = useSettingsStore((state) => state.theme)
  const interfaceColors = useSettingsStore((state) => state.interfaceColors ?? getDefaultInterfaceColors())
  const realTheme = useUIStore((state) => state.realTheme)
  const language = useLanguage()

  useLayoutEffect(() => {
    switchTheme(theme)
  }, [theme])

  useLayoutEffect(() => {
    platform.onSystemThemeChange(() => {
      const theme = settingsStore.getState().theme
      switchTheme(theme)
    })
  }, [])

  useLayoutEffect(() => {
    // update material-ui theme
    document.querySelector('html')?.setAttribute('data-theme', realTheme)
    // update tailwindcss theme
    if (realTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [realTheme])

  useLayoutEffect(() => {
    const colors = interfaceColors[realTheme]
    const brandColor = resolveInterfaceBrandColor(colors.brand, realTheme)
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--chatbox-background-primary', colors.backgroundPrimary)
    rootStyle.setProperty('--chatbox-background-secondary', colors.backgroundSecondary)
    rootStyle.setProperty('--chatbox-background-tertiary', colors.backgroundTertiary)
    rootStyle.setProperty('--chatbox-brand', brandColor)
  }, [interfaceColors, realTheme])

  const themeObj = useMemo(
    () =>
      createTheme(
        getThemeDesign(
          realTheme,
          language,
          resolveInterfaceBrandColor(interfaceColors[realTheme].brand, realTheme),
          interfaceColors[realTheme].backgroundPrimary
        )
      ),
    [interfaceColors, language, realTheme]
  )
  return themeObj
}

export function getThemeDesign(
  realTheme: 'light' | 'dark',
  language: Language,
  brandColor = getDefaultInterfaceColors()[realTheme].brand,
  backgroundColor = getDefaultInterfaceColors()[realTheme].backgroundPrimary
): ThemeOptions {
  return {
    palette: {
      mode: realTheme,
      primary: {
        main: brandColor,
      },
      // MUI 内部无法处理 css 变量，需要使用具体颜色值
      background: {
        default: backgroundColor,
        paper: backgroundColor,
      },
      ...(realTheme === 'light'
        ? {}
        : {
            // Same value as the dark --chatbox-tint-primary in globals.css.
            text: {
              primary: '#ececec',
            },
          }),
    },
    components: {
      // MUI lightens dark-mode Paper by elevation; Chatbox surfaces carry their own layering.
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            backgroundColor: realTheme === 'dark' ? '#333333' : undefined,
            color: realTheme === 'dark' ? '#ffffff' : undefined,
          },
        },
      },
    },
    typography: {
      // In Chinese and Japanese the characters are usually larger,
      // so a smaller fontsize may be appropriate.
      ...(language === 'ar'
        ? {
            fontFamily: 'Cairo, Arial, sans-serif',
          }
        : {}),
      fontSize: 14,
    },
    direction: language === 'ar' ? 'rtl' : 'ltr',
    breakpoints: {
      values: {
        xs: 0,
        sm: 640, // 修改sm的值与tailwindcss保持一致
        md: 900,
        lg: 1200,
        xl: 1536,
      },
    },
  }
}
