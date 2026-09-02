import type { SettingsService } from '@chatbox/core/application/settings'
import type { Settings } from '@shared/types'

export interface RendererSettingsEffectsHost {
  ensureShortcutConfig(shortcuts: Settings['shortcuts']): void
  ensureProxyConfig(options: { proxy?: string }): void
  ensureAutoLaunch(enabled: boolean): void
}

/**
 * Keeps host lifecycle side effects outside SettingsService and shared stores.
 */
export class RendererSettingsEffects {
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly service: SettingsService,
    private readonly host: RendererSettingsEffectsHost
  ) {}

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.service.subscribe((settings, previousSettings) => {
      if (settings.shortcuts !== previousSettings.shortcuts) {
        this.host.ensureShortcutConfig(settings.shortcuts)
      }
      if (settings.proxy !== previousSettings.proxy) {
        this.host.ensureProxyConfig({ proxy: settings.proxy })
      }
      if (Boolean(settings.autoLaunch) !== Boolean(previousSettings.autoLaunch)) {
        this.host.ensureAutoLaunch(settings.autoLaunch)
      }
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}
