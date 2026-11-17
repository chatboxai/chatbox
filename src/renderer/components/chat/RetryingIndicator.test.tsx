// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RetryingIndicator } from './RetryingIndicator'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name])),
  }),
}))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('shows the first retry immediately, counts down, then displays requesting', () => {
  vi.useFakeTimers()
  vi.setSystemTime(10000)
  const status = { type: 'retrying' as const, attempt: 2, maxAttempts: 5, statusCode: 429, retryAt: 12000 }
  const view = render(<RetryingIndicator status={status} />)
  expect(screen.getByRole('status').textContent).toBe('Rate limited. Retrying in 2s (1/4)')
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByRole('status').textContent).toBe('Rate limited. Retrying in 1s (1/4)')
  view.rerender(<RetryingIndicator status={{ ...status, retryAt: undefined }} />)
  expect(screen.getByRole('status').textContent).toBe('Retrying request (1/4)')
  expect(vi.getTimerCount()).toBe(0)
})

it('shows server failure and the final retry with no raw error details', () => {
  vi.useFakeTimers()
  vi.setSystemTime(10000)
  const view = render(
    <RetryingIndicator
      status={{
        type: 'retrying',
        attempt: 5,
        maxAttempts: 5,
        statusCode: 503,
        retryAt: 14000,
        error: 'private response',
      }}
    />
  )
  expect(screen.getByRole('status').textContent).toBe('Service unavailable. Retrying in 4s (4/4)')
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('identifies network errors separately from HTTP server errors', () => {
  vi.useFakeTimers()
  vi.setSystemTime(10000)
  render(<RetryingIndicator status={{ type: 'retrying', attempt: 2, maxAttempts: 5, retryAt: 12000 }} />)
  expect(screen.getByRole('status').textContent).toBe('Network error. Retrying in 2s (1/4)')
})
