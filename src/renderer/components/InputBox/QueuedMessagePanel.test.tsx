// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { Message } from '@shared/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getDefaultStore } from 'jotai'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { submissionQueueStateMapAtom } from '@/stores/atoms/submissionQueueAtoms'
import QueuedMessagePanel, { type QueuedMessagePanelProps } from './QueuedMessagePanel'

const controller = vi.hoisted(() => ({
  removeQueuedSubmission: vi.fn(),
  resumeSubmissionQueue: vi.fn(),
  updateQueuedSubmission: vi.fn(),
}))

vi.mock('@/stores/session/submission-queue', () => controller)
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => (key === '{{count}} queued' ? `${values?.count} queued` : key),
  }),
}))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('@/stores/uiStore', () => ({ useUIStore: () => false }))

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

const message: Message = {
  id: 'message-1',
  role: 'user',
  contentParts: [{ type: 'text', text: 'first queued message' }],
  files: [{ id: 'file:1', name: 'notes.txt', fileType: 'text/plain', storageKey: 'file:1' }],
}

function setQueue(
  queue: Partial<{
    status: 'idle' | 'draining' | 'paused'
    pauseReason: 'generation-error' | 'tool-pause'
    error: string
  }> & {
    state?: 'pending' | 'dispatching'
  } = {}
) {
  getDefaultStore().set(submissionQueueStateMapAtom, {
    'session-1': {
      items: [
        {
          id: 'queued-1',
          sessionId: 'session-1',
          message,
          needGenerating: true,
          createdAt: 1,
          state: queue.state ?? 'pending',
        },
      ],
      status: queue.status ?? 'idle',
      ...(queue.pauseReason ? { pauseReason: queue.pauseReason } : {}),
      ...(queue.error ? { error: queue.error } : {}),
    },
  })
}

function renderPanel(generating = false) {
  const props = { sessionId: 'session-1', generating } as QueuedMessagePanelProps
  render(
    <MantineProvider>
      <QueuedMessagePanel {...props} />
    </MantineProvider>
  )
}

afterEach(() => {
  getDefaultStore().set(submissionQueueStateMapAtom, {})
  vi.clearAllMocks()
})

describe('QueuedMessagePanel', () => {
  test('shows pending queue metadata and actions', () => {
    setQueue()
    renderPanel(true)

    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('first queued message')).toBeTruthy()
    expect(screen.getByText('1 file')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit queued message' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: 'Delete queued message' })).toHaveProperty('disabled', false)
  })

  test('does not show a queue card for the only message being dispatched', () => {
    setQueue({ state: 'dispatching' })
    renderPanel()

    expect(screen.queryByText('Sending')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit queued message' })).toBeNull()
  })

  test('does not show a queue card while the first message waits for dispatch', () => {
    setQueue()
    renderPanel()

    expect(screen.queryByText('first queued message')).toBeNull()
  })

  test('continues a generation-error-paused queue', async () => {
    const user = userEvent.setup()
    const rawProviderError = '{"error":{"code":"license_key_required","request_id":"req-123"}}'
    setQueue({ status: 'paused', pauseReason: 'generation-error', error: rawProviderError })
    renderPanel()

    expect(screen.getByText('Generation failed')).toBeTruthy()
    expect(screen.getByText('Queue paused')).toBeTruthy()
    expect(screen.getByText('Resolve the error, then continue sending.')).toBeTruthy()
    expect(screen.getByText('1 queued')).toBeTruthy()
    expect(screen.queryByText(rawProviderError)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Continue sending' }))

    expect(controller.resumeSubmissionQueue).toHaveBeenCalledWith('session-1')
  })

  test('keeps the full continue-sending action visible beside an unbreakable error', () => {
    setQueue({ status: 'paused', pauseReason: 'generation-error', error: 'x'.repeat(2_000) })
    renderPanel()

    expect(screen.getByRole('button', { name: 'Continue sending' }).className).toContain('shrink-0')
  })

  test('hides a stale paused state when no messages remain in the queue', () => {
    getDefaultStore().set(submissionQueueStateMapAtom, {
      'session-1': {
        items: [],
        status: 'paused',
        pauseReason: 'generation-error',
        error: 'provider failed',
      },
    })
    renderPanel()

    expect(screen.queryByText('Queued messages paused')).toBeNull()
  })

  test('deletes a pending queued message', async () => {
    const user = userEvent.setup()
    setQueue()
    renderPanel(true)

    await user.click(screen.getByRole('button', { name: 'Delete queued message' }))

    expect(controller.removeQueuedSubmission).toHaveBeenCalledWith('session-1', 'queued-1')
  })
})
