import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getLocale: vi.fn(() => 'en-US'),
  },
}))

import { buildTrayMenuTemplate } from './tray-menu'

function build(language?: string, quickToggleAccelerator?: string) {
  const onToggleWindow = vi.fn()
  const onQuit = vi.fn()
  const template = buildTrayMenuTemplate({
    language,
    quickToggleAccelerator,
    onToggleWindow,
    onQuit,
  })
  return { template, onToggleWindow, onQuit }
}

describe('tray menu template', () => {
  it('uses the application language instead of the OS language', () => {
    const { template } = build('fr')

    expect(template).toEqual([
      expect.objectContaining({ label: 'Afficher/Masquer' }),
      expect.objectContaining({ label: 'Quitter' }),
    ])
  })

  it('falls back to English when no language is stored yet', () => {
    const { template } = build(undefined)

    expect(template).toEqual([
      expect.objectContaining({ label: 'Show/Hide' }),
      expect.objectContaining({ label: 'Exit' }),
    ])
  })

  it('accepts a BCP 47 locale as a language', () => {
    const { template } = build('zh-TW')

    expect(template[0]).toMatchObject({ label: '顯示/隱藏' })
  })

  it('keeps the quick toggle accelerator and wires both entries', () => {
    const { template, onToggleWindow, onQuit } = build('en', 'Alt+Space')

    expect(template[0]).toMatchObject({ accelerator: 'Alt+Space' })
    template[0].click?.({} as never, undefined, {} as never)
    template[1].click?.({} as never, undefined, {} as never)

    expect(onToggleWindow).toHaveBeenCalledOnce()
    expect(onQuit).toHaveBeenCalledOnce()
  })

  it('omits the accelerator when the shortcut is not configured', () => {
    const { template } = build('en', '')

    expect(template[0]).not.toHaveProperty('accelerator')
  })
})
