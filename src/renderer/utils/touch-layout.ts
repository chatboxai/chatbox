/**
 * Whether interactions follow the touch model (long press instead of hover and
 * right click): Capacitor phones/tablets, narrow viewports, and non-desktop
 * coarse pointers (mobile web / tablets).
 */
export function shouldUseTouchLayout(options: {
  platformType: string
  isDesktopLike: boolean
  isSmallScreen: boolean
  coarsePointer: boolean
}): boolean {
  return options.platformType === 'mobile' || options.isSmallScreen || (!options.isDesktopLike && options.coarsePointer)
}
