// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GLASS_SURFACE_CLASS } from '@/lib/glass-surface'
import { FLOATING_BUTTON_GLASS_PROPS, MessageNavigation, ScrollToBottomButton } from './MessageNavigation'

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

afterEach(cleanup)

describe('floating transcript controls over a chat wallpaper', () => {
  test('the navigation rail is a glass surface', () => {
    const view = render(
      <MantineProvider>
        <MessageNavigation visible />
      </MantineProvider>
    )
    expect(view.container.querySelector(`.${GLASS_SURFACE_CLASS}`)).not.toBeNull()
  })

  test('floating buttons are glass surfaces painted from classes, not an inline background', () => {
    render(
      <MantineProvider>
        <ScrollToBottomButton />
      </MantineProvider>
    )
    const button = screen.getByRole('button')
    expect(button.classList).toContain(GLASS_SURFACE_CLASS)
    expect(button.style.background).toBe('')
    expect(FLOATING_BUTTON_GLASS_PROPS.className.split(/\s+/)).toContain(GLASS_SURFACE_CLASS)
  })
})
