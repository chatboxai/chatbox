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
  it('opens conversation settings from the chat menu', async () => {
    const onClickSessionSettings = vi.fn()
    renderMenu({ onClickSessionSettings })
    fireEvent.click(screen.getByRole('button', { name: 'Conversation Settings' }))
    fireEvent.click(await screen.findByTestId(TestId.chat.sessionSettings))
    expect(onClickSessionSettings).toHaveBeenCalledOnce()
  })
  it('disables new thread while the creation is pending', async () => {
    const onStartNewThread = vi.fn()
    renderMenu({ threadActionPending: true, onStartNewThread })
    fireEvent.click(screen.getByRole('button', { name: 'Conversation Settings' }))
    const button = await screen.findByTestId(TestId.chat.newThread)
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(onStartNewThread).not.toHaveBeenCalled()
  })
  it('offers rollback instead of new thread right after a thread is created', async () => {
    const onRollbackThread = vi.fn()
    renderMenu({ showRollbackThread: true, onRollbackThread })
    fireEvent.click(screen.getByRole('button', { name: 'Conversation Settings' }))
    fireEvent.click(await screen.findByTestId(TestId.chat.rollbackThread))
    expect(onRollbackThread).toHaveBeenCalledOnce()
    expect(screen.queryByTestId(TestId.chat.newThread)).toBeNull()
  })
  it('opens conversation settings directly where threads are unavailable', () => {
    const onClickSessionSettings = vi.fn()
    renderMenu({ canCreateThread: false, onClickSessionSettings })
    fireEvent.click(screen.getByTestId(TestId.chat.sessionSettings))
    expect(onClickSessionSettings).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('composer-settings-menu')).toBeNull()
    expect(screen.queryByTestId(TestId.chat.newThread)).toBeNull()
  })
})
