import { rendererApplication } from '@/app/renderer-application'

/** Compatibility facade for callers that have not moved to the Renderer Composition Root yet. */
export const settingsStorage = rendererApplication.settingsStorage
export const settingsService = rendererApplication.settings
export const settingsStore = rendererApplication.settingsStore
export const rendererSettingsEffects = rendererApplication.settingsEffects as NonNullable<
  typeof rendererApplication.settingsEffects
>
