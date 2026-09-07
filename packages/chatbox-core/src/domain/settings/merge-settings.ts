import deepmerge from 'deepmerge'
import { createDefaultSettings } from './settings-defaults'
import { type Settings, SettingsSchema } from './settings-schema'

export function mergeSettingsWithDefaults(persisted: unknown): Settings {
  const persistedSettings =
    persisted && typeof persisted === 'object' && !Array.isArray(persisted) ? (persisted as Partial<Settings>) : {}
  const mergedSettings = deepmerge<Settings, Partial<Settings>>(createDefaultSettings(), persistedSettings, {
    arrayMerge: (_target, source) => source,
  })
  const parsedSettings = SettingsSchema.safeParse(mergedSettings)
  return parsedSettings.success ? parsedSettings.data : mergedSettings
}
