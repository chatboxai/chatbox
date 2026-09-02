import type { AnalyticsEventParams } from '@shared/analytics'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'

export function trackingEvent(name: string, params: AnalyticsEventParams = {}) {
  const allowReportingAndTracking = settingsStore.getState().allowReportingAndTracking
  if (!allowReportingAndTracking) {
    return
  }
  platform.trackingEvent(name, params)
}
