import { useEffect, useState } from 'react'
import platform from '@/platform'

export type ComposerMenuLayout = 'desktop' | 'touch'

const SMALL_SCREEN_QUERY = '(max-width: 639px)'
const COARSE_POINTER_QUERY = '(pointer: coarse)'

export function shouldUseComposerTouchLayout(options: {
  platformType: string
  isDesktopLike: boolean
  isSmallScreen: boolean
  coarsePointer: boolean
}): boolean {
  return options.platformType === 'mobile' || options.isSmallScreen || (!options.isDesktopLike && options.coarsePointer)
}

function readMediaQuery(query: string): boolean {
  return typeof window !== 'undefined' && window.matchMedia(query).matches
}

function useMediaQueryString(query: string): boolean {
  const [matches, setMatches] = useState(() => readMediaQuery(query))

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const onChange = () => setMatches(mediaQuery.matches)
    onChange()
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** Capacitor phones/tablets, narrow viewports, and non-desktop coarse pointers (mobile web / tablets). */
export function useComposerTouchLayout(): boolean {
  const isSmallScreen = useMediaQueryString(SMALL_SCREEN_QUERY)
  const coarsePointer = useMediaQueryString(COARSE_POINTER_QUERY)
  return shouldUseComposerTouchLayout({
    platformType: platform.type,
    isDesktopLike: platform.isDesktopLike,
    isSmallScreen,
    coarsePointer,
  })
}

export function resolveComposerMenuLayout(
  layout: ComposerMenuLayout | undefined,
  detectedTouch: boolean
): ComposerMenuLayout {
  return layout ?? (detectedTouch ? 'touch' : 'desktop')
}
