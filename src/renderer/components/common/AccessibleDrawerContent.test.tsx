/**
 * @vitest-environment jsdom
 */

import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Drawer } from 'vaul'
import { AccessibleDrawerContent } from './AccessibleDrawerContent'

describe('AccessibleDrawerContent', () => {
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

    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  afterEach(() => {
    consoleErrorSpy.mockClear()
  })

  it('renders drawer content without title or description accessibility warnings', async () => {
    render(
      <Drawer.Root open noBodyStyles>
        <Drawer.Portal>
          <AccessibleDrawerContent
            accessibleTitle="Choose an option"
            accessibleDescription="Review the available drawer actions."
          >
            <div>Drawer body</div>
          </AccessibleDrawerContent>
        </Drawer.Portal>
      </Drawer.Root>
    )

    await waitFor(() => {
      const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n')

      expect(errorOutput).not.toContain('`DialogContent` requires a `DialogTitle`')
      expect(errorOutput).not.toContain('Missing `Description` or `aria-describedby={undefined}` for {DialogContent}')
    })
  })
})
