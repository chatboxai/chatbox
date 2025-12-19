import { useMantineTheme } from '@mantine/core'
import { useMediaQuery, useTheme } from '@mui/material'
import { useEffect } from 'react'
import { useUIStore } from '../stores/uiStore'

export default function useScreenChange() {
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const realIsSmallScreen = useIsSmallScreen()
  useEffect(() => {
    setShowSidebar(!realIsSmallScreen)
  }, [realIsSmallScreen, setShowSidebar])
}

export function useIsSmallScreen() {
  const theme = useTheme()
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'))
  return isSmallScreen
}

export function useScreenDownToMD() {
  const theme = useTheme()
  return useMediaQuery(theme.breakpoints.down('md'))
}

export function useIsLargeScreen() {
  const theme = useTheme()
  return !useMediaQuery(theme.breakpoints.down('lg'))
}

export function useSidebarWidth() {
  const mantineTheme = useMantineTheme()
  const scale = mantineTheme.scale ?? 1
  const theme = useTheme()
  const customWidth = useUIStore((s) => s.sidebarWidth)

  // Always call hooks in the same order
  const sm = useMediaQuery(theme.breakpoints.up('sm'))
  const md = useMediaQuery(theme.breakpoints.up('md'))
  const lg = useMediaQuery(theme.breakpoints.up('lg'))
  const xl = useMediaQuery(theme.breakpoints.up('xl'))

  // If custom width is set, use it
  if (customWidth !== null) {
    return customWidth
  }

  // Otherwise use default responsive width
  if (xl) {
    return 280 * scale
  } else if (lg) {
    return 240 * scale
  } else if (md) {
    return 220 * scale
  } else if (sm) {
    return 200 * scale
  } else {
    return 240 * scale
  }
}

export function useInputBoxHeight(): { min: number; max: number } {
  const theme = useTheme()
  const sm = useMediaQuery(theme.breakpoints.up('sm'))
  const md = useMediaQuery(theme.breakpoints.up('md'))
  // const lg = useMediaQuery(theme.breakpoints.up('lg'))
  const xl = useMediaQuery(theme.breakpoints.up('xl'))
  if (xl) {
    return { min: 96, max: 480 }
  } else if (md) {
    return { min: 72, max: 384 }
  } else if (sm) {
    return { min: 56, max: 288 }
  } else {
    return { min: 32, max: 192 }
  }
}
