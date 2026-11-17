// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DeepSeekImportControls } from './DeepSeekImportControls'

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), import: vi.fn(), navigate: vi.fn(), switchSession: vi.fn() }))
vi.mock('@chatbox/core/importers/deepseek', () => ({ inspectDeepSeekArchive: mocks.inspect }))
vi.mock('@/app/renderer-backup', () => ({
  rendererBackupService: {
    subscribe: () => () => {},
    getSnapshot: () => null,
    importDeepSeek: mocks.import,
  },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/stores/session/crud', () => ({ switchCurrentSession: mocks.switchSession }))
vi.mock('./BackupDialog', () => ({
  BackupDialog: ({ opened, children, footer }: { opened: boolean; children: ReactNode; footer: ReactNode }) =>
    opened ? (
      <div role="dialog">
        {children}
        {footer}
      </div>
    ) : null,
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  })
  mocks.inspect.mockResolvedValue(2)
  mocks.import.mockResolvedValue({
    total: 2,
    processed: 2,
    importedSessions: 1,
    importedMessages: 4,
    skippedSessions: 1,
    importedImages: 0,
    issueCount: 1,
    issues: [{ session: 'Broken chat', code: 'skipped-session' }],
    cancelled: false,
    firstSessionId: 'local-session',
    refreshPending: true,
    cleanupPending: true,
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
async function show() {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } }, interpolation: { escapeValue: false } })
  const view = render(
    <I18nextProvider i18n={i18n}>
      <MantineProvider>
        <DeepSeekImportControls />
      </MantineProvider>
    </I18nextProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Import from DeepSeek' }))
  return view
}
it('previews a ZIP, imports it and displays partial results before opening the imported conversation', async () => {
  const view = await show(),
    file = new File(['zip'], 'deepseek.zip', { type: 'application/zip' })
  const input = view.container.querySelector('input[type="file"]')
  expect(input).not.toBeNull()
  fireEvent.change(input!, { target: { files: [file] } })
  await screen.findByText(/Found 2 conversations/)
  fireEvent.click(screen.getByRole('button', { name: 'Start import' }))
  await screen.findByText('Imported 1 conversations and 4 messages.')
  expect(screen.getByText('Restart Chatbox to refresh the imported data.')).toBeTruthy()
  expect(
    screen.getByText('Some temporary files could not be removed. Chatbox will try again on the next start.')
  ).toBeTruthy()
  expect(mocks.import).toHaveBeenCalledWith(file, 'Reply did not complete.')
  fireEvent.click(screen.getByRole('button', { name: 'Open imported conversation' }))
  expect(mocks.switchSession).toHaveBeenCalledWith('local-session')
  expect(mocks.navigate).not.toHaveBeenCalled()
})
it('passes a pasted signed link unchanged and clears it after starting', async () => {
  await show()
  const url = 'https://example.com/export.zip?Signature=a%2Bb%3D&Expires=123'
  fireEvent.change(screen.getByLabelText('Download link'), { target: { value: ` ${url} ` } })
  fireEvent.click(screen.getByRole('button', { name: 'Download and import' }))
  await waitFor(() => expect(mocks.import).toHaveBeenCalledWith(url, 'Reply did not complete.'))
  await screen.findByText('Skipped 1 conversations.')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }))
  fireEvent.click(screen.getByRole('button', { name: 'Import from DeepSeek' }))
  expect(screen.getByLabelText('Download link')).toHaveProperty('value', '')
})
