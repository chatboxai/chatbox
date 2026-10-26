// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BackupControls } from './BackupControls'

const backup = vi.hoisted(() => ({
  export: vi.fn(),
  import: vi.fn(),
  listSessions: vi.fn(),
  preview: vi.fn(),
  getGeneratingSessionIds: vi.fn(),
  getConversationNames: vi.fn(),
}))
vi.mock('@/app/renderer-backup', () => ({ rendererBackupService: backup }))
vi.mock('@chatbox/core/backup-import', () => ({ inspectBackup: backup.preview }))
vi.mock('./BackupDialog', () => ({
  BackupDialog: ({
    opened,
    children,
    title,
    footer,
  }: {
    opened: boolean
    children: ReactNode
    title: string
    footer?: ReactNode
  }) =>
    opened ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.clearAllMocks()
  backup.getGeneratingSessionIds.mockReturnValue([])
  backup.getConversationNames.mockImplementation(async (ids: string[]) =>
    ids.map((id) => (id === 'b' ? 'Beta' : 'Alpha'))
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  backup.export.mockResolvedValue({ cleanupPending: false, complete: { counts: { warning: 0 } } })
  backup.import.mockResolvedValue({ cleanupPending: false, complete: { counts: { warning: 0 } } })
  backup.listSessions.mockResolvedValue({
    sessions: [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ],
    next: null,
    total: 2,
  })
  backup.preview.mockResolvedValue({
    formatVersion: 3,
    selection: { sessions: true, settings: true, copilots: false, credentials: false },
  })
})

async function show() {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } }, interpolation: { escapeValue: false } })
  render(
    <I18nextProvider i18n={i18n}>
      <MantineProvider>
        <BackupControls />
      </MantineProvider>
    </I18nextProvider>
  )
}

