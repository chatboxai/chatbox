import { describe, expect, test, vi } from 'vitest'

describe('settings runtime bootstrap', () => {
  test('loads through the real platform module graph without reading an uninitialized binding', async () => {
    vi.resetModules()

    const [{ default: platform }, runtime] = await Promise.all([import('@/platform'), import('@/settings-runtime')])

    expect(['test', 'web']).toContain(platform.type)
    expect(runtime.settingsStore.getState().hydrationStatus).toBe('idle')

    runtime.rendererSettingsEffects.stop()
  })
})
