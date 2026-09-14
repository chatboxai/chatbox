// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConfirmModal from './ConfirmModal'

const modal = vi.hoisted(() => ({ visible: true, resolve: vi.fn(), hide: vi.fn() }))
vi.mock('@ebay/nice-modal-react', () => ({
  default: { create: (component: unknown) => component },
  useModal: () => modal,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (value: string) => value }) }))
vi.mock('@mantine/core', () => ({
  Button: ({ children, onClick }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick}>{children}</button>
  ),
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Checkbox: () => null,
}))
vi.mock('@/components/common/AdaptiveModal', () => {
  const AdaptiveModal = ({ children }: { children: ReactNode }) => <div>{children}</div>
  AdaptiveModal.Actions = ({ children }: { children: ReactNode }) => <div>{children}</div>
  AdaptiveModal.CloseButton = ({ children, onClick }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick}>{children}</button>
  )
  return { AdaptiveModal }
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('confirmation gesture callback', () => {
  it('invokes the browser action synchronously before resolving the modal', () => {
    const order: string[] = []
    modal.resolve.mockImplementation(() => order.push('resolve'))
    render(
      <ConfirmModal id="qa-confirm" title="Photos" message="Choose photos" onConfirm={() => order.push('picker')} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(order).toEqual(['picker', 'resolve'])
    expect(modal.resolve).toHaveBeenCalledWith(true)
  })

  it('keeps cancellation and ordinary confirmation behavior', () => {
    const action = vi.fn()
    render(<ConfirmModal id="qa-confirm" title="Photos" message="Choose photos" onConfirm={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(action).not.toHaveBeenCalled()
    expect(modal.resolve).toHaveBeenCalledWith(false)
  })
})
