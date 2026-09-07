import type { PlatformCapabilitiesPort, PlatformCapability } from '@chatbox/core/ports'
import platform from '@/platform'

export interface CurrentPlatformCapabilitySource {
  isDesktopLike: boolean
}

/**
 * Captures only the desktop-like Agent Mode gate consumed by GenerationService.
 * Feature-specific gates such as knowledge-base availability remain with their
 * real consumers, where platform details such as Windows ARM64 are available.
 */
export class CurrentPlatformCapabilities implements PlatformCapabilitiesPort {
  constructor(private readonly source: CurrentPlatformCapabilitySource = platform) {}

  supports(capability: PlatformCapability): boolean {
    return capability === 'agent-mode' && this.source.isDesktopLike
  }
}
