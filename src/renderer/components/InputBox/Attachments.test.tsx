// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import { FileMiniCard, MessageAttachment } from './Attachments'

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

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('FileMiniCard session attachment failure', () => {
  test('shows the available action for a missing Chatbox AI account license', async () => {
    const onErrorClick = vi.fn()
    render(
      <MantineProvider>
        <FileMiniCard
          name="lecture.pdf"
          fileType="application/pdf"
          status="error"
          errorMessage="chatbox_ai_parser_license_key_required"
          onDelete={vi.fn()}
          onErrorClick={onErrorClick}
        />
      </MantineProvider>
    )

    expect(screen.getByText('Sign in needed')).toBeTruthy()
    fireEvent.pointerMove(screen.getByText('lecture.pdf').parentElement as HTMLElement)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip.textContent).toContain('Sign in to Chatbox AI')
    expect(tooltip.textContent).not.toContain('choose a different document parser')
    fireEvent.click(screen.getByRole('button', { name: 'lecture.pdf: Sign in needed' }))
    expect(onErrorClick).toHaveBeenCalledOnce()
  })

  test('shows an indexing failure and lets the user continue the failed checkpoint', () => {
    const onRecover = vi.fn()
    const onErrorClick = vi.fn()

    render(
      <MantineProvider>
        <FileMiniCard
          name="large.txt"
          fileType="text/plain"
          status="error"
          statusText="Indexing failed · 50/250 chunks"
          errorMessage='API Error: {"error":{"code":"ai_provider_error"}}'
          onDelete={vi.fn()}
          onErrorClick={onErrorClick}
          recoveryAction="continue"
          onRecover={onRecover}
        />
      </MantineProvider>
    )

    expect(screen.getByText('Indexing failed · 50/250 chunks')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByLabelText('Continue').getAttribute('class')).toContain('tabler-icon-player-play')
    expect(onRecover).toHaveBeenCalledOnce()
    expect(onErrorClick).not.toHaveBeenCalled()
  })

  test('uses the retry icon when the failed attachment has no compatible checkpoint', () => {
    const onRecover = vi.fn()

    render(
      <MantineProvider>
        <MessageAttachment
          label="large.txt"
          ragMode="session-retrieval"
          sessionAttachmentIndexStatus="failed"
          recoveryAction="retry"
          onRecover={onRecover}
        />
      </MantineProvider>
    )

    const retryButton = screen.getByRole('button', { name: 'Retry' })
    expect(screen.getByLabelText('Retry').getAttribute('class')).toContain('lucide-rotate-cw')
    fireEvent.click(retryButton)
    expect(onRecover).toHaveBeenCalledOnce()
  })

  test('disables attachment recovery while the action is being queued', () => {
    render(
      <MantineProvider>
        <MessageAttachment
          label="large.txt"
          ragMode="session-retrieval"
          sessionAttachmentIndexStatus="failed"
          recoveryAction="continue"
          onRecover={vi.fn()}
          recovering
        />
      </MantineProvider>
    )

    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true)
  })
})
