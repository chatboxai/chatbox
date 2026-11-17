// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantAvatar } from './Avatar'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})

const settings: { defaultAssistantAvatarKey?: string; customProviders: { id: string; iconUrl?: string }[] } = {
  customProviders: [],
}

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: typeof settings) => unknown) => selector(settings),
}))
vi.mock('../Image', () => ({
  ImageInStorage: ({ storageKey }: { storageKey: string }) => <img data-storage-key={storageKey} alt="" />,
}))
vi.mock('@/utils/providerIconSrc', () => ({ getProviderIconSrc: (id: string) => `/icons/${id}.png` }))

function renderAvatar(props: Parameters<typeof AssistantAvatar>[0]) {
  return render(
    <MantineProvider>
      <AssistantAvatar size={32} {...props} />
    </MantineProvider>
  ).container
}

describe('AssistantAvatar', () => {
  beforeEach(() => {
    settings.defaultAssistantAvatarKey = undefined
    settings.customProviders = []
  })

  it('shows the round provider icon of the message', () => {
    const img = renderAvatar({ aiProvider: 'claude' }).querySelector('img')
    expect(img?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
  })

  it('outlines a white provider avatar in the light theme', () => {
    const container = renderAvatar({ aiProvider: 'gemini' })
    expect(container.querySelector('span[style*="box-shadow"]')).not.toBeNull()
    expect(renderAvatar({ aiProvider: 'claude' }).querySelector('span[style*="box-shadow"]')).toBeNull()
  })

  it('uses the Chatbox AI logo', () => {
    expect(renderAvatar({ aiProvider: 'chatbox-ai' }).querySelector('img')?.getAttribute('src')).toBe(
      '/icons/chatbox-ai.png'
    )
  })

  it('keeps the default avatar without a known provider icon', () => {
    settings.customProviders = [{ id: 'custom-without-icon' }]
    for (const aiProvider of [undefined, 'custom-without-icon', 'local']) {
      const container = renderAvatar({ aiProvider })
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('svg')).not.toBeNull()
    }
  })

  it('shows a custom provider icon URL', () => {
    settings.customProviders = [{ id: 'custom-with-icon', iconUrl: 'https://example.com/icon.png' }]
    const img = renderAvatar({ aiProvider: 'custom-with-icon' }).querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://example.com/icon.png')
    expect(img?.style.objectFit).toBe('cover')
  })

  it('falls back to the default avatar when a custom provider icon fails to load', () => {
    settings.customProviders = [{ id: 'custom-with-icon', iconUrl: 'https://example.com/broken.png' }]
    const container = renderAvatar({ aiProvider: 'custom-with-icon' })
    const img = container.querySelector('img')
    if (!img) throw new Error('expected the custom provider icon')
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('prefers the global default assistant avatar over the provider icon', () => {
    settings.defaultAssistantAvatarKey = 'global-key'
    const img = renderAvatar({ aiProvider: 'claude' }).querySelector('img')
    expect(img?.dataset.storageKey).toBe('global-key')
  })

  it('prefers the session avatar over everything else', () => {
    settings.defaultAssistantAvatarKey = 'global-key'
    const img = renderAvatar({ aiProvider: 'claude', avatarKey: 'session-key' }).querySelector('img')
    expect(img?.dataset.storageKey).toBe('session-key')
  })
})
