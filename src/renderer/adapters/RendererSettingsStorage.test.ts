import { SettingsService } from '@chatbox/core/application/settings'
import { createDefaultSettings, encodePersistedSettings } from '@chatbox/core/domain/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RendererSettingsStorage } from './RendererSettingsStorage'

const mocks = vi.hoisted(() => ({
  platform: { type: 'desktop', isDesktopLike: true, getSettings: vi.fn() },
  storage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}))
vi.mock('@/platform', () => ({ default: mocks.platform }))
vi.mock('@/storage', () => ({ default: mocks.storage }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.platform.type = 'desktop'
  mocks.platform.isDesktopLike = true
})

describe('Electron host settings recovery', () => {
  it.each(['desktop', 'harmony'])('%s preserves recovered consent through hydration and updates', async (type) => {
    mocks.platform.type = type
    const recovered = { ...createDefaultSettings(), allowReportingAndTracking: false }
    mocks.platform.getSettings.mockResolvedValue(recovered)
    const service = new SettingsService(new RendererSettingsStorage(), { isDesktopLike: true })
    expect((await service.hydrate()).allowReportingAndTracking).toBe(false)
    expect(mocks.platform.getSettings).toHaveBeenCalledOnce()
    expect(mocks.storage.getItem).not.toHaveBeenCalled()
    expect(mocks.storage.setItem).not.toHaveBeenCalled()

    service.updateSettings({ fontSize: 18 })
    await service.flushPersistence()
    expect(mocks.storage.setItem).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ allowReportingAndTracking: false, fontSize: 18 })
    )
    service.dispose()
  })

  it('preserves first-run defaults', async () => {
    mocks.platform.getSettings.mockResolvedValue(createDefaultSettings())
    const service = new SettingsService(new RendererSettingsStorage(), { isDesktopLike: true })
    expect((await service.hydrate()).allowReportingAndTracking).toBe(true)
    expect(mocks.storage.setItem).not.toHaveBeenCalled()
    service.dispose()
  })

  it('passes valid versioned desktop settings through unchanged', async () => {
    const stored = encodePersistedSettings({ ...createDefaultSettings(), fontSize: 18 })
    mocks.platform.getSettings.mockResolvedValue(stored)
    expect(await new RendererSettingsStorage().read()).toBe(stored)
  })

  it.each(['web', 'mobile', 'test'])('retains the %s storage path', async (type) => {
    mocks.platform.type = type
    mocks.platform.isDesktopLike = false
    const stored = encodePersistedSettings(createDefaultSettings())
    mocks.storage.getItem.mockResolvedValue(stored)
    expect(await new RendererSettingsStorage().read()).toBe(stored)
    expect(mocks.storage.getItem).toHaveBeenCalledWith('settings', null)
    expect(mocks.platform.getSettings).not.toHaveBeenCalled()
  })
})
