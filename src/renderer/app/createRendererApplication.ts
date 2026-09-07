import type { LoggerPort, SettingsStoragePort } from '@chatbox/core/ports'
import { type ChatApplication, type CreateChatApplicationOptions, createChatApplication } from '@chatbox/react'
import type { AuthInfoStore, LastUsedModelStore } from '@chatbox/react/stores'
import { RendererSettingsEffects, type RendererSettingsEffectsHost } from '@/adapters/RendererSettingsEffects'

export type RendererHostKind = 'desktop' | 'web' | 'capacitor'

export interface RendererHostDescriptor {
  kind: RendererHostKind
  runtime: string
  capabilities: {
    desktopLike: boolean
    nativeMobile: boolean
  }
}

export interface CreateRendererApplicationOptions
  extends Omit<
    CreateChatApplicationOptions,
    'authInfoStore' | 'lastUsedModelStore' | 'settings' | 'initializeSessionsOnBootstrap'
  > {
  authInfoStore: AuthInfoStore
  lastUsedModelStore: LastUsedModelStore
  host: RendererHostDescriptor
  settingsLogger?: LoggerPort
  settingsEffectsHost?: RendererSettingsEffectsHost
}

export interface RendererApplication extends ChatApplication {
  readonly authInfoStore: AuthInfoStore
  readonly lastUsedModelStore: LastUsedModelStore
  readonly host: RendererHostDescriptor
  readonly settingsStorage: SettingsStoragePort
  readonly settingsEffects: RendererSettingsEffects | null
}

/** Builds the current React Renderer around the same portable application graph used by RN. */
export function createRendererApplication(options: CreateRendererApplicationOptions): RendererApplication {
  const application = createChatApplication({
    ...options,
    settings: {
      isDesktopLike: () => options.host.capabilities.desktopLike,
      logger: options.settingsLogger,
    },
    // Preserve the current Renderer behavior: session metadata is initialized on first use.
    initializeSessionsOnBootstrap: false,
  })
  const settingsEffects = options.settingsEffectsHost
    ? new RendererSettingsEffects(application.settings, options.settingsEffectsHost)
    : null
  settingsEffects?.start()

  const disposeApplication = application.dispose.bind(application)
  return Object.assign(application, {
    authInfoStore: options.authInfoStore,
    lastUsedModelStore: options.lastUsedModelStore,
    host: options.host,
    settingsStorage: options.settingsStorage,
    settingsEffects,
    dispose() {
      settingsEffects?.stop()
      disposeApplication()
    },
  })
}
