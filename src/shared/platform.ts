export type PlatformType = 'web' | 'desktop' | 'mobile'

/**
 * Platforms backed by the Electron main/preload bridge.
 */
export function isDesktopLikePlatform(platformType: PlatformType): boolean {
  return platformType === 'desktop'
}
