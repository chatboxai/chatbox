/** @vitest-environment jsdom */
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { sessionStartupRecovery } from '@/packages/session-startup-recovery'
import { SessionRecoveryDetails } from './SessionRecoveryDetails'
const exportOriginal = vi.hoisted(() => vi.fn())
vi.mock('@/packages/session-startup-recovery/export', () => ({ exportPreMigrationSession: exportOriginal }))
const toast = vi.hoisted(() => vi.fn())
vi.mock('@/stores/toastActions', () => ({ add: toast }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/packages/session-startup-recovery/reporting', () => ({
  getDiagnosticEnvironment: async () => ({ version: '1.24.0', platform: 'desktop/darwin' }),
}))
Object.defineProperty(window, 'matchMedia', {
  value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
})
afterEach(() => {
  cleanup()
  sessionStartupRecovery.clearForTests()
  vi.clearAllMocks()
})
const show = () =>
  render(
    <MantineProvider>
      <SessionRecoveryDetails sessionId="s" />
    </MantineProvider>
  )
it('copies the displayed sanitized diagnostics and confirms success', async () => {
  sessionStartupRecovery.fail('s', new Error('database is locked'))
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  show()
  fireEvent.click(screen.getByText('View error details'))
  await waitFor(() => expect(screen.getByText(/Version: 1.24.0/)).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostic information' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('Copied'))
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Error: database is locked'))
})
it('keeps selectable details and reports clipboard failure without claiming success', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  })
  show()
  fireEvent.click(screen.getByText('View error details'))
  fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostic information' }))
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith('Could not copy diagnostics. Select the details and copy them manually.')
  )
  expect(toast).not.toHaveBeenCalledWith('Copied')
  expect(document.querySelector('pre')?.textContent).toContain('No error details were recorded')
})

it('keeps export busy until the save finishes and reports unavailable source', async () => {
  let finish: (value: string) => void = () => {}
  exportOriginal.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      })
  )
  show()
  fireEvent.click(screen.getByText('View error details'))
  const button = screen.getByRole('button', { name: 'Export pre-migration data' })
  fireEvent.click(button)
  expect(button.getAttribute('data-loading')).not.toBeNull()
  expect(exportOriginal).toHaveBeenCalledWith('s')
  finish('unavailable')
  await waitFor(() => expect(toast).toHaveBeenCalledWith('No pre-migration data is available for this chat.'))
  await waitFor(() => expect(button.getAttribute('data-loading')).toBeNull())
})
it('reports rescue export failure without claiming a successful save', async () => {
  exportOriginal.mockRejectedValue(new Error('read failed'))
  show()
  fireEvent.click(screen.getByText('View error details'))
  fireEvent.click(screen.getByRole('button', { name: 'Export pre-migration data' }))
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith('Could not export pre-migration data. Your chat has not been changed.')
  )
})
