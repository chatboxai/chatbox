/** Static capability currently consumed by GenerationService. */
export type PlatformCapability = 'agent-mode'

export interface PlatformCapabilitiesPort {
  supports(capability: PlatformCapability): boolean
}
