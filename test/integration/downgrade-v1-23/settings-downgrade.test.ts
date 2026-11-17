import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SettingsService } from '@chatbox/core/application/settings'
import { describe, expect, it } from 'vitest'
import { importReleased, RELEASED_TAG, releasedCommit } from './released-source'

type ReleasedSettingsModule = typeof import('../../../packages/chatbox-core/src/application/settings/SettingsService')
type ReleasedDefaultsModule = typeof import('../../../packages/chatbox-core/src/domain/settings/settings-defaults')

function memoryStorage(initial: unknown) {
  let value = structuredClone(initial)
  return {
    read: async () => structuredClone(value),
    write: async (next: unknown) => {
      value = structuredClone(next)
    },
    remove: async () => {
      value = undefined
    },
    current: () => value,
  }
}

function configVersion(source: string): string | undefined {
  return /export const CurrentVersion = (\d+)/.exec(source)?.[1]
}

describe.skipIf(!releasedCommit)(`settings written by this version stay readable by ${RELEASED_TAG}`, () => {
  it.each([true, false])(
    'round-trips released user settings through this version (desktop: %s)',
    async (isDesktopLike) => {
      const released = await importReleased<ReleasedSettingsModule>(
        'packages/chatbox-core/src/application/settings/SettingsService.ts'
      )
      const releasedDefaults = await importReleased<ReleasedDefaultsModule>(
        'packages/chatbox-core/src/domain/settings/settings-defaults.ts'
      )
      const storage = memoryStorage(undefined)

      const before = new released.SettingsService(storage, { isDesktopLike })
      await before.hydrate()
      before.updateSettings({
        ...releasedDefaults.createDefaultSettings(),
        language: 'zh-Hans',
        licenseKey: 'license-key',
        providers: { openai: { apiKey: 'sk-openai' } },
        customProviders: [{ id: 'custom', name: 'Custom', type: 'openai', isCustom: true }],
        defaultChatModel: { provider: 'openai', model: 'gpt-4o' },
      } as Parameters<typeof before.updateSettings>[0])
      await before.flushPersistence()

      const upgraded = new SettingsService(storage, { isDesktopLike })
      await upgraded.hydrate()
      upgraded.updateSettings({ fontSize: 15 })
      await upgraded.flushPersistence()
      expect((storage.current() as { __version: number }).__version).toBeGreaterThan(6)

      const downgraded = new released.SettingsService(storage, { isDesktopLike })
      const settings = await downgraded.hydrate()
      expect(settings).toMatchObject({
        language: 'zh-Hans',
        licenseKey: 'license-key',
        fontSize: 15,
        providers: { openai: { apiKey: 'sk-openai' } },
        customProviders: [{ id: 'custom', name: 'Custom' }],
        defaultChatModel: { provider: 'openai', model: 'gpt-4o' },
      })
    }
  )

  it('parses the defaults this version writes for a fresh profile', async () => {
    const released = await importReleased<ReleasedSettingsModule>(
      'packages/chatbox-core/src/application/settings/SettingsService.ts'
    )
    const storage = memoryStorage(undefined)
    const current = new SettingsService(storage, { isDesktopLike: true })
    await current.hydrate()
    current.updateSettings({ fontSize: 14 })
    await current.flushPersistence()
    await expect(new released.SettingsService(storage, { isDesktopLike: true }).hydrate()).resolves.toMatchObject({
      fontSize: 14,
    })
  })

  it('keeps the key-value config migration version', () => {
    const repoRoot = path.resolve(__dirname, '../../..')
    const current = readFileSync(path.join(repoRoot, 'src/renderer/stores/migration.ts'), 'utf8')
    const released = execFileSync('git', ['show', `${releasedCommit}:src/renderer/stores/migration.ts`], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    expect(configVersion(current)).toBeDefined()
    expect(configVersion(current)).toBe(configVersion(released))
  })
})
