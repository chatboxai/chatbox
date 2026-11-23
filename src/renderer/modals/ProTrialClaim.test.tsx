// @vitest-environment jsdom

import NiceModal from '@ebay/nice-modal-react'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { settingsStore } from '@/stores/settingsStore'
import { act, fireEvent, render, screen, waitFor } from '@/test-utils'

const mocks = vi.hoisted(() => ({ claimProTrial: vi.fn<(licenseKey: string) => Promise<void>>() }))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

vi.mock('@/packages/remote', () => ({
  claimProTrial: mocks.claimProTrial,
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })),
})

import ProTrialClaim from './ProTrialClaim'

const modalId = 'pro-trial-claim-test'
NiceModal.register(modalId, ProTrialClaim)
const initialSettings = settingsStore.getState()

function renderModal() {
  const queryClient = new QueryClient()
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <NiceModal.Provider />
      </MantineProvider>
    </QueryClientProvider>
  )
  act(() => {
    void NiceModal.show(modalId)
  })
  return { invalidateQueries }
}

describe('ProTrialClaim', () => {
  afterEach(() => {
    mocks.claimProTrial.mockReset()
    settingsStore.setState(initialSettings)
    act(() => {
      void NiceModal.remove(modalId)
    })
  })

  test('claims the trial for the active license and refreshes the model catalog', async () => {
    settingsStore.setState({ licenseKey: 'lite-key' })
    mocks.claimProTrial.mockResolvedValue()
    const { invalidateQueries } = renderModal()

    fireEvent.click(await screen.findByRole('button', { name: 'Claim trial and bonus points' }))

    expect(await screen.findByText('Claimed successfully. Go try the advanced models!')).not.toBeNull()
    expect(mocks.claimProTrial).toHaveBeenCalledWith('lite-key')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chatbox-ai-models'] })
  })

  test('starts from the offer again when reopened after a successful claim', async () => {
    settingsStore.setState({ licenseKey: 'lite-key' })
    mocks.claimProTrial.mockResolvedValue()
    renderModal()

    fireEvent.click(await screen.findByRole('button', { name: 'Claim trial and bonus points' }))
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }))
    await waitFor(() => expect(screen.queryByText('Claimed successfully. Go try the advanced models!')).toBeNull())

    act(() => {
      void NiceModal.show(modalId)
    })
    expect(await screen.findByRole('button', { name: 'Claim trial and bonus points' })).not.toBeNull()
  })

  test('keeps the offer open with an error when the claim is rejected', async () => {
    settingsStore.setState({ licenseKey: 'lite-key' })
    mocks.claimProTrial.mockRejectedValue(new Error('bad_params'))
    const { invalidateQueries } = renderModal()

    fireEvent.click(await screen.findByRole('button', { name: 'Claim trial and bonus points' }))

    expect(await screen.findByText('Failed to claim the trial. Please try again later.')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Claim trial and bonus points' })).not.toBeNull()
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled())
  })
})
