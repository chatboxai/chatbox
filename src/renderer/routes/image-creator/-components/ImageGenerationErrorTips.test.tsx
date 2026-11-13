// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import type { ImageGeneration } from '@shared/types'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test-utils'
import zhHans from '../../../../../packages/chatbox-i18n/src/locales/zh-Hans/translation.json'
import { ImageGenerationErrorTips } from './ImageGenerationErrorTips'

const mocks = vi.hoisted(() => ({ plan: 'pro', open: vi.fn(), localized: false }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({ licenseDetail: { plan: mocks.plan } }),
}))
vi.mock('@/platform', () => ({ default: { openLink: mocks.open } }))
vi.mock('@/packages/remote', () => ({ buildChatboxUrl: (path: string) => `https://chatboxai.app${path}` }))
vi.mock('@/stores/settingActions', () => ({ getLanguage: () => 'zh-Hans' }))
vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: vi.fn() }))
vi.mock('@/packages/event', () => ({ trackingEvent: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (mocks.localized ? (zhHans[key as keyof typeof zhHans] ?? key) : key),
    i18n: { language: 'zh-Hans' },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
})
vi.mock('@/hooks/useCopied', () => ({ useCopied: () => ({ copied: false, copy: vi.fn() }) }))
vi.mock('@/components/ui/tooltip', () => ({ AppTooltip: ({ children }: { children: ReactNode }) => children }))
const record: ImageGeneration = {
  id: 'image',
  createdAt: 1,
  model: { provider: 'chatbox-ai', modelId: 'image' },
  prompt: 'cat',
  referenceImages: [],
  generatedImages: [],
  status: 'error',
  errorCode: 20049,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.localized = false
})
describe('image points error actions', () => {
  it.each(['lite', 'pro', 'pro_plus'])('renders the specified Chinese quota and points explanation for %s', (plan) => {
    mocks.plan = plan
    mocks.localized = true
    render(
      <MantineProvider>
        <ImageGenerationErrorTips record={record} onRetry={vi.fn()} isRetrying={false} />
      </MantineProvider>
    )
    const expected =
      '本月生图额度已用完，且因点数不足无法消耗计算点数生图。\n' +
      (plan === 'pro_plus' ? '请购买扩展包获得更多点数。' : '请升级套餐或购买扩展包。')
    const description = screen.getByText((_, element) => element?.textContent === expected)
    expect(description.textContent).toBe(expected)
    expect(description.style.whiteSpace).toBe('pre-line')
    expect(screen.getByText('点数不足')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '升级套餐' }) !== null).toBe(plan !== 'pro_plus')
  })
  it.each(['lite', 'pro', 'pro_plus'])('shows the approved actions for %s and links to localized pages', (plan) => {
    mocks.plan = plan
    const retry = vi.fn()
    render(
      <MantineProvider>
        <ImageGenerationErrorTips record={record} onRetry={retry} isRetrying={false} />
      </MantineProvider>
    )
    expect(screen.getByText('Insufficient points')).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(plan === 'pro_plus' ? 2 : 3)
    if (plan !== 'pro_plus') {
      fireEvent.click(screen.getByRole('button', { name: 'Upgrade plan' }))
      expect(mocks.open).toHaveBeenCalledWith('https://chatboxai.app/zh/pricing')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Buy expansion pack' }))
    expect(mocks.open).toHaveBeenCalledWith('https://chatboxai.app/zh/user')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
  })
  it('handles the polling error code and disables a retry already in progress', () => {
    mocks.plan = 'pro_plus'
    const retry = vi.fn()
    render(
      <MantineProvider>
        <ImageGenerationErrorTips
          record={{ ...record, errorCode: 'image_points_insufficient' }}
          onRetry={retry}
          isRetrying
        />
      </MantineProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Your monthly image quota is used up, and you do not have enough compute points to generate images.\nPlease buy an expansion pack for more points.',
        { normalizer: (text) => text }
      )
    ).toBeTruthy()
  })
})
