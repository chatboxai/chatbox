// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { compactionUIStateMapAtom, getCompactionUIState } from '@/stores/atoms/compactionAtoms'

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/ui/tooltip', () => ({
  AppTooltip: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
    <span aria-label={String(label)}>{children}</span>
  ),
}))
vi.mock('@/hooks/useCopied', () => ({
  useCopied: () => ({ copied: false, copy: vi.fn() }),
}))
vi.mock('@/packages/context-management', () => ({
  requestManualCompaction: vi.fn(),
}))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('../common/ScalableIcon', () => ({ ScalableIcon: () => null }))

import { requestManualCompaction } from '@/packages/context-management'
import { add as addToast } from '@/stores/toastActions'
import { CompactionStatus } from './CompactionStatus'

describe('CompactionStatus completed state', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    getDefaultStore().set(compactionUIStateMapAtom, {
      'session-1': {
        status: 'completed',
        error: null,
        streamingText: '',
        summaryMessageId: 'summary-1',
      },
    })
  })

  test('clears completed progress without rendering a completion notice', () => {
    const { container } = render(
      <MantineProvider>
        <CompactionStatus sessionId="session-1" />
      </MantineProvider>
    )

    expect(container.querySelector('button, p')).toBeNull()
    expect(screen.queryByText('Earlier messages summarized')).toBeNull()
    expect(getCompactionUIState('session-1')).toMatchObject({
      status: 'idle',
      summaryMessageId: null,
    })
  })
})

describe('CompactionStatus running preview', () => {
  const setStreamingText = (streamingText: string) =>
    getDefaultStore().set(compactionUIStateMapAtom, {
      'session-1': { status: 'running', error: null, streamingText, summaryMessageId: null },
    })

  const renderRunning = (streamingText: string) => {
    setStreamingText('')
    render(
      <MantineProvider>
        <CompactionStatus sessionId="session-1" />
      </MantineProvider>
    )
    act(() => setStreamingText(streamingText))
  }
  // The truncating row that holds the preview text.
  const previewRow = (text: string) => screen.getByText(text).closest('.truncate') as HTMLElement

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  test('shows the latest summary line in the same preview row while lines stream', () => {
    renderRunning('Opening line.')
    const row = previewRow('Opening line.')
    for (const [streamingText, latest] of [
      ['Opening line.\n', 'Opening line.'],
      ['Opening line.\nSecond', 'Second'],
      ['Opening line.\nSecond line keeps growing with more detail.', 'Second line keeps growing with more detail.'],
      ['Opening line.\nSecond line keeps growing with more detail.\n\n', 'Second line keeps growing with more detail.'],
      ['Opening line.\nSecond line keeps growing with more detail.\n\nThird', 'Third'],
    ]) {
      act(() => setStreamingText(streamingText))
      expect(previewRow(latest)).toBe(row)
      expect(row.isConnected).toBe(true)
      expect(row.textContent).toBe(latest)
    }
  })

  test('follows the latest summary text horizontally and resets on a short new line', () => {
    renderRunning('Opening line.')
    const row = previewRow('Opening line.')
    let contentWidth = 480
    Object.defineProperties(row, {
      scrollWidth: { configurable: true, get: () => contentWidth },
      clientWidth: { configurable: true, get: () => 160 },
    })

    act(() => setStreamingText('Opening line. More details arrive at the end.'))
    expect(row.scrollLeft).toBe(320)
    expect(row.style.textOverflow).toBe('clip')
    expect(row.className).not.toContain('text-center')
    expect(row.getAttribute('dir')).not.toBe('rtl')

    contentWidth = 160
    act(() => setStreamingText('Opening line. More details arrive at the end.\nNew line.'))
    expect(row.textContent).toBe('New line.')
    expect(row.scrollLeft).toBe(0)
    expect(row.isConnected).toBe(true)
  })
})

describe('CompactionStatus retry', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    getDefaultStore().set(compactionUIStateMapAtom, {
      'session-1': { status: 'failed', error: 'boom', streamingText: '', summaryMessageId: null },
    })
  })

  function retry() {
    render(
      <MantineProvider>
        <CompactionStatus sessionId="session-1" />
      </MantineProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  }

  test('retries as an explicit compression with the failed request prompt', () => {
    getDefaultStore().set(compactionUIStateMapAtom, {
      'session-1': {
        status: 'failed',
        error: 'Network error',
        streamingText: '',
        summaryMessageId: null,
        retryPrompt: 'Keep exact paths.',
      },
    })
    vi.mocked(requestManualCompaction).mockResolvedValue('started')

    retry()

    expect(requestManualCompaction).toHaveBeenCalledWith('session-1', { force: true, prompt: 'Keep exact paths.' })
  })

  test('reports that a retry waits for the session instead of silently doing nothing', async () => {
    vi.mocked(requestManualCompaction).mockResolvedValue('queued')

    retry()

    await vi.waitFor(() =>
      expect(addToast).toHaveBeenCalledWith('Compression queued, it runs when the session is idle')
    )
  })

  test('reports a retry that could not start', async () => {
    vi.mocked(requestManualCompaction).mockRejectedValue(new Error('busy'))

    retry()

    await vi.waitFor(() => expect(addToast).toHaveBeenCalledWith('Compression could not start'))
  })
})
