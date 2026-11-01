import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as defaults from '../shared/defaults'

const mocks = vi.hoisted(() => ({
  persistedSettings: undefined as unknown,
  set: vi.fn(),
  sentryInit: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/isolated-profile', getVersion: () => '1.23.5' },
  powerMonitor: { on: vi.fn() },
}))
vi.mock('electron-store', () => ({
  default: class {
    path = '/isolated-profile/config.json'
    get(key: string, fallback?: unknown) {
      if (key !== 'settings') throw new Error(`Unexpected key: ${key}`)
      return mocks.persistedSettings === undefined ? fallback : mocks.persistedSettings
    }
    set = mocks.set
    onDidAnyChange = vi.fn()
  },
}))
vi.mock('fs-extra', () => ({ existsSync: () => false, readdirSync: () => [] }))
vi.mock('./util', () => ({ getLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('@sentry/node', () => ({ init: mocks.sentryInit }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.clearAllMocks()
  mocks.persistedSettings = undefined
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('main-process settings boundary', () => {
  it('uses normal first-run defaults when settings are absent', async () => {
    const { getSettings } = await import('./store-node')
    expect(getSettings()).toEqual(defaults.settings())
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each([null, false, true, 0, 1, '', 'invalid', []])(
    'returns usable defaults without telemetry or storage writes for %j',
    async (value) => {
      mocks.persistedSettings = value
      const { getSettings } = await import('./store-node')
      expect(getSettings()).toEqual({ ...defaults.settings(), allowReportingAndTracking: false })
      expect(mocks.persistedSettings).toBe(value)
      expect(mocks.set).not.toHaveBeenCalled()
      await expect(import('./adapters/sentry')).resolves.toBeDefined()
      expect(mocks.sentryInit).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])('preserves valid settings and explicit telemetry consent (%s)', async (enabled) => {
    const settings = { ...defaults.settings(), allowReportingAndTracking: enabled, fontSize: 18 }
    mocks.persistedSettings = settings
    const { getSettings } = await import('./store-node')
    expect(getSettings()).toBe(settings)
    await import('./adapters/sentry')
    expect(mocks.sentryInit).toHaveBeenCalledTimes(enabled ? 1 : 0)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('preserves partial settings objects', async () => {
    const settings = { language: 'zh-Hans', allowReportingAndTracking: false }
    mocks.persistedSettings = settings
    const { getSettings } = await import('./store-node')
    expect(getSettings()).toBe(settings)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('suppresses reporting if settings become null after Sentry initialization', async () => {
    mocks.persistedSettings = { ...defaults.settings(), allowReportingAndTracking: true }
    await import('./adapters/sentry')
    const options = mocks.sentryInit.mock.calls[0][0] as {
      beforeSend: (event: object, hint: object) => unknown
    }
    mocks.persistedSettings = null
    expect(options.beforeSend({}, {})).toBeNull()
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
