// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { describe, expect, type Mock, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test-utils'
import { AgentModeRewardQuotaCard } from './AgentModeRewardQuotaCard'

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

function renderCard({
  onAction = vi.fn<() => void>(),
  claimFailed = false,
  rewardClaimed = false,
  resumeFailed = false,
}: {
  onAction?: Mock<() => void>
  claimFailed?: boolean
  rewardClaimed?: boolean
  resumeFailed?: boolean
} = {}) {
  render(
    <MantineProvider>
      <AgentModeRewardQuotaCard
        onAction={onAction}
        claimFailed={claimFailed}
        rewardClaimed={rewardClaimed}
        resumeFailed={resumeFailed}
      />
    </MantineProvider>
  )
  return { onAction }
}

describe('AgentModeRewardQuotaCard', () => {
  test('shows one combined claim-and-continue action without a numeric quota amount', () => {
    renderCard()

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Claim reward and continue/ })).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByText(/200,?000|20万/)).toBeNull()
  })

  test('dispatches claim and exposes a retryable failure state', () => {
    const { onAction } = renderCard({ onAction: vi.fn(), claimFailed: true })

    fireEvent.click(screen.getByRole('button', { name: /Claim reward and continue/ }))

    expect(onAction).toHaveBeenCalledOnce()
    expect(screen.getByText(/Could not claim the reward/)).toBeTruthy()
  })

  test('switches to a continue-only action after the reward has been claimed', () => {
    const { onAction } = renderCard({ onAction: vi.fn(), rewardClaimed: true, resumeFailed: true })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onAction).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /Claim reward and continue/ })).toBeNull()
    expect(screen.getByText(/Reward claimed, but the task could not resume/)).toBeTruthy()
  })
})
