import { describe, expect, it } from 'vitest'
import { getProviderAvatarIcon, getProviderAvatarOutline, resolveAssistantAvatar } from './assistant-avatar'
import { PROVIDER_AVATAR_ICON_NAMES, PROVIDER_AVATAR_ICONS } from './provider-avatars.generated'

describe('resolveAssistantAvatar', () => {
  const customProviders = [
    { id: 'custom-with-icon', iconUrl: 'https://example.com/icon.png' },
    { id: 'custom-without-icon' },
  ]

  it('shows the round icon of a built-in provider', () => {
    expect(resolveAssistantAvatar({ aiProvider: 'claude' })).toEqual({
      type: 'provider',
      icon: PROVIDER_AVATAR_ICONS.Claude,
    })
  })

  it('shares one icon between regional provider variants', () => {
    expect(getProviderAvatarIcon('minimax-cn')).toBe(getProviderAvatarIcon('minimax'))
    expect(getProviderAvatarIcon('openai-responses')).toBe(getProviderAvatarIcon('openai'))
  })

  it('uses the Chatbox AI logo for Chatbox AI', () => {
    expect(resolveAssistantAvatar({ aiProvider: 'chatbox-ai' })).toEqual({ type: 'chatbox-ai' })
  })

  it('crops a custom provider icon URL round and otherwise falls back to the default avatar', () => {
    expect(resolveAssistantAvatar({ aiProvider: 'custom-with-icon', customProviders })).toEqual({
      type: 'image',
      url: 'https://example.com/icon.png',
    })
    expect(resolveAssistantAvatar({ aiProvider: 'custom-without-icon', customProviders })).toEqual({ type: 'default' })
  })

  it.each([undefined, 'local', 'unknown-provider'])('uses the default avatar for provider %s', (aiProvider) => {
    expect(resolveAssistantAvatar({ aiProvider, customProviders })).toEqual({ type: 'default' })
  })

  it('prefers the session avatar, then the session picture, then the global default avatar', () => {
    const base = { aiProvider: 'claude', defaultAssistantAvatarKey: 'global-key' }
    expect(resolveAssistantAvatar({ ...base, assistantAvatarKey: 'session-key', picUrl: 'https://pic' })).toEqual({
      type: 'storage',
      key: 'session-key',
    })
    expect(resolveAssistantAvatar({ ...base, picUrl: 'https://pic' })).toEqual({ type: 'image', url: 'https://pic' })
    expect(resolveAssistantAvatar(base)).toEqual({ type: 'storage', key: 'global-key' })
  })
})

describe('provider avatar table', () => {
  it('has a complete round avatar for every mapped provider', () => {
    for (const iconName of Object.values(PROVIDER_AVATAR_ICON_NAMES)) {
      const icon = PROVIDER_AVATAR_ICONS[iconName]
      expect(icon, iconName).toBeDefined()
      expect(icon.svg).toMatch(/^<svg [^>]*viewBox="0 0 24 24".*<circle cx="12" cy="12" r="12"/)
      expect(icon.svg).not.toContain('currentColor')
      expect(icon.scale).toBeGreaterThan(0)
      expect(icon.scale).toBeLessThanOrEqual(1)
    }
  })
})

describe('getProviderAvatarOutline', () => {
  it('outlines near-white avatars only in the light theme', () => {
    expect(getProviderAvatarOutline('#fff', 'light')).toBe('rgba(0,0,0,0.05)')
    expect(getProviderAvatarOutline('#F2F8FE', 'light')).toBe('rgba(0,0,0,0.05)')
    expect(getProviderAvatarOutline('#fff', 'dark')).toBeUndefined()
  })

  it('outlines near-black avatars only in the dark theme', () => {
    expect(getProviderAvatarOutline('#000', 'dark')).toBe('rgba(255,255,255,0.1)')
    expect(getProviderAvatarOutline('#16191E', 'dark')).toBe('rgba(255,255,255,0.1)')
    expect(getProviderAvatarOutline('#000', 'light')).toBeUndefined()
  })

  it('leaves colored and gradient avatars without an outline', () => {
    expect(getProviderAvatarOutline('#D97757', 'light')).toBeUndefined()
    expect(getProviderAvatarOutline('#D97757', 'dark')).toBeUndefined()
    expect(getProviderAvatarOutline('linear-gradient(135deg, #6C78EF, #4F14BE)', 'dark')).toBeUndefined()
  })
})
