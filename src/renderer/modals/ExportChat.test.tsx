// @vitest-environment jsdom

import NiceModal from '@ebay/nice-modal-react'
import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { currentSessionIdAtom } from '@/stores/atoms'

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

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

const { mockExportSessionChat } = vi.hoisted(() => ({
  mockExportSessionChat: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

vi.mock('@/stores/session/export', () => ({
  exportSessionChat: mockExportSessionChat,
}))

import ExportChat from './ExportChat'

const modalId = 'export-chat-test'
NiceModal.register(modalId, ExportChat)

function showExportModal() {
  const store = createStore()
  store.set(currentSessionIdAtom, 'session-1')
  render(
    <MantineProvider>
      <Provider store={store}>
        <NiceModal.Provider />
      </Provider>
    </MantineProvider>
  )
  act(() => {
    void NiceModal.show(modalId)
  })
}

describe('ExportChat', () => {
  beforeEach(() => {
    mockExportSessionChat.mockReset()
  })

  test('exports only the current branch by default', async () => {
    showExportModal()

    const checkbox = await screen.findByRole('checkbox', { name: 'Export all branches' })
    expect((checkbox as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    expect(mockExportSessionChat).toHaveBeenCalledWith('session-1', 'all_threads', 'HTML', false)
  })

  test('allows exporting all branches explicitly', async () => {
    showExportModal()

    const checkbox = await screen.findByRole('checkbox', { name: 'Export all branches' })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    expect(mockExportSessionChat).toHaveBeenCalledWith('session-1', 'all_threads', 'HTML', true)
  })
})
