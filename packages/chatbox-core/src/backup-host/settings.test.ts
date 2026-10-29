import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsService } from '../application/settings/SettingsService'
import { createDefaultSettings, encodePersistedSettings, SETTINGS_PERSIST_VERSION } from '../domain/settings'
import { commitBackupSettings } from './settings'

afterEach(() => vi.useRealTimers())

function setup() {
  let value: unknown = encodePersistedSettings(createDefaultSettings())
  let pending: ReturnType<typeof setTimeout> | undefined
  const settings = new SettingsService(
    {
      read: async () => value,
      write: async (next) => {
        clearTimeout(pending)
        pending = setTimeout(() => {
          value = next
        }, 500)
      },
      remove: async () => {
        value = null
      },
    },
    { isDesktopLike: true }
  )
  return {
    settings,
    read: () => value,
    write: async (next: unknown) => {
      value = next
    },
    isDesktopLike: true,
  }
}

const imported = {
  language: 'zh-Hans',
  providers: { openai: { apiKey: 'fixture-key', models: [{ modelId: 'fixture-model' }] } },
  memoryStateToken: 'imported-memory-state',
  __version: SETTINGS_PERSIST_VERSION,
}

describe('backup settings commit', () => {
  it('keeps imported providers when a startup update runs while conversations are still importing', async () => {
    vi.useFakeTimers()
    const host = setup()
    await host.settings.hydrate()
    setTimeout(() => host.settings.updateSettings({ languageInited: true }), 2000)

    await commitBackupSettings(imported, host)
    expect(host.settings.getSettings()).toMatchObject({ providers: imported.providers })
    expect(host.read()).toMatchObject(imported)

    // Conversation processing can continue after this global item has committed.
    await vi.advanceTimersByTimeAsync(2500)
    await host.settings.flushPersistence()
    expect(host.read()).toMatchObject({ ...imported, languageInited: true })
    expect(host.settings.getSettings()).toMatchObject({ providers: imported.providers, languageInited: true })
  })

  it('publishes the snapshot after direct persistence completes', async () => {
    vi.useFakeTimers()
    const host = setup()
    let resolve: (() => void) | undefined
    const write = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done
        })
    )
    let finished = false
    const task = commitBackupSettings(imported, { ...host, write }).then(() => {
      finished = true
    })
    const previous = host.settings.getSettings()
    await vi.advanceTimersByTimeAsync(500)
    expect(finished).toBe(false)
    expect(host.settings.getSettings()).toBe(previous)
    expect(write).toHaveBeenCalledWith(expect.objectContaining(imported))
    resolve?.()
    await task
    expect(finished).toBe(true)
    expect(host.settings.getSettings().providers).toEqual(imported.providers)
  })

  it('keeps the snapshot and normal persistence untouched when the direct write fails', async () => {
    vi.useFakeTimers()
    const host = setup(),
      previous = host.settings.getSettings(),
      stored = host.read()
    await expect(
      commitBackupSettings(imported, {
        ...host,
        write: async () => {
          throw new Error('Storage unavailable')
        },
      })
    ).rejects.toThrow('Storage unavailable')
    await host.settings.flushPersistence()
    await vi.advanceTimersByTimeAsync(500)
    expect(host.settings.getSettings()).toBe(previous)
    expect(host.read()).toBe(stored)
  })

  it('applies settings migrations and mobile defaults before publishing', async () => {
    vi.useFakeTimers()
    const host = setup()
    await commitBackupSettings(
      { ...imported, __version: 0, licenseKey: 'fixture-license', extension: { documentParser: { type: 'none' } } },
      { ...host, isDesktopLike: false }
    )
    expect(host.settings.getSettings()).toMatchObject({
      licenseActivationMethod: 'manual',
      memorizedManualLicenseKey: 'fixture-license',
      extension: { documentParser: { type: 'chatbox-ai' } },
    })
    expect(host.read()).toMatchObject({ __version: SETTINGS_PERSIST_VERSION, providers: imported.providers })
  })

  it('rejects invalid input before changing the active snapshot', async () => {
    vi.useFakeTimers()
    const host = setup(),
      write = vi.fn(host.write),
      before = host.settings.getSettings()
    await expect(commitBackupSettings(null, { ...host, write })).rejects.toThrow('Invalid backup settings')
    expect(write).not.toHaveBeenCalled()
    expect(host.settings.getSettings()).toBe(before)
  })
})
