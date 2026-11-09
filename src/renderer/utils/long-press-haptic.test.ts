import { beforeEach, expect, it, vi } from 'vitest'
import { triggerSwipeArmHaptic } from './long-press-haptic'

const mocks = vi.hoisted(() => ({
  impact: vi.fn(() => Promise.resolve()),
}))

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mocks.impact },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM' },
}))
vi.mock('@/platform', () => ({ default: { type: 'mobile' } }))

beforeEach(() => {
  mocks.impact.mockClear()
})

it('plays a medium swipe arm haptic', () => {
  triggerSwipeArmHaptic()
  expect(mocks.impact).toHaveBeenCalledWith({ style: 'MEDIUM' })
})
