// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { SessionSheet } from './SessionSheet'

const close = vi.hoisted(() => vi.fn())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/session/agent-mode', () => ({ useSessionAgentMode: () => ({ value: 'off' }) }))
vi.mock('./SessionSidePanel', () => ({
  useSessionPanel: (id: string) => ({ open: id === 'pending', tab: 'settings' }),
  closeSessionPanel: close,
  showSessionPanelTab: vi.fn(),
  usePersistedSessionEdit: () => vi.fn(),
}))
vi.mock('./SessionSettingsContent', () => ({ SessionSettingsContent: () => <div>Loaded settings</div> }))
vi.mock('./ThreadHistoryList', () => ({ default: () => null }))
vi.mock('@/components/settings/SettingsLayout', () => ({
  SettingsDensityProvider: ({ children }: { children: React.ReactNode }) => children,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

test('opens a bottom sheet while its session is loading, shows retry on failure and replaces it with settings', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  const onRetry = vi.fn()
  const view = render(
    <MantineProvider>
      <SessionSheet session={undefined} sessionId="pending" onRetry={onRetry} />
    </MantineProvider>
  )
  const sheet = view.getByRole('dialog')
  expect(sheet.classList.contains('fixed')).toBe(true)
  expect(sheet.classList.contains('bottom-0')).toBe(true)
  expect(sheet.contains(view.getByRole('status'))).toBe(true)
  expect(view.getByText('Loading...')).toBeTruthy()
  view.rerender(
    <MantineProvider>
      <SessionSheet session={undefined} sessionId="pending" isError onRetry={onRetry} />
    </MantineProvider>
  )
  expect(sheet.contains(view.getByRole('button', { name: 'Try Again' }))).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Try Again' }))
  expect(onRetry).toHaveBeenCalledOnce()
  view.rerender(
    <MantineProvider>
      <SessionSheet session={{ id: 'pending', name: 'Loaded', messages: [] }} sessionId="pending" />
    </MantineProvider>
  )
  expect(view.getByText('Loaded settings')).toBeTruthy()
  expect(view.queryByRole('status')).toBeNull()
})
