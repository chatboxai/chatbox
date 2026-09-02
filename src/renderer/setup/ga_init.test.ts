// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  initSettingsStoreMock,
  isWindowFocusedMock,
  onWindowFocusedMock,
  platformInitTrackingMock,
  settingsStoreGetStateMock,
  settingsStoreSubscribeMock,
  trackingEventMock,
} = vi.hoisted(() => ({
  initSettingsStoreMock: vi.fn(),
  isWindowFocusedMock: vi.fn(async () => true),
  onWindowFocusedMock: vi.fn(),
  platformInitTrackingMock: vi.fn(async () => undefined),
  settingsStoreGetStateMock: vi.fn(),
  settingsStoreSubscribeMock: vi.fn(),
  trackingEventMock: vi.fn(),
}))

vi.mock('@/platform', () => ({
  default: {
    initTracking: platformInitTrackingMock,
    isWindowFocused: isWindowFocusedMock,
    onWindowFocused: onWindowFocusedMock,
    trackingEvent: trackingEventMock,
  },
}))
vi.mock('@/stores/settingsStore', () => ({
  initSettingsStore: initSettingsStoreMock,
  settingsStore: {
    getState: settingsStoreGetStateMock,
    subscribe: settingsStoreSubscribeMock,
  },
}))

const disableKey = 'ga-disable-G-B365F44W6E'

describe('Google Analytics initialization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-28T10:00:00.000Z'))
    initSettingsStoreMock.mockReset()
    isWindowFocusedMock.mockClear()
    onWindowFocusedMock.mockClear()
    platformInitTrackingMock.mockClear()
    settingsStoreGetStateMock.mockReset()
    settingsStoreSubscribeMock.mockReset()
    trackingEventMock.mockClear()
    delete (window as unknown as Record<string, boolean>)[disableKey]
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not initialize or emit events before consent is enabled', async () => {
    const disabledSettings = { allowReportingAndTracking: false }
    initSettingsStoreMock.mockResolvedValue(disabledSettings)
    settingsStoreGetStateMock.mockReturnValue(disabledSettings)

    const { initGoogleAnalyticsTracking } = await import('./ga_init')
    await initGoogleAnalyticsTracking()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(platformInitTrackingMock).not.toHaveBeenCalled()
    expect(trackingEventMock).not.toHaveBeenCalled()
    expect((window as unknown as Record<string, boolean>)[disableKey]).toBe(true)
  })

  it('emits an app_open event with session and engagement parameters', async () => {
    const enabledSettings = { allowReportingAndTracking: true }
    initSettingsStoreMock.mockResolvedValue(enabledSettings)
    settingsStoreGetStateMock.mockReturnValue(enabledSettings)

    const { initGoogleAnalyticsTracking } = await import('./ga_init')
    await initGoogleAnalyticsTracking()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(platformInitTrackingMock).toHaveBeenCalledOnce()
    expect(onWindowFocusedMock).toHaveBeenCalledOnce()
    expect(trackingEventMock).toHaveBeenCalledWith('app_open', {
      event_category: 'engagement',
      session_id: 1_785_232_800,
      engagement_time_msec: 1_000,
    })
    expect((window as unknown as Record<string, boolean>)[disableKey]).toBe(false)
  })

  it('cancels a pending app_open event when consent is disabled', async () => {
    const enabledSettings = { allowReportingAndTracking: true }
    const disabledSettings = { allowReportingAndTracking: false }
    let settingsSubscriber: ((state: typeof enabledSettings, previousState: typeof enabledSettings) => void) | undefined

    initSettingsStoreMock.mockResolvedValue(enabledSettings)
    settingsStoreGetStateMock.mockReturnValue(enabledSettings)
    settingsStoreSubscribeMock.mockImplementation((subscriber) => {
      settingsSubscriber = subscriber
      return () => undefined
    })

    const { initGoogleAnalyticsTracking } = await import('./ga_init')
    await initGoogleAnalyticsTracking()

    settingsStoreGetStateMock.mockReturnValue(disabledSettings)
    settingsSubscriber?.(disabledSettings, enabledSettings)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(trackingEventMock).not.toHaveBeenCalled()
    expect((window as unknown as Record<string, boolean>)[disableKey]).toBe(true)
  })

  it('keeps collection disabled when platform initialization fails', async () => {
    const enabledSettings = { allowReportingAndTracking: true }
    initSettingsStoreMock.mockResolvedValue(enabledSettings)
    settingsStoreGetStateMock.mockReturnValue(enabledSettings)
    platformInitTrackingMock.mockRejectedValueOnce(new Error('config unavailable'))

    const { initGoogleAnalyticsTracking } = await import('./ga_init')
    await initGoogleAnalyticsTracking()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(trackingEventMock).not.toHaveBeenCalled()
    expect((window as unknown as Record<string, boolean>)[disableKey]).toBe(true)
  })

  it('starts a new session after returning to the foreground following 30 minutes', async () => {
    const enabledSettings = { allowReportingAndTracking: true }
    let focusCallback: (() => void) | undefined
    initSettingsStoreMock.mockResolvedValue(enabledSettings)
    settingsStoreGetStateMock.mockReturnValue(enabledSettings)
    onWindowFocusedMock.mockImplementation((callback) => {
      focusCallback = callback
      return () => undefined
    })

    const { initGoogleAnalyticsTracking } = await import('./ga_init')
    await initGoogleAnalyticsTracking()
    await vi.advanceTimersByTimeAsync(1_000)
    trackingEventMock.mockClear()

    vi.setSystemTime(new Date('2026-07-28T10:31:00.000Z'))
    focusCallback?.()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(trackingEventMock).toHaveBeenCalledWith(
      'app_open',
      expect.objectContaining({
        session_id: 1_785_234_660,
        engagement_time_msec: 1_000,
      })
    )
  })
})
