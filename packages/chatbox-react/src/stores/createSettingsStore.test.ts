import {
  createDefaultSettings,
  encodePersistedSettings,
  SETTINGS_PERSIST_VERSION,
  SettingsService,
  type SettingsStoragePort,
} from '@chatbox/core'
import { describe, expect, test } from 'vitest'
import { createSettingsStore } from './createSettingsStore'

class MemorySettingsStorage implements SettingsStoragePort {
  value: unknown = null

  read() {
    return Promise.resolve(this.value)
  }

  write(value: unknown) {
    this.value = value
    return Promise.resolve()
  }

  remove() {
    this.value = null
    return Promise.resolve()
  }
}

class DeferredSettingsStorage extends MemorySettingsStorage {
  private readonly readPromise: Promise<unknown>
  private resolveReadPromise: (value: unknown) => void = () => undefined

  constructor() {
    super()
    this.readPromise = new Promise((resolve) => {
      this.resolveReadPromise = resolve
    })
  }

  override read() {
    return this.readPromise
  }

  onReadResolved(callback: () => void) {
    void this.readPromise.then(callback)
  }

  resolveRead(value: unknown) {
    this.value = value
    this.resolveReadPromise(value)
  }
}

describe('createSettingsStore', () => {
  test('projects hydration and routes compatibility setState through SettingsService', async () => {
    const storage = new MemorySettingsStorage()
    const service = new SettingsService(storage, { isDesktopLike: false })
    const store = createSettingsStore(service)

    await store.getState().hydrate()
    expect(store.getState().hydrationStatus).toBe('hydrated')

    store.setState({ language: 'ja' })
    store.setState((state) => {
      state.showWordCount = true
    })
    store.getState().setSettings((settings) => {
      settings.theme = 1
    })
    await service.flushPersistence()

    expect(service.getSettings()).toMatchObject({
      language: 'ja',
      showWordCount: true,
      theme: 1,
    })
    expect(storage.value).toMatchObject({
      language: 'ja',
      showWordCount: true,
      theme: 1,
      __version: SETTINGS_PERSIST_VERSION,
    })

    store.getState().destroy()
    service.dispose()
  })

  test('removes omitted optional settings while preserving actions and hydration metadata', async () => {
    const storage = new MemorySettingsStorage()
    const service = new SettingsService(storage, {
      isDesktopLike: false,
      initialSettings: {
        ...createDefaultSettings(),
        licenseKey: 'license-to-remove',
        providers: { openai: { apiKey: 'provider-key' } },
      },
    })
    const store = createSettingsStore(service)

    await store.getState().hydrate()
    const actions = {
      destroy: store.getState().destroy,
      getSettings: store.getState().getSettings,
      hydrate: store.getState().hydrate,
      setSettings: store.getState().setSettings,
    }

    service.replaceSettings(createDefaultSettings())

    const state = store.getState()
    expect(Object.hasOwn(state, 'licenseKey')).toBe(false)
    expect(Object.hasOwn(state, 'providers')).toBe(false)
    expect(state.hydrationStatus).toBe('hydrated')
    expect(state.hydrationError).toBeNull()
    expect({
      destroy: state.destroy,
      getSettings: state.getSettings,
      hydrate: state.hydrate,
      setSettings: state.setSettings,
    }).toEqual(actions)

    state.setSettings({ language: 'zh-Hans' })
    expect(store.getState().language).toBe('zh-Hans')
    expect(store.getState().hydrationStatus).toBe('hydrated')

    state.destroy()
    service.dispose()
  })

  test('does not restore stale optional settings when replacement races hydration completion', async () => {
    const storage = new DeferredSettingsStorage()
    const service = new SettingsService(storage, { isDesktopLike: false })
    const store = createSettingsStore(service)
    const replacement = { ...createDefaultSettings(), language: 'zh-Hans' as const }

    const hydration = store.getState().hydrate()
    storage.onReadResolved(() => {
      expect(store.getState().hydrationStatus).toBe('hydrating')
      service.replaceSettings(replacement)
      expect(Object.hasOwn(store.getState(), 'licenseKey')).toBe(false)
    })
    storage.resolveRead(
      encodePersistedSettings({
        ...createDefaultSettings(),
        licenseKey: 'stale-license',
        providers: { openai: { apiKey: 'stale-provider-key' } },
      })
    )

    await expect(hydration).resolves.toEqual(replacement)
    expect(service.getSettings()).toEqual(replacement)
    expect(Object.hasOwn(store.getState(), 'licenseKey')).toBe(false)
    expect(Object.hasOwn(store.getState(), 'providers')).toBe(false)
    expect(store.getState().language).toBe('zh-Hans')
    expect(store.getState().hydrationStatus).toBe('hydrated')
    expect(store.getState().hydrationError).toBeNull()

    await service.flushPersistence()
    store.getState().destroy()
    service.dispose()
  })
})
