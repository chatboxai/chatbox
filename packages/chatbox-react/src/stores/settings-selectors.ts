import type { SettingsStoreState } from './createSettingsStore'

export const selectSettings = (state: SettingsStoreState) => state.getSettings()
export const selectSettingsHydrationStatus = (state: SettingsStoreState) => state.hydrationStatus
export const selectLanguage = (state: SettingsStoreState) => state.language
export const selectTheme = (state: SettingsStoreState) => state.theme
export const selectMcpSettings = (state: SettingsStoreState) => state.mcp
