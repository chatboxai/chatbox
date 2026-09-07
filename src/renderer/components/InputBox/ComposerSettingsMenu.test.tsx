// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerSettingsMenu } from './ComposerSettingsMenu'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

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

function renderMenu(props: Partial<React.ComponentProps<typeof ComposerSettingsMenu>> = {}) {
  return render(
    <MantineProvider>
      <div style={{ position: 'fixed', bottom: 48, left: 16 }}>
        <ComposerSettingsMenu
          canCreateThread
          toolbarIconSize={22}
          onStartNewThread={vi.fn()}
          onClickSessionSettings={vi.fn()}
          {...props}
        />
      </div>
    </MantineProvider>
  )
}

describe('ComposerSettingsMenu', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('opens upward so the menu stays above the Android navigation bar', async () => {
    renderMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Conversation Settings' }))

    const dropdown = await waitFor(() => {
      const menu = screen.getByTestId('composer-settings-menu')
      expect(menu.getAttribute('data-position')).toBe('top-start')
      return menu
    })

    expect(screen.getByTestId(TestId.chat.newThread)).toBeTruthy()
    expect(screen.getByTestId(TestId.chat.sessionSettings)).toBeTruthy()
    expect(dropdown.getAttribute('data-position')).toBe('top-start')
  })
})
