// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
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

  test('opens the generated summary and dismisses the receipt', () => {
    const onViewSummary = vi.fn()
    render(
      <MantineProvider>
        <CompactionStatus sessionId="session-1" onViewSummary={onViewSummary} />
      </MantineProvider>
    )

    expect(screen.getByText('Earlier messages summarized')).toBeTruthy()
    fireEvent.click(screen.getByText('View'))

    expect(onViewSummary).toHaveBeenCalledWith('summary-1')
    expect(getCompactionUIState('session-1')).toMatchObject({
      status: 'idle',
      summaryMessageId: null,
    })
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
