// @vitest-environment jsdom

import NiceModal from '@ebay/nice-modal-react'
import { MantineProvider } from '@mantine/core'
import { type ButtonHTMLAttributes, cloneElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test-utils'

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

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

const { mockNavigateToSettings, mockOpenLink, mockPlatform, mockSettingsState } = vi.hoisted(() => ({
  mockNavigateToSettings: vi.fn(),
  mockOpenLink: vi.fn(),
  mockPlatform: { type: 'desktop', isDesktopLike: true },
  mockSettingsState: { licenseDetail: undefined as { plan: string } | undefined },
}))

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey, components }: { i18nKey: string; components?: Record<string, ReactElement> }) => {
    const openSettingLabel = i18nKey.match(/<OpenSettingButton>(.*?)<\/OpenSettingButton>/)?.[1]
    const documentParserLabel = i18nKey.match(
      /<OpenDocumentParserSettingButton>(.*?)<\/OpenDocumentParserSettingButton>/
    )?.[1]
    return (
      <span>
        {i18nKey}
        {components?.OpenSettingButton && openSettingLabel
          ? cloneElement(components.OpenSettingButton, {}, openSettingLabel)
          : null}
        {components?.OpenDocumentParserSettingButton && documentParserLabel
          ? cloneElement(components.OpenDocumentParserSettingButton, {}, documentParserLabel)
          : null}
      </span>
    )
  },
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

vi.mock('@/components/common/AdaptiveModal', () => {
  const AdaptiveModal = ({ children, title }: { children: ReactNode; title?: ReactNode }) => (
    <div>
      <h2>{title}</h2>
      {children}
    </div>
  )
  AdaptiveModal.Actions = ({ children }: { children: ReactNode }) => <div>{children}</div>
  AdaptiveModal.CloseButton = (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {props.children ?? 'Cancel'}
    </button>
  )
  return { AdaptiveModal }
})

vi.mock('@/modals/settings-navigation', () => ({
  navigateToSettings: mockNavigateToSettings,
}))

vi.mock('@/packages/event', () => ({
  trackingEvent: vi.fn(),
}))

vi.mock('@/packages/remote', () => ({
  buildChatboxUrl: (path: string) => path,
}))

vi.mock('@/platform', () => ({
  default: Object.assign(mockPlatform, {
    openLink: mockOpenLink,
  }),
}))

vi.mock('@/stores/settingActions', () => ({
  getLanguage: () => 'en',
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: <T,>(selector: (state: typeof mockSettingsState) => T) => selector(mockSettingsState),
}))

import FileParseError from './FileParseError'

const modalId = 'file-parse-error-test'
NiceModal.register(modalId, FileParseError)

function showFileParseError(errorCode: string, fileName?: string) {
  render(
    <MantineProvider>
      <NiceModal.Provider />
    </MantineProvider>
  )
  act(() => {
    void NiceModal.show(modalId, { errorCode, fileName })
  })
}

describe('FileParseError', () => {
  beforeEach(() => {
    mockNavigateToSettings.mockReset()
    mockOpenLink.mockReset()
    mockPlatform.type = 'desktop'
    mockPlatform.isDesktopLike = true
    mockSettingsState.licenseDetail = undefined
  })

  test.each([
    ['pro', 'Upgrade plan'],
    ['pro_plus', 'Buy expansion pack'],
  ])('offers the %s plan its purchase option when cloud parsing runs out of points', async (plan, actionLabel) => {
    mockSettingsState.licenseDetail = { plan }
    showFileParseError('token_quota_exhausted', 'lecture.pdf')

    expect(await screen.findByText('Your points are used up')).toBeTruthy()
    fireEvent.click(screen.getByText(actionLabel))

    expect(mockOpenLink).toHaveBeenCalledWith(expect.stringContaining('/redirect_app/view_more_plans/en'))
  })

  test('offers free users an upgrade when the daily free points run out', async () => {
    mockSettingsState.licenseDetail = { plan: 'pro_plus' }
    showFileParseError('free_token_quota_exhausted', 'lecture.pdf')

    expect(await screen.findByText('Upgrade plan')).toBeTruthy()
    expect(screen.queryByText('Buy expansion pack')).toBeNull()
  })

  test('explains an expired plan and links to the plans page', async () => {
    showFileParseError('expired_license', 'lecture.pdf')

    expect(
      await screen.findByText('Your license has expired. Please check your subscription or purchase a new one.')
    ).toBeTruthy()
    fireEvent.click(screen.getByText('View More Plans'))

    expect(mockOpenLink).toHaveBeenCalledWith(expect.stringContaining('/redirect_app/view_more_plans/en'))
  })

  test('lets desktop users switch parsers when Chatbox AI parsing has no account license', async () => {
    showFileParseError('chatbox_ai_parser_license_key_required', 'lecture.pdf')

    expect(await screen.findByText('File: lecture.pdf')).toBeTruthy()
    const openSettings = screen.getByText('Sign in to Chatbox AI')
    const documentParser = screen.getByText('document parser')
    expect(openSettings.tagName).toBe('BUTTON')
    expect(documentParser.tagName).toBe('BUTTON')

    fireEvent.click(openSettings)

    expect(mockNavigateToSettings).toHaveBeenCalledWith('/chatbox-ai')
  })

  test.each(['web', 'mobile'])(
    'only prompts %s users to sign in because no alternative parser is available',
    async (type) => {
      mockPlatform.type = type
      mockPlatform.isDesktopLike = false
      showFileParseError('chatbox_ai_parser_license_key_required', 'lecture.pdf')

      expect(await screen.findByText('File: lecture.pdf')).toBeTruthy()
      expect(screen.getByText('Sign in to Chatbox AI').tagName).toBe('BUTTON')
      expect(screen.queryByText('document parser')).toBeNull()
    }
  )
})
