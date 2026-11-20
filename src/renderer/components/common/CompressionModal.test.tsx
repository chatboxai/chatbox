// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { getDefaultCompactionPrompt } from '@shared/prompts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requestCompaction, requestTargetedCompaction, addToast, settings } = vi.hoisted(() => ({
  requestCompaction: vi.fn(),
  requestTargetedCompaction: vi.fn(),
  addToast: vi.fn(),
  settings: { language: 'en', compactionPrompt: undefined as string | undefined },
}))
vi.mock('@/packages/context-management/compaction', () => ({
  requestManualCompaction: requestCompaction,
  requestTargetedCompaction,
}))
vi.mock('@/stores/toastActions', () => ({ add: addToast }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: typeof settings) => unknown) => selector(settings),
}))
vi.mock('@/i18n/locales', () => ({ languageNameMap: { en: 'English' } }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('../layout/Overlay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../layout/Overlay')>()),
  Modal: ({ opened, title, children }: { opened: boolean; title?: ReactNode; children: ReactNode }) =>
    opened ? (
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { CompressionModal } from './CompressionModal'

const session = { id: 's1', name: 'Conversation', messages: [] }
function modal(opened: boolean, onClose = vi.fn()) {
  return (
    <MantineProvider>
      <CompressionModal opened={opened} session={session} onClose={onClose} />
    </MantineProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  settings.compactionPrompt = undefined
  requestCompaction.mockResolvedValue('started')
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})
afterEach(cleanup)

describe('CompressionModal', () => {
  it('shows the built-in prompt and combines edits with additional instructions for one run', async () => {
    const close = vi.fn()
    render(modal(true, close))
    expect((screen.getByLabelText('Compaction Prompt') as HTMLTextAreaElement).value).toBe(
      getDefaultCompactionPrompt('English')
    )
    fireEvent.change(screen.getByLabelText('Compaction Prompt'), { target: { value: 'Retain decisions.' } })
    fireEvent.change(screen.getByLabelText('Additional Instructions'), { target: { value: 'Keep exact paths.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(requestCompaction).toHaveBeenCalledWith('s1', {
        force: true,
        prompt: 'Retain decisions.\n\nKeep exact paths.',
      })
    )
    expect(close).toHaveBeenCalledOnce()
    expect(settings.compactionPrompt).toBeUndefined()
    expect(addToast).not.toHaveBeenCalled()
  })

  it('tells the user that a busy session runs the compression later', async () => {
    requestCompaction.mockResolvedValue('queued')
    render(modal(true))

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Compression queued, it runs when the session is idle'))
  })

  it('keeps the prompts on screen when the request is rejected outright', async () => {
    requestCompaction.mockRejectedValue(new Error('session work lock held elsewhere'))
    const close = vi.fn()
    render(modal(true, close))
    fireEvent.change(screen.getByLabelText('Compaction Prompt'), { target: { value: 'Retain decisions.' } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(screen.getByText('Compression could not start')).toBeTruthy())
    expect(close).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Compaction Prompt') as HTMLTextAreaElement).value).toBe('Retain decisions.')
  })

  it.each([
    ['queue-full', 'Message queue is full'],
    ['queue-failed', 'Failed to queue the compression'],
  ] as const)('keeps the prompts on screen when the queue answers %s', async (outcome, message) => {
    requestCompaction.mockResolvedValue(outcome)
    const close = vi.fn()
    render(modal(true, close))
    fireEvent.change(screen.getByLabelText('Compaction Prompt'), { target: { value: 'Retain decisions.' } })
    fireEvent.change(screen.getByLabelText('Additional Instructions'), { target: { value: 'Keep exact paths.' } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(screen.getByText(message)).toBeTruthy())
    expect(close).not.toHaveBeenCalled()
    expect(addToast).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Compaction Prompt') as HTMLTextAreaElement).value).toBe('Retain decisions.')
    expect((screen.getByLabelText('Additional Instructions') as HTMLTextAreaElement).value).toBe('Keep exact paths.')
  })

  it('discards canceled edits and loads the latest saved prompt when reopened', () => {
    settings.compactionPrompt = 'Saved prompt'
    const view = render(modal(true))
    expect((screen.getByLabelText('Compaction Prompt') as HTMLTextAreaElement).value).toBe('Saved prompt')
    fireEvent.change(screen.getByLabelText('Compaction Prompt'), { target: { value: 'Unsaved edit' } })
    fireEvent.change(screen.getByLabelText('Additional Instructions'), { target: { value: 'Unsaved extra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(requestCompaction).not.toHaveBeenCalled()
    view.rerender(modal(false))
    settings.compactionPrompt = 'Updated saved prompt'
    view.rerender(modal(true))
    expect((screen.getByLabelText('Compaction Prompt') as HTMLTextAreaElement).value).toBe('Updated saved prompt')
    expect((screen.getByLabelText('Additional Instructions') as HTMLTextAreaElement).value).toBe('')
  })

  it('blocks an empty prompt and allows resetting to the saved default', () => {
    settings.compactionPrompt = 'Saved prompt'
    render(modal(true))
    fireEvent.change(screen.getByLabelText('Compaction Prompt'), { target: { value: '  ' } })
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect((screen.getByLabelText('Compaction Prompt') as HTMLTextAreaElement).value).toBe('Saved prompt')
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('CompressionModal for a target message', () => {
  function targetModal(onClose = vi.fn(), targetPreview?: string) {
    return (
      <MantineProvider>
        <CompressionModal
          opened
          session={session}
          targetMessageId="a2"
          targetPreview={targetPreview}
          onClose={onClose}
        />
      </MantineProvider>
    )
  }

  it('says the target message itself is summarized along with everything before it', () => {
    render(targetModal())

    expect(screen.getByRole('heading').textContent).toBe('Compact up to here')
    expect(
      screen.getByText(
        'This message (included) and everything before it will be summarized. Later messages stay as they are, and your conversation history remains available.'
      )
    ).toBeTruthy()
  })

  it('previews the target message', () => {
    render(targetModal(vi.fn(), 'Plan the release'))

    expect(screen.getByText('Plan the release')).toBeTruthy()
  })

  it('compresses through the target with the edited prompt and closes once started', async () => {
    requestTargetedCompaction.mockResolvedValue('started')
    const close = vi.fn()
    render(targetModal(close))
    fireEvent.change(screen.getByLabelText('Compaction Prompt'), { target: { value: 'Retain decisions.' } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(requestTargetedCompaction).toHaveBeenCalledWith('s1', 'a2', { prompt: 'Retain decisions.' })
    expect(requestCompaction).not.toHaveBeenCalled()
  })

  it('stays open with the reason when the session is busy', async () => {
    requestTargetedCompaction.mockResolvedValue('busy')
    const close = vi.fn()
    render(targetModal(close))

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(screen.getByText('Compression could not start')).toBeTruthy())
    expect(close).not.toHaveBeenCalled()
  })
})
