// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { ChatboxAILicenseDetail } from '@shared/types'
import { expect, test, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import { LicenseDetailCard } from './LicenseDetailCard'

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

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-Hans' },
  }),
}))

const licenseDetail: ChatboxAILicenseDetail = {
  name: 'Chatbox AI Pro+',
  plan: 'pro_plus',
  remaining_quota_35: 0.99,
  remaining_quota_4: 0.86,
  remaining_quota_image: 0.98,
  image_used_count: 4,
  image_total_quota: 200,
  plan_image_limit: 200,
  token_refreshed_time: '2026-07-14T14:10:00.001Z',
  token_next_refresh_time: '2026-08-14T14:10:00.001Z',
  token_expire_time: '2028-10-25T12:05:40.5Z',
  remaining_quota_unified: 0.89,
  expansion_pack_limit: 0,
  expansion_pack_usage: 0,
  unified_token_usage: 3_198_035,
  unified_token_limit: 30_000_000,
  unified_token_usage_details: [
    {
      type: 'plan',
      token_usage: 3_198_035,
      token_limit: 30_000_000,
      expires_at: '2028-10-25T12:05:40.5Z',
    },
  ],
  aggregated_reward_details: {
    type: 'reward',
    token_usage: 0,
    token_limit: 0,
    expires_at: null,
  },
}

test('shows the quota reset time precisely to the minute', () => {
  const expectedResetTime = new Date(licenseDetail.token_next_refresh_time as string).toLocaleString('zh-Hans', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  render(
    <MantineProvider>
      <LicenseDetailCard licenseDetail={licenseDetail} language="zh-Hans" utmContent="test" />
    </MantineProvider>
  )

  expect(screen.getByText(`Quota Reset Time ${expectedResetTime}`)).toBeTruthy()
})
