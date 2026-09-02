// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test-utils'
import { QuotaExhaustedCard } from './QuotaExhaustedCard'

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
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('QuotaExhaustedCard', () => {
  test('renders a normal status card and dispatches the upgrade action', () => {
    const onUpgrade = vi.fn()
    render(
      <MantineProvider>
        <QuotaExhaustedCard kind="quota-exhausted" action="upgrade-plan" onAction={onUpgrade} />
      </MantineProvider>
    )

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade plan' }))
    expect(onUpgrade).toHaveBeenCalledOnce()
  })

  test('offers an expansion pack after Pro+ quota is exhausted', () => {
    const onAction = vi.fn()
    render(
      <MantineProvider>
        <QuotaExhaustedCard kind="quota-exhausted" action="buy-expansion-pack" onAction={onAction} />
      </MantineProvider>
    )

    expect(
      screen.getByText('Your quota for the current period is used up. Buy an expansion pack to continue.')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Buy expansion pack' }))
    expect(onAction).toHaveBeenCalledOnce()
  })

  test('uses daily-reset copy for Free quota exhaustion', () => {
    render(
      <MantineProvider>
        <QuotaExhaustedCard kind="free-quota-exhausted" action="upgrade-plan" onAction={vi.fn()} />
      </MantineProvider>
    )

    expect(screen.getByText(/Free points reset daily/)).toBeTruthy()
  })

  test('explains Chatbox AI OCR quota exhaustion and opens OCR model settings', () => {
    const onConfigureOcr = vi.fn()
    render(
      <MantineProvider>
        <QuotaExhaustedCard
          kind="ocr-quota-exhausted"
          action="upgrade-plan"
          onAction={vi.fn()}
          onConfigureOcr={onConfigureOcr}
        />
      </MantineProvider>
    )

    expect(screen.getByText(/uses Chatbox AI OCR to process images/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'OCR model settings' }))
    expect(onConfigureOcr).toHaveBeenCalledOnce()
  })

  test('uses daily-reset copy for free Chatbox AI OCR quota exhaustion', () => {
    render(
      <MantineProvider>
        <QuotaExhaustedCard
          kind="free-ocr-quota-exhausted"
          action="upgrade-plan"
          onAction={vi.fn()}
          onConfigureOcr={vi.fn()}
        />
      </MantineProvider>
    )

    expect(screen.getByText(/today's free OCR points are used up/)).toBeTruthy()
    expect(screen.getByText(/Free points reset daily/)).toBeTruthy()
  })
})
