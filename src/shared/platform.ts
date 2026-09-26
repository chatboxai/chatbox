export type PlatformType = 'web' | 'desktop' | 'mobile'

/**
 * Platforms backed by the Electron main/preload bridge.
 */
export function isDesktopLikePlatform(platformType: PlatformType): boolean {
  return platformType === 'desktop'
}

/**
 * Platforms supporting session attachment RAG (desktop via Electron IPC, mobile via MobileLocalRagEngine).
 */
export function supportsSessionAttachmentRag(platformType: PlatformType): boolean {
  return platformType === 'desktop' || platformType === 'mobile'
}
