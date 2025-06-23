import { useMemo, useLayoutEffect } from 'react'
import { getDefaultStore, useAtomValue } from 'jotai'
import { realThemeAtom, themeAtom, fontSizeAtom, languageAtom } from '../stores/atoms'
import { createTheme } from '@mui/material/styles'
import { ThemeOptions } from '@mui/material/styles'
import { Theme, Language } from '../../shared/types'
import platform from '../platform'
import DesktopPlatform from '../platform/desktop_platform'

export const switchTheme = async (theme: Theme) => {
  const store = getDefaultStore()
  let finalTheme = 'light' as 'light' | 'dark'
  if (theme === Theme.System) {
    finalTheme = (await platform.shouldUseDarkColors()) ? 'dark' : 'light'
  } else {
    finalTheme = theme === Theme.Dark ? 'dark' : 'light'
  }
  store.set(realThemeAtom, finalTheme)
  localStorage.setItem('initial-theme', finalTheme)
  if (platform instanceof DesktopPlatform) {
    await platform.switchTheme(finalTheme)
  }
}

export default function useAppTheme() {
  const theme = useAtomValue(themeAtom)
  const fontSize = useAtomValue(fontSizeAtom)
  const realTheme = useAtomValue(realThemeAtom)
  const language = useAtomValue(languageAtom)

  useLayoutEffect(() => {
    switchTheme(theme)
  }, [theme])

  useLayoutEffect(() => {
    platform.onSystemThemeChange(() => {
      const store = getDefaultStore()
      const theme = store.get(themeAtom)
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

  const themeObj = useMemo(
    () => createTheme(getThemeDesign(realTheme, fontSize, language)),
    [realTheme, fontSize, language]
  )
  return themeObj
}

export function getThemeDesign(realTheme: 'light' | 'dark', fontSize: number, language: Language): ThemeOptions {
  return {
    palette: {
      mode: realTheme,
      ...(realTheme === 'light'
        ? {}
        : {
            background: {
              default: 'rgb(40, 40, 40)',
              paper: 'rgb(40, 40, 40)',
            },
          }),
    },
    typography: {
      // In Chinese and Japanese the characters are usually larger,
      // so a smaller fontsize may be appropriate.
      ...(language === 'ar'
        ? {
            fontFamily: 'Cairo, Arial, sans-serif',
          }
        : {}),
      fontSize: (fontSize * 14) / 16,
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
