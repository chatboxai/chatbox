import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as defaults from '../shared/defaults'

const mockStoreGet = vi.fn()
const mockStoreSet = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/chatbox-test'),
  },
  powerMonitor: {
    on: vi.fn(),
  },
}))

vi.mock('electron-store', () => ({
  default: class MockStore {
    path = '/tmp/chatbox-test/config.json'

    get = mockStoreGet
    set = mockStoreSet
  },
}))

vi.mock('fs-extra', () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  copySync: vi.fn(),
  pathExists: vi.fn(async () => false),
  copy: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  readFile: vi.fn(async () => ''),
  writeFile: vi.fn(async () => undefined),
  ensureDir: vi.fn(async () => undefined),
}))

vi.mock('./util', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}))

describe('main store settings hydration', () => {
  beforeEach(() => {
    vi.resetModules()
    mockStoreGet.mockReset()
    mockStoreSet.mockReset()
  })

  it('rehydrates defaults when persisted settings are null', async () => {
    mockStoreGet.mockImplementation((key: string, fallbackValue: unknown) => {
      return key === 'settings' ? null : fallbackValue
    })

    const { getSettings } = await import('./store-node')

    const settings = getSettings()
    const expectedSettings = defaults.settings()

    expect(settings).toEqual(expectedSettings)
    expect(mockStoreSet).toHaveBeenCalledWith('settings', expectedSettings)
  })

  it('returns persisted settings without rewriting them when present', async () => {
    const persistedSettings = {
      ...defaults.settings(),
      allowReportingAndTracking: false,
    }

    mockStoreGet.mockImplementation((key: string, fallbackValue: unknown) => {
      return key === 'settings' ? persistedSettings : fallbackValue
    })

    const { getSettings } = await import('./store-node')

    expect(getSettings()).toEqual(persistedSettings)
    expect(mockStoreSet).not.toHaveBeenCalled()
  })
})
