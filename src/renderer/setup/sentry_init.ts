import * as Sentry from '@sentry/react'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET, NODE_ENV } from '@/variables'
import { initSettingsStore } from '@/stores/settingsStore'
import platform from '../platform'

void (async () => {
  try {
    const settings = await initSettingsStore()
    if (!settings.allowReportingAndTracking) {
      return
    }

    const version = await platform.getVersion().catch(() => 'unknown')
    Sentry.init({
      dsn: 'https://eca691c5e01ebfa05958fca1fcb487a9@sentry.midway.run/697',
      environment: NODE_ENV,
      sampleRate: 1.0,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.05,
      replaysOnErrorSampleRate: 0.05,
      release: version,
      initialScope: {
        tags: {
          platform: platform.type,
          app_version: version,
          build_target: CHATBOX_BUILD_TARGET,
          build_platform: CHATBOX_BUILD_PLATFORM,
        },
      },
      beforeSend(event) {
        if (event.tags?.errorBoundary) {
          return event
        }
        if (Math.random() < 0.1) {
          return event
        }
        return null
      },
    })
  } catch (e) {
    console.error('Failed to initialize Sentry:', e)
  }
})()

export default Sentry
