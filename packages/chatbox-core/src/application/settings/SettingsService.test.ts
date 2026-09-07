import { describe, expect, test, vi } from 'vitest'
import { createDefaultSettings, SETTINGS_PERSIST_VERSION } from '../../domain/settings'
import type { LoggerPort, SettingsStoragePort } from '../../ports'
import { SettingsService } from './SettingsService'

class MemorySettingsStorage implements SettingsStoragePort {
  constructor(public value: unknown = null) {}

  read = vi.fn(() => Promise.resolve(this.value))
  write = vi.fn((value: unknown) => {
    this.value = value
    return Promise.resolve()
  })
  remove = vi.fn(() => {
    this.value = null
    return Promise.resolve()
  })
}

describe('SettingsService', () => {
  test('hydrates once and writes the current envelope on the next update', async () => {
    const defaults = createDefaultSettings()
    const storage = new MemorySettingsStorage({
      ...defaults,
      licenseKey: 'legacy-license',
      __version: 1,
    })
    const service = new SettingsService(storage, { isDesktopLike: false })

    const [first, second] = await Promise.all([service.hydrate(), service.hydrate()])

    expect(first).toBe(second)
    expect(storage.read).toHaveBeenCalledOnce()
    expect(first.licenseActivationMethod).toBe('manual')
    expect(storage.write).not.toHaveBeenCalled()

    service.updateSettings({ language: first.language })
    await service.flushPersistence()
    expect(storage.write).toHaveBeenCalledWith(
      expect.objectContaining({
        licenseKey: 'legacy-license',
        __version: SETTINGS_PERSIST_VERSION,
      })
    )
  })

  test('resolves host defaults lazily when a legacy envelope needs migration', async () => {
    const storage = new MemorySettingsStorage({
      ...createDefaultSettings(),
      extension: { documentParser: { type: 'none' } },
      __version: 4,
    })
    let isDesktopLike = true
    const resolveDesktopLike = vi.fn(() => isDesktopLike)
    const service = new SettingsService(storage, { isDesktopLike: resolveDesktopLike })

    expect(resolveDesktopLike).not.toHaveBeenCalled()
    isDesktopLike = false

    const settings = await service.hydrate()

    expect(resolveDesktopLike).toHaveBeenCalledOnce()
    expect(settings.extension.documentParser).toEqual({ type: 'chatbox-ai' })
  })

  test('publishes synchronous updates and restores them through a new service', async () => {
    const storage = new MemorySettingsStorage()
    const service = new SettingsService(storage, { isDesktopLike: true })
    const listener = vi.fn()
    service.subscribe(listener)

    service.updateSettings((current) => ({
      language: 'zh-Hans',
      showWordCount: !current.showWordCount,
      providers: {
        ...current.providers,
        openai: {
          apiKey: 'sk-persisted',
          oauth: { accessToken: 'oauth-persisted' },
        },
      },
    }))

    expect(service.getSettings()).toMatchObject({
      language: 'zh-Hans',
      showWordCount: true,
    })
    expect(listener).toHaveBeenCalledOnce()
    await service.flushPersistence()

    service.dispose()
    const restoredService = new SettingsService(storage, { isDesktopLike: true })
    const restored = await restoredService.hydrate()
    expect(restored.language).toBe('zh-Hans')
    expect(restored.providers?.openai).toMatchObject({
      apiKey: 'sk-persisted',
      oauth: { accessToken: 'oauth-persisted' },
    })
  })

  test('records every effective Global Memory change', () => {
    const service = new SettingsService(new MemorySettingsStorage(), { isDesktopLike: false })

    service.updateSettings({ memoryEnabled: false })
    const disabledToken = service.getSettings().memoryStateToken
    expect(disabledToken).toEqual(expect.any(String))

    service.updateSettings({ memoryEnabled: true })
    const enabledToken = service.getSettings().memoryStateToken
    expect(enabledToken).toEqual(expect.any(String))
    expect(enabledToken).not.toBe(disabledToken)

    service.updateSettings({ memoryEnabled: true })
    expect(service.getSettings().memoryStateToken).toBe(enabledToken)
  })

  test('logs failed writes, exposes the failure to flush and continues the persistence queue', async () => {
    const storage = new MemorySettingsStorage()
    const writeError = new Error('storage unavailable')
    storage.write.mockRejectedValueOnce(writeError)
    const log = vi.fn<LoggerPort['log']>()
    const service = new SettingsService(storage, {
      isDesktopLike: false,
      logger: { log },
    })

    service.updateSettings({ language: 'zh-Hans' })

    await expect(service.flushPersistence()).rejects.toBe(writeError)
    expect(log).toHaveBeenCalledWith('error', 'Failed to persist settings', {
      error: expect.objectContaining({
        name: 'Error',
        message: 'storage unavailable',
      }),
    })

    service.updateSettings({ language: 'ja' })

    await expect(service.flushPersistence()).resolves.toBeUndefined()
    expect(storage.write).toHaveBeenCalledTimes(2)
    expect(storage.value).toEqual(
      expect.objectContaining({
        language: 'ja',
        __version: SETTINGS_PERSIST_VERSION,
      })
    )
  })
})
