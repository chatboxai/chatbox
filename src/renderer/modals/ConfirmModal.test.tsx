// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConfirmModal from './ConfirmModal'

const modalId = 'qa-confirm'
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
    render(<ConfirmModal id={modalId} title="Photos" message="Choose photos" onConfirm={() => order.push('picker')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(order).toEqual(['picker', 'resolve'])
    expect(modal.resolve).toHaveBeenCalledWith(true)
  })

  it('keeps cancellation and ordinary confirmation behavior', () => {
    const action = vi.fn()
    render(<ConfirmModal id={modalId} title="Photos" message="Choose photos" onConfirm={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(action).not.toHaveBeenCalled()
    expect(modal.resolve).toHaveBeenCalledWith(false)
  })
})

it('dismisses and resolves a cancelled request without running the confirm callback', () => {
  const controller = new AbortController()
  const onConfirm = vi.fn()
  render(
    <ConfirmModal
      id={modalId}
      title="Generate"
      message={
        <>
          Quota <a href="https://chatboxai.app/zh/model-pricing#image-models">Model pricing</a>
        </>
      }
      signal={controller.signal}
      onConfirm={onConfirm}
    />
  )
  controller.abort()
  expect(modal.resolve).toHaveBeenCalledWith(false)
  expect(modal.hide).toHaveBeenCalled()
  expect(onConfirm).not.toHaveBeenCalled()
})
