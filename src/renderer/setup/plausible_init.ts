import {
  normalizePlausibleUrl,
  normalizePlausibleVersion,
  type Plausible,
  type PlausibleOptions,
} from '../analytics/plausible'
import platform from '../platform'
import { initSettingsStore, settingsStore } from '../stores/settingsStore'

export type PlausibleNavigationSubscriber = (onResolved: (hrefChanged: boolean) => void) => void

export async function initPlausibleTracking(subscribeToNavigation?: PlausibleNavigationSubscriber): Promise<void> {
  try {
    const settings = await initSettingsStore()
    const version = normalizePlausibleVersion(await platform.getVersion().catch(() => 'unknown'))

    // 设置 Plausible 全局属性
    if (window.plausible) {
      // 统一使用脱敏 URL，并只为功能事件补充低基数版本属性。
      const originalPlausible = window.plausible
      const enhancedPlausible: Plausible = (event, options) => {
        if (!settingsStore.getState().allowReportingAndTracking) {
          return
        }

        const enhancedOptions: PlausibleOptions = {
          ...options,
          u: normalizePlausibleUrl(window.location.href),
        }
        if (event !== 'pageview') {
          enhancedOptions.props = {
            ...options?.props,
            version,
          }
        }
        return originalPlausible(event, enhancedOptions)
      }

      // 复制原始函数的队列属性
      if ('q' in originalPlausible && (originalPlausible as unknown as { q: unknown[] }).q) {
        ;(enhancedPlausible as unknown as { q: unknown[] }).q = (originalPlausible as unknown as { q: unknown[] }).q
      }

      window.plausible = enhancedPlausible

      let lastTrackedUrl: string | undefined
      const trackPageView = () => {
        const normalizedUrl = normalizePlausibleUrl(window.location.href)
        if (normalizedUrl === lastTrackedUrl) {
          return
        }
        lastTrackedUrl = normalizedUrl
        enhancedPlausible('pageview', { u: normalizedUrl })
      }

      if (settings.allowReportingAndTracking) {
        trackPageView()
      }

      subscribeToNavigation?.((hrefChanged) => {
        if (hrefChanged) {
          trackPageView()
        }
      })

      settingsStore.subscribe((state, previousState) => {
        if (state.allowReportingAndTracking && !previousState.allowReportingAndTracking) {
          lastTrackedUrl = undefined
          trackPageView()
        }
      })
    }
  } catch (e) {
    console.error('Failed to initialize Plausible with version:', e)
  }
}
