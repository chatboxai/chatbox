/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SystemAvatar } from './Avatar'

describe('SystemAvatar', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockClear()
  })

  it('does not forward sessionType to the DOM', () => {
    const { container } = render(
      <MantineProvider>
        <SystemAvatar sessionType="chat" />
      </MantineProvider>
    )

    const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
    const avatarRoot = container.firstElementChild

    expect(errorOutput).not.toContain('sessionType')
    expect(avatarRoot?.getAttribute('sessionType')).toBeNull()
    expect(avatarRoot?.getAttribute('sessiontype')).toBeNull()
  })
})
