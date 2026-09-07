import type { SettingsRepositoryPort, SettingsUpdate } from '@chatbox/core/ports'
import type { OAuthCredentials } from '@shared/oauth'
import type { Settings } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { RendererOAuthAdapter } from './RendererOAuthAdapter'

function createSettingsRepository(initial: Settings) {
  let settings = initial
  const repository: SettingsRepositoryPort = {
    hydrate: () => Promise.resolve(settings),
    getSettings: () => settings,
    updateSettings(update: SettingsUpdate) {
      const patch = typeof update === 'function' ? update(settings) : update
      settings = { ...settings, ...patch }
    },
    subscribe: () => () => undefined,
  }
  return { repository, getSettings: () => settings }
}

describe('RendererOAuthAdapter', () => {
  it('refreshes credentials through the existing OAuth IPC protocol', async () => {
    const current: OAuthCredentials = { accessToken: 'expired', refreshToken: 'refresh' }
    const refreshed: OAuthCredentials = { accessToken: 'fresh', refreshToken: 'next' }
    const invoke = vi.fn(() => Promise.resolve(JSON.stringify({ success: true, credentials: refreshed })))
    const { repository } = createSettingsRepository({} as Settings)
    const adapter = new RendererOAuthAdapter(repository, () => ({ invoke }))

    await expect(adapter.refreshCredential('openai', current)).resolves.toEqual(refreshed)
    expect(invoke).toHaveBeenCalledWith('oauth:refresh', 'openai', JSON.stringify(current))
  })

  it('persists and clears shared OpenAI OAuth credentials through SettingsRepositoryPort', () => {
    const { repository, getSettings } = createSettingsRepository({
      providers: {
        openai: {
          apiKey: 'manual-key',
        },
      },
    } as unknown as Settings)
    const adapter = new RendererOAuthAdapter(repository, () => ({
      invoke: () => Promise.reject(new Error('not used')),
    }))
    const credentials: OAuthCredentials = { accessToken: 'oauth-token', refreshToken: 'refresh-token' }

    adapter.persistCredential('openai-responses', credentials)
    expect(getSettings().providers?.openai).toEqual({
      apiKey: 'manual-key',
      oauth: credentials,
    })

    adapter.clearCredential('openai-responses')
    expect(getSettings().providers?.openai).toEqual({
      apiKey: 'manual-key',
      oauth: undefined,
    })
  })

  it('surfaces the host refresh error unchanged', async () => {
    const { repository } = createSettingsRepository({} as Settings)
    const adapter = new RendererOAuthAdapter(repository, () => ({
      invoke: () => Promise.resolve(JSON.stringify({ success: false, error: 'refresh rejected' })),
    }))

    await expect(adapter.refreshCredential('qwen-portal', { accessToken: 'expired' })).rejects.toThrow(
      'refresh rejected'
    )
  })
})
