// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { initSettingsStoreMock, settingsStoreGetStateMock, settingsStoreSubscribeMock } = vi.hoisted(() => ({
  initSettingsStoreMock: vi.fn(async () => ({ allowReportingAndTracking: false })),
  settingsStoreGetStateMock: vi.fn(() => ({ allowReportingAndTracking: false })),
  settingsStoreSubscribeMock: vi.fn(),
}))

vi.mock('@/analytics/jk', () => ({
  initJkAnalytics: vi.fn(),
  trackJkViewEvent: vi.fn(),
}))
vi.mock('@/analytics/jk-events', () => ({ JK_EVENTS: { APP_LAUNCH: 'app_launch' } }))
vi.mock('@/stores/settingsStore', () => ({
  initSettingsStore: initSettingsStoreMock,
  settingsStore: {
    getState: settingsStoreGetStateMock,
    subscribe: settingsStoreSubscribeMock,
  },
}))
vi.mock('../platform', () => ({
  default: {
    getVersion: vi.fn(async () => '1.0.0'),
    onWindowFocused: vi.fn(),
  },
}))

describe('settings-backed telemetry initialization', () => {
  beforeEach(() => {
    initSettingsStoreMock.mockClear()
    settingsStoreGetStateMock.mockReset()
    settingsStoreGetStateMock.mockReturnValue({ allowReportingAndTracking: false })
    settingsStoreSubscribeMock.mockClear()
    window.plausible = undefined
    window.history.replaceState({}, '', '/')
    vi.resetModules()
  })

  it('does not hydrate settings as an import side effect', async () => {
    await Promise.all([import('./ga_init'), import('./jk_analytics_init'), import('./plausible_init')])

    expect(initSettingsStoreMock).not.toHaveBeenCalled()
  })

  it('hydrates settings only after explicit post-migration initialization', async () => {
    const [{ initGoogleAnalyticsTracking }, { initJkTracking }, { initPlausibleTracking }] = await Promise.all([
      import('./ga_init'),
      import('./jk_analytics_init'),
      import('./plausible_init'),
    ])

    await initGoogleAnalyticsTracking()
    await initPlausibleTracking()
    await initJkTracking()

    expect(initSettingsStoreMock).toHaveBeenCalledTimes(3)
  })

  it('subscribes to navigation without importing the application router', async () => {
    initSettingsStoreMock.mockResolvedValueOnce({ allowReportingAndTracking: true })
    settingsStoreGetStateMock.mockReturnValue({ allowReportingAndTracking: true })
    const plausibleMock = vi.fn()
    const navigationSubscriber = vi.fn()
    window.plausible = plausibleMock

    const { initPlausibleTracking } = await import('./plausible_init')
    await initPlausibleTracking(navigationSubscriber)

    expect(navigationSubscriber).toHaveBeenCalledOnce()
    expect(plausibleMock).toHaveBeenCalledWith('pageview', expect.not.objectContaining({ props: expect.anything() }))
  })

  it('deduplicates pageviews using the normalized URL', async () => {
    initSettingsStoreMock.mockResolvedValueOnce({ allowReportingAndTracking: true })
    settingsStoreGetStateMock.mockReturnValue({ allowReportingAndTracking: true })
    const plausibleMock = vi.fn()
    let onNavigationResolved: ((hrefChanged: boolean) => void) | undefined
    window.plausible = plausibleMock
    window.history.replaceState({}, '', '/#/session/session-a')

    const { initPlausibleTracking } = await import('./plausible_init')
    await initPlausibleTracking((callback) => {
      onNavigationResolved = callback
    })

    window.history.replaceState({}, '', '/#/session/session-b')
    onNavigationResolved?.(true)
    expect(plausibleMock).toHaveBeenCalledTimes(1)

    window.history.replaceState({}, '', '/#/settings/general')
    onNavigationResolved?.(true)
    expect(plausibleMock).toHaveBeenCalledTimes(2)
  })

  it('attaches a normalized version only to custom events', async () => {
    initSettingsStoreMock.mockResolvedValueOnce({ allowReportingAndTracking: true })
    settingsStoreGetStateMock.mockReturnValue({ allowReportingAndTracking: true })
    const plausibleMock = vi.fn()
    window.plausible = plausibleMock

    const { initPlausibleTracking } = await import('./plausible_init')
    await initPlausibleTracking()
    window.plausible?.('generate', { props: { provider: 'openai' } })

    expect(plausibleMock).toHaveBeenLastCalledWith('generate', {
      props: {
        provider: 'openai',
        version: '1.0',
      },
      u: window.location.href,
    })
  })
})
