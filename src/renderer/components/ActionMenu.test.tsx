// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionMenu } from './ActionMenu'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => true }))

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

// Radix Presence matches the finished animation name with CSS.escape, which jsdom does not provide.
vi.stubGlobal('CSS', { escape: (value: string) => value })

afterEach(cleanup)

describe('mobile action menu', () => {
  it('returns focus to the trigger without scrolling it into view when closed', async () => {
    render(
      <MantineProvider>
        <ActionMenu type="mobile" items={[{ text: 'Copy', onClick: vi.fn() }]}>
          <button type="button">More</button>
        </ActionMenu>
      </MantineProvider>
    )
    const trigger = screen.getByRole('button', { name: 'More' })
    const focus = vi.spyOn(trigger, 'focus')

    fireEvent.click(trigger)
    const content = await screen.findByRole('dialog')
    fireEvent.click(screen.getByText('Copy'))
    await waitFor(() => expect(content.getAttribute('data-state')).toBe('closed'))
    // jsdom never runs the close animation, so finish it for Radix Presence to unmount the drawer.
    fireEvent(content, Object.assign(new Event('animationend'), { animationName: '' }))
    await waitFor(() => expect(content.isConnected).toBe(false))

    expect(focus).toHaveBeenCalled()
    for (const [options] of focus.mock.calls) expect(options).toEqual({ preventScroll: true })
  })
})
