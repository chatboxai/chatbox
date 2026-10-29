export type { CopilotDetail, ImageSource } from '@shared/types'
export {
  COPILOT_PREFERENCES_STORAGE_KEY,
  CopilotPreferences,
  type CopilotPreferencesSnapshot,
} from './CopilotPreferences'
export {
  type CopilotMemoryLifecycle,
  type CopilotSaveOptions,
  CopilotService,
  type CopilotServiceOptions,
  type CopilotSnapshot,
  type CopilotStorageScope,
  MY_COPILOTS_STORAGE_KEY,
  searchCopilots,
} from './CopilotService'
export {
  type CopilotUsageAction,
  FeaturedCopilotClient,
  type FeaturedCopilotClientOptions,
  type FeaturedCopilotFilters,
  type FeaturedCopilotPage,
} from './FeaturedCopilotClient'
