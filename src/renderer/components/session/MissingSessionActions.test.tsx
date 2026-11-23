// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), confirmArtifacts: vi.fn(), remove: vi.fn(), toast: vi.fn() }))
vi.mock('@ebay/nice-modal-react', () => ({ default: { show: mocks.confirm } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/presentation/session/session-deletion-confirmation', () => ({
  confirmSessionDeletion: mocks.confirmArtifacts,
}))
vi.mock('@/stores/session/crud', () => ({ deleteSession: mocks.remove }))
vi.mock('@/stores/toastActions', () => ({ add: mocks.toast }))

import { MissingSessionActions } from './MissingSessionActions'

describe('missing session actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.confirm.mockResolvedValue(false)
    mocks.confirmArtifacts.mockResolvedValue(true)
    mocks.remove.mockResolvedValue(undefined)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    })
  })
  const renderActions = () => {
    const onBack = vi.fn()
    render(
      <MantineProvider>
        <MissingSessionActions sessionId="missing" onBack={onBack} />
      </MantineProvider>
    )
    return onBack
  }
  test('cancelling confirmation preserves the session', async () => {
    const onBack = renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Current Session' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()
  })
  test('deletes only after confirmation and then returns home', async () => {
    mocks.confirm.mockResolvedValue(true)
    const onBack = renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Current Session' }))
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce())
    expect(mocks.confirmArtifacts).toHaveBeenCalledWith('missing')
    expect(mocks.remove).toHaveBeenCalledWith('missing')
  })
  test('shows a retryable failure when deletion fails', async () => {
    mocks.confirm.mockResolvedValue(true)
    mocks.remove.mockRejectedValue(new Error('storage unavailable'))
    const onBack = renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Current Session' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Failed to delete chat. Please try again.'))
    expect(onBack).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete Current Session' }).hasAttribute('data-loading')).toBe(false)
    )
  })
})
