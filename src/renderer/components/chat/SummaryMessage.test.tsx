// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { Message } from '@shared/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { showModalMock, isDismissedMock, dismissMock } = vi.hoisted(() => ({
  showModalMock: vi.fn(),
  isDismissedMock: vi.fn((_action?: string) => false),
  dismissMock: vi.fn((_action?: string) => undefined),
}))

vi.mock('@ebay/nice-modal-react', () => ({ default: { show: showModalMock } }))
vi.mock('@/components/Markdown', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/ui/tooltip', () => ({
  AppTooltip: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
    <span aria-label={String(label)}>{children}</span>
  ),
}))
vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' '),
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, boolean>) => boolean) =>
    selector({ enableMarkdownRendering: false, enableLaTeXRendering: false, enableMermaidRendering: false }),
}))
vi.mock('@/utils/prompt-cache-confirm', () => ({
  isPromptCacheBreakConfirmDismissed: isDismissedMock,
  dismissPromptCacheBreakConfirm: dismissMock,
}))
vi.mock('../common/ScalableIcon', () => ({ ScalableIcon: () => null }))
vi.mock('../layout/Overlay', () => ({
  Modal: ({ opened, children }: { opened: boolean; children: ReactNode }) => (opened ? <div>{children}</div> : null),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import SummaryMessage from './SummaryMessage'

const summary: Message = {
  id: 'summary-1',
  role: 'assistant',
  isSummary: true,
  contentParts: [{ type: 'text', text: 'compacted history' }],
}

function renderSummary(props: Partial<React.ComponentProps<typeof SummaryMessage>> = {}) {
  return render(
    <MantineProvider>
      <SummaryMessage msg={summary} sessionId="session-1" isLatestSummary onDelete={vi.fn()} {...props} />
    </MantineProvider>
  )
}

function expandSummary() {
  fireEvent.click(screen.getByText('Earlier messages summarized'))
}

describe('SummaryMessage mode policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isDismissedMock.mockReturnValue(false)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  test('chat mode keeps the latest-summary edit and delete controls', () => {
    renderSummary()
    expandSummary()

    expect(screen.getByLabelText('Edit')).toBeTruthy()
    expect(screen.getByLabelText('Delete')).toBeTruthy()
  })

  test('work mode keeps the latest-summary edit and delete controls', () => {
    renderSummary({ sessionMode: 'work' })
    expandSummary()

    expect(screen.getByLabelText('Edit')).toBeTruthy()
    const deleteButton = within(screen.getByLabelText('Delete')).getByRole('button')
    expect(deleteButton).toBeTruthy()
    expect(deleteButton.getAttribute('data-color') || deleteButton.getAttribute('style') || '').toMatch(
      /error|red|chatbox-error/
    )
  })

  test('explains the cache miss when deleting a summary in a long work-mode chat', () => {
    renderSummary({ sessionMode: 'work', shouldConfirmPromptCacheDelete: () => true })
    expandSummary()
    fireEvent.click(within(screen.getByLabelText('Delete')).getByRole('button'))

    expect(
      screen.getByText('Deleting this summary will restore original messages to context calculation.')
    ).toBeTruthy()
    expect(
      screen.getByText(
        "It will also invalidate the model's cached context, so the next reply may cost more and take longer."
      )
    ).toBeTruthy()
    expect(screen.getByLabelText("Don't show again")).toBeTruthy()
  })

  test('hides the cache explanation after the user dismissed future prompts', () => {
    isDismissedMock.mockReturnValue(true)
    renderSummary({ sessionMode: 'work', shouldConfirmPromptCacheDelete: () => true })
    expandSummary()
    fireEvent.click(within(screen.getByLabelText('Delete')).getByRole('button'))

    expect(
      screen.getByText('Deleting this summary will restore original messages to context calculation.')
    ).toBeTruthy()
    expect(
      screen.queryByText(
        "It will also invalidate the model's cached context, so the next reply may cost more and take longer."
      )
    ).toBeNull()
    expect(screen.queryByLabelText("Don't show again")).toBeNull()
  })

  test('persists dont-show-again when deleting a cache-sensitive summary', () => {
    renderSummary({ sessionMode: 'work', shouldConfirmPromptCacheDelete: () => true })
    expandSummary()
    fireEvent.click(within(screen.getByLabelText('Delete')).getByRole('button'))
    fireEvent.click(screen.getByLabelText("Don't show again"))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(dismissMock).toHaveBeenCalledWith('delete-summary')
  })

  test('without an onDelete callback only the edit control renders', () => {
    renderSummary({ onDelete: undefined })
    expandSummary()

    expect(screen.getByLabelText('Edit')).toBeTruthy()
    expect(screen.queryByLabelText('Delete')).toBeNull()
  })

  test('reveals the summary when navigation highlights it', () => {
    renderSummary({ highlighted: true })

    expect(screen.getByText('compacted history')).toBeTruthy()
  })
})
