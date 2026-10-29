import { useMediaQuery } from '@mui/material'
import platform from '@/platform'
import { shouldUseTouchLayout } from '@/utils/touch-layout'
import { useIsSmallScreen } from './useScreenChange'

const COARSE_POINTER_QUERY = '(pointer: coarse)'

/** Whether the current device and viewport use touch interactions; see `shouldUseTouchLayout`. */
export function useTouchLayout(): boolean {
  const isSmallScreen = useIsSmallScreen()
  const coarsePointer = useMediaQuery(COARSE_POINTER_QUERY)
  return shouldUseTouchLayout({
    platformType: platform.type,
    isDesktopLike: platform.isDesktopLike,
    isSmallScreen,
    coarsePointer,
  })
}
