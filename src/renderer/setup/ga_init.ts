import { GOOGLE_ANALYTICS_APP_OPEN_EVENT, GOOGLE_ANALYTICS_MEASUREMENT_ID } from '@shared/analytics'
import platform from '@/platform'
import { initSettingsStore, settingsStore } from '@/stores/settingsStore'

const APP_OPEN_ENGAGEMENT_DELAY_MS = 1_000
const SESSION_TIMEOUT_MS = 30 * 60 * 1_000
const GOOGLE_ANALYTICS_DISABLE_KEY = `ga-disable-${GOOGLE_ANALYTICS_MEASUREMENT_ID}`

let initializationPromise: Promise<void> | undefined
let appOpenTimer: ReturnType<typeof setTimeout> | undefined
let trackingReady = false
let sessionId: number | undefined
let lastForegroundAt: number | undefined
let foregroundStartedAt: number | undefined

function setGoogleAnalyticsCollectionEnabled(enabled: boolean): void {
  ;(window as unknown as Record<string, boolean>)[GOOGLE_ANALYTICS_DISABLE_KEY] = !enabled
}

function cancelPendingAppOpen(): void {
  if (appOpenTimer !== undefined) {
    clearTimeout(appOpenTimer)
    appOpenTimer = undefined
  }
}

function scheduleAppOpen(): void {
  if (!trackingReady || !settingsStore.getState().allowReportingAndTracking) {
    return
  }

  const now = Date.now()
  if (sessionId === undefined || lastForegroundAt === undefined || now - lastForegroundAt > SESSION_TIMEOUT_MS) {
    sessionId = Math.floor(now / 1_000)
  }
  lastForegroundAt = now
  foregroundStartedAt = now

  cancelPendingAppOpen()
  appOpenTimer = setTimeout(() => {
    appOpenTimer = undefined
    const currentSessionId = sessionId
    const currentForegroundStartedAt = foregroundStartedAt
    if (
      !trackingReady ||
      !settingsStore.getState().allowReportingAndTracking ||
      currentSessionId === undefined ||
      currentForegroundStartedAt === undefined
    ) {
      return
    }

    void platform
      .isWindowFocused()
      .catch(() => true)
      .then((isFocused) => {
        if (!isFocused || !trackingReady || !settingsStore.getState().allowReportingAndTracking) {
          return
        }
        platform.trackingEvent(GOOGLE_ANALYTICS_APP_OPEN_EVENT, {
          event_category: 'engagement',
          session_id: currentSessionId,
          engagement_time_msec: Math.max(1, Date.now() - currentForegroundStartedAt),
        })
      })
  }, APP_OPEN_ENGAGEMENT_DELAY_MS)
}

async function enableGoogleAnalytics(): Promise<void> {
  setGoogleAnalyticsCollectionEnabled(true)
  try {
    await platform.initTracking()
    if (!settingsStore.getState().allowReportingAndTracking) {
      return
    }
    trackingReady = true
    scheduleAppOpen()
  } catch (e) {
    trackingReady = false
    setGoogleAnalyticsCollectionEnabled(false)
    console.error('Failed to initialize Google Analytics:', e)
  }
}

function disableGoogleAnalytics(): void {
  trackingReady = false
  cancelPendingAppOpen()
  setGoogleAnalyticsCollectionEnabled(false)
}

async function initializeGoogleAnalyticsTracking(): Promise<void> {
  const settings = await initSettingsStore()

  platform.onWindowFocused(scheduleAppOpen)
  settingsStore.subscribe((state, previousState) => {
    if (state.allowReportingAndTracking === previousState.allowReportingAndTracking) {
      return
    }
    if (state.allowReportingAndTracking) {
      void enableGoogleAnalytics()
    } else {
      disableGoogleAnalytics()
    }
  })

  if (settings.allowReportingAndTracking) {
    await enableGoogleAnalytics()
  } else {
    disableGoogleAnalytics()
  }
}

export function initGoogleAnalyticsTracking(): Promise<void> {
  initializationPromise ??= initializeGoogleAnalyticsTracking().catch((e) => {
    disableGoogleAnalytics()
    console.error('Failed to initialize Google Analytics tracking:', e)
  })
  return initializationPromise
}