it('keeps all conversations selected across pages and search while excluding individual conversations', async () => {
  backup.listSessions.mockImplementation(async (cursor: number | null, query: string) => {
    const all = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
      { id: 'c', name: 'Gamma' },
    ]
    return {
      sessions: query
        ? all.filter((item) => item.name.includes(query))
        : cursor === null
          ? all.slice(0, 2)
          : all.slice(2),
      next: !query && cursor === null ? 2 : null,
      total: 3,
    }
  })
  await show()
  fireEvent.click(screen.getByRole('button', { name: 'Export Data' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Export Data' }))
  const search = dialog.getByRole('textbox', { name: 'Search conversations' })
  expect((await dialog.findByRole('checkbox', { name: 'Alpha' })).getAttribute('aria-checked')).toBe('true')
  expect(dialog.getByText('3 / 3 conversations selected')).toBeTruthy()
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Beta' }))
  fireEvent.click(dialog.getByRole('button', { name: 'Show more' }))
  expect((await dialog.findByRole('checkbox', { name: 'Gamma' })).getAttribute('aria-checked')).toBe('true')
  fireEvent.change(search, { target: { value: 'Beta' } })
  await waitFor(() => expect(backup.listSessions).toHaveBeenLastCalledWith(null, 'Beta'))
  expect((await dialog.findByRole('checkbox', { name: 'Beta' })).getAttribute('aria-checked')).toBe('false')
  expect(dialog.getByText('2 / 3 conversations selected')).toBeTruthy()
  fireEvent.click(dialog.getByRole('button', { name: 'Export Data' }))
  await waitFor(() =>
    expect(backup.export).toHaveBeenCalledWith(expect.objectContaining({ excludedSessionIds: ['b'] }), 'v3')
  )
  expect(backup.getGeneratingSessionIds).toHaveBeenCalledWith(expect.objectContaining({ excludedSessionIds: ['b'] }))
})

it('disables conversation-only export when every conversation is unchecked and supports restoring all selection', async () => {
  await show()
  fireEvent.click(screen.getByRole('button', { name: 'Export Data' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Export Data' }))
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Settings' }))
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Copilots' }))
  fireEvent.click(await dialog.findByRole('checkbox', { name: 'Alpha' }))
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Beta' }))
  expect((dialog.getByRole('button', { name: 'Export Data' }) as HTMLButtonElement).disabled).toBe(true)
  expect(dialog.getByText('0 / 2 conversations selected')).toBeTruthy()
  fireEvent.click(dialog.getByRole('button', { name: 'Select all conversations' }))
  expect(dialog.getByRole('textbox', { name: 'Search conversations' })).toBeTruthy()
  expect(dialog.getByRole('checkbox', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('true')
  expect(dialog.getByRole('checkbox', { name: 'Beta' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(dialog.getByRole('button', { name: 'Export Data' }))
  await waitFor(() => expect(backup.export).toHaveBeenCalled())
  expect(backup.export.mock.calls[0][0].excludedSessionIds).toBeUndefined()
  expect(backup.export.mock.calls[0][0].sessionIds).toBeUndefined()
})

it.each(['v3', 'v2'] as const)('passes the selected conversations and categories to %s export', async (format) => {
  await show()
  fireEvent.click(screen.getByRole('button', { name: 'Export Data' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Export Data' }))
  expect(dialog.queryByRole('radio')).toBeNull()
  if (format === 'v2') {
    fireEvent.click(dialog.getByRole('button', { name: 'Export for older versions' }))
    expect((dialog.getByRole('radio', { name: 'Current format (V3)' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(dialog.getByRole('radio', { name: 'Older versions (V2)' }))
    expect(dialog.getByText(/Use V2 to import this backup into an older Chatbox version/)).toBeTruthy()
  }
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Settings' }))
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Copilots' }))
  await dialog.findByRole('checkbox', { name: 'Beta' })
  fireEvent.click(dialog.getByRole('button', { name: 'Deselect all conversations' }))
  const choice = await dialog.findByRole('checkbox', { name: 'Beta' })
  fireEvent.click(choice)
  fireEvent.click(dialog.getByRole('button', { name: 'Export Data' }))
  await waitFor(() =>
    expect(backup.export).toHaveBeenCalledWith(
      {
        sessions: true,
        sessionIds: ['b'],
        settings: false,
        copilots: false,
        credentials: false,
      },
      format
    )
  )
})

it('exports only selected conversations in V1 and preserves other format choices', async () => {
  await show()
  fireEvent.click(screen.getByRole('button', { name: 'Export Data' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Export Data' }))
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Conversations' }))
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Include credentials' }))
  fireEvent.click(dialog.getByRole('button', { name: 'Export for older versions' }))
  fireEvent.click(dialog.getByRole('radio', { name: 'Conversations only (V1 JSON)' }))
  const conversations = dialog.getByRole('checkbox', { name: 'Conversations' }) as HTMLInputElement
  expect(conversations.checked).toBe(true)
  expect(conversations.disabled).toBe(true)
  expect(dialog.queryByRole('checkbox', { name: 'Settings' })).toBeNull()
  expect(dialog.queryByRole('checkbox', { name: 'Copilots' })).toBeNull()
  expect(dialog.queryByRole('checkbox', { name: 'Include credentials' })).toBeNull()
  expect(dialog.getByText(/V1 includes conversation text/)).toBeTruthy()
  fireEvent.click(dialog.getByRole('radio', { name: 'Current format (V3)' }))
  expect((dialog.getByRole('checkbox', { name: 'Conversations' }) as HTMLInputElement).checked).toBe(false)
  expect((dialog.getByRole('checkbox', { name: 'Include credentials' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(dialog.getByRole('radio', { name: 'Conversations only (V1 JSON)' }))
  await dialog.findByRole('checkbox', { name: 'Beta' })
  fireEvent.click(dialog.getByRole('button', { name: 'Deselect all conversations' }))
  expect((dialog.getByRole('button', { name: 'Export Data' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(await dialog.findByRole('checkbox', { name: 'Beta' }))
  const legacyOptions = dialog.getByRole('button', { name: 'Export for older versions' })
  fireEvent.click(legacyOptions)
  expect(legacyOptions.getAttribute('aria-expanded')).toBe('false')
  expect(legacyOptions.textContent).toContain('V1')
  expect(dialog.queryByRole('radio')).toBeNull()
  fireEvent.click(dialog.getByRole('button', { name: 'Export Data' }))
  const chosen = { sessions: true, sessionIds: ['b'], settings: false, copilots: false, credentials: false }
  expect(backup.getGeneratingSessionIds).toHaveBeenCalledWith(chosen)
  await waitFor(() => expect(backup.export).toHaveBeenCalledWith(chosen, 'v1'))
})

it.each(['v3', 'v2'] as const)('keeps credentials explicit and coupled to Settings for %s', async (format) => {
  await show()
  fireEvent.click(screen.getByRole('button', { name: 'Export Data' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Export Data' }))
  if (format === 'v2') {
    fireEvent.click(dialog.getByRole('button', { name: 'Export for older versions' }))
    fireEvent.click(dialog.getByRole('radio', { name: 'Older versions (V2)' }))
  }
  const settings = dialog.getByRole('checkbox', { name: 'Settings' }) as HTMLInputElement
  const credentials = dialog.getByRole('checkbox', { name: 'Include credentials' }) as HTMLInputElement
  expect(credentials.checked).toBe(false)
  fireEvent.click(settings)
  fireEvent.click(credentials)
  expect(settings.checked).toBe(true)
  expect(credentials.checked).toBe(true)
  fireEvent.click(settings)
  expect(credentials.checked).toBe(false)
})

it.each([
  ['backup.json', 'application/json', 1],
  ['backup.zip', 'application/zip', 2],
  ['backup.zip', 'application/zip', 3],
])('previews %s (%s, V%s) and requires overwrite confirmation', async (filename, mime, formatVersion) => {
  backup.preview.mockResolvedValue({
    formatVersion,
    selection: { sessions: true, settings: true, copilots: false, credentials: formatVersion !== 3 },
  })
  await show()
  const file = new File(['backup'], filename, { type: mime })
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('Missing backup picker')
  expect(input.getAttribute('accept')).toContain('.json')
  expect(input.getAttribute('accept')).toContain('.zip')
  fireEvent.change(input, { target: { files: [file] } })
  const dialog = within(await screen.findByRole('dialog', { name: 'Import Backup' }))
  expect(backup.preview).toHaveBeenCalledWith(file)
  expect(backup.import).not.toHaveBeenCalled()
  expect(
    dialog.getByText(
      'Settings import also replaces saved credentials, including clearing credentials that are absent from the backup.'
    )
  ).toBeTruthy()
  fireEvent.click(dialog.getByRole('button', { name: 'Import Backup' }))
  await waitFor(() => expect(backup.import).toHaveBeenCalledWith(file))
})

it.each([1, 2])('does not warn about replacing credentials for a V%s memory-only backup', async (formatVersion) => {
  backup.preview.mockResolvedValue({
    formatVersion,
    selection: { sessions: false, settings: true, copilots: false, credentials: false },
  })
  await show()
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('Missing backup picker')
  fireEvent.change(input, { target: { files: [new File(['backup'], 'backup.json')] } })
  const dialog = within(await screen.findByRole('dialog', { name: 'Import Backup' }))
  expect(dialog.queryByText(/Settings import also replaces saved credentials/)).toBeNull()
})

it('shows portability warnings after a successful import', async () => {
  backup.import.mockResolvedValue({ cleanupPending: false, complete: { counts: { warning: 2 } } })
  await show()
  const file = new File(['zip'], 'backup.zip', { type: 'application/zip' })
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('Missing backup picker')
  fireEvent.change(input, { target: { files: [file] } })
  const dialog = within(await screen.findByRole('dialog', { name: 'Import Backup' }))
  fireEvent.click(dialog.getByRole('button', { name: 'Import Backup' }))
  await screen.findByText('2 portability warnings. Local file links and retrieval indexes are not included.')
})

it('reports actual imports separately from skipped records and bounds expandable issue details', async () => {
  backup.import.mockResolvedValue({
    cleanupPending: true,
    complete: { counts: { warning: 3, session: 999, message: 999 } },
    importReport: {
      importedSessions: 2,
      importedResources: 1,
      importedGlobals: 3,
      importedMessages: 7,
      skippedRecords: 4,
      issueCount: 102,
      issues: Array.from({ length: 100 }, (_, index) => ({
        code: 'missing-thread',
        sessionId: 'session-a',
        objectId: `message-${index}`,
        message: 'Missing thread',
      })),
    },
  })
  await show()
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('Missing backup picker')
  fireEvent.change(input, { target: { files: [new File(['zip'], 'edited.zip')] } })
  fireEvent.click(
    within(await screen.findByRole('dialog', { name: 'Import Backup' })).getByRole('button', { name: 'Import Backup' })
  )
  await screen.findByText('Imported 2 conversations and 7 messages.')
  expect(screen.getByText('Skipped 4 records.')).toBeTruthy()
  expect(screen.getByText('102 import issues found.')).toBeTruthy()
  expect(screen.getByText(/Some temporary files could not be removed/)).toBeTruthy()
  expect(
    screen.getByText('3 portability warnings. Local file links and retrieval indexes are not included.')
  ).toBeTruthy()
  expect(screen.queryByText('Object: message-0')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show import details' }))
  expect(screen.getByText('2 additional issues are not shown.')).toBeTruthy()
  expect(screen.getAllByText('A message whose thread is missing was skipped.')).toHaveLength(100)
  expect(screen.getByText('Object: message-99')).toBeTruthy()
  expect(screen.queryByText('Object: message-100')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Hide import details' }))
  expect(screen.queryByText('Object: message-0')).toBeNull()
})

it('checks all generation before opening the import picker and lists names', async () => {
  backup.getGeneratingSessionIds.mockReturnValue(['b'])
  await show()
  fireEvent.click(screen.getByRole('button', { name: 'Import Backup' }))
  const dialog = within(await screen.findByRole('dialog', { name: 'Conversations are still generating.' }))
  await dialog.findByText('Finish or stop generation in these conversations before importing: Beta')
  expect(backup.getGeneratingSessionIds).toHaveBeenCalledWith()
  expect(backup.preview).not.toHaveBeenCalled()
  expect(backup.import).not.toHaveBeenCalled()
})

it('blocks only selected generating conversations when export is confirmed', async () => {
  backup.getGeneratingSessionIds.mockImplementation((selection: { sessionIds?: string[] }) =>
    selection.sessionIds?.includes('b') ? ['b'] : []
  )
  await show()
  fireEvent.click(screen.getByRole('button', { name: 'Export Data' }))
  expect(backup.getGeneratingSessionIds).not.toHaveBeenCalled()
  const dialog = within(screen.getByRole('dialog', { name: 'Export Data' }))
  await dialog.findByRole('checkbox', { name: 'Beta' })
  fireEvent.click(dialog.getByRole('button', { name: 'Deselect all conversations' }))
  fireEvent.click(await dialog.findByRole('checkbox', { name: 'Beta' }))
  fireEvent.click(dialog.getByRole('button', { name: 'Export Data' }))
  await screen.findByText('Finish or stop generation in these conversations before exporting: Beta')
  expect(backup.export).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog', { name: 'Export Data' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'OK' }))
  const resumed = within(screen.getByRole('dialog', { name: 'Export Data' }))
  fireEvent.click(await resumed.findByRole('checkbox', { name: 'Beta' }))
  fireEvent.click(resumed.getByRole('checkbox', { name: 'Alpha' }))
  fireEvent.click(resumed.getByRole('button', { name: 'Export Data' }))
  await waitFor(() => expect(backup.export).toHaveBeenCalledWith(expect.objectContaining({ sessionIds: ['a'] }), 'v3'))
})

it('reports completed changes after a cancelled partial import', async () => {
  const { BackupImportError } = await import('@chatbox/core/backup-v3')
  const partial: import('@chatbox/core/backup-v3').BackupResult = {
    cleanupPending: false,
    manifest: {
      format: 'chatbox-backup',
      formatVersion: 3,
      layout: 'rows',
      archiveId: 'archive',
      createdAt: '',
      producer: 'test',
      selection: { sessions: true, settings: true, copilots: false, credentials: false },
    },
    complete: {
      archiveId: 'archive',
      counts: { resource: 1, global: 2, session: 1, thread: 1, message: 2, warning: 0 },
      resourceBytes: 0,
      dataBytes: 0,
      entryCount: 4,
      uncompressedBytes: 0,
    },
    importReport: {
      importedSessions: 1,
      importedMessages: 2,
      importedResources: 1,
      importedGlobals: 2,
      skippedRecords: 0,
      issueCount: 0,
      issues: [],
    },
  }
  const cancellation = new BackupImportError(new DOMException('Cancelled', 'AbortError'), partial)
  backup.import.mockRejectedValue(cancellation)
  await show()
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('Missing backup picker')
  fireEvent.change(input, { target: { files: [new File(['zip'], 'backup.zip')] } })
  fireEvent.click(
    within(await screen.findByRole('dialog', { name: 'Import Backup' })).getByRole('button', { name: 'Import Backup' })
  )
  await screen.findByText('Import incomplete. Completed changes have been kept.')
  expect(screen.getByText('Imported 1 conversations and 2 messages.')).toBeTruthy()
  expect(screen.getByText('Imported 1 resources and 2 settings records.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByRole('dialog', { name: 'Import Backup' })).toBeNull()
})

it('shows cancellation feedback when import stops before its manifest is read', async () => {
  backup.import.mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
  await show()
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('Missing backup picker')
  fireEvent.change(input, { target: { files: [new File(['zip'], 'backup.zip')] } })
  fireEvent.click(
    within(await screen.findByRole('dialog', { name: 'Import Backup' })).getByRole('button', { name: 'Import Backup' })
  )
  await screen.findByText('Import incomplete. Completed changes have been kept.')
  expect(screen.getByText('Import cancelled.')).toBeTruthy()
})
