// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isSmallScreen: false,
  licenseKey: '',
  navigateToSettings: vi.fn(),
  webSearchProvider: 'build-in' as 'build-in' | 'tavily',
}))

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

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => mocks.isSmallScreen }))
vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: mocks.navigateToSettings }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (
    selector: (state: { extension: { webSearch: { provider: 'build-in' | 'tavily' } }; licenseKey: string }) => unknown
  ) =>
    selector({
      extension: { webSearch: { provider: mocks.webSearchProvider } },
      licenseKey: mocks.licenseKey,
    }),
}))

import { WebSearchUnavailableBanner } from './WebSearchUnavailableBanner'

describe('WebSearchUnavailableBanner', () => {
  beforeEach(() => {
    mocks.isSmallScreen = false
    mocks.licenseKey = ''
    mocks.webSearchProvider = 'build-in'
    mocks.navigateToSettings.mockClear()
  })
  const banner = (sessionId: string, errorCount: number, latestHasError: boolean | undefined) => (
    <MantineProvider>
      <WebSearchUnavailableBanner sessionId={sessionId} errorCount={errorCount} latestHasError={latestHasError} />
    </MantineProvider>
  )
  it('waits for a later conversation message after the most recent sign-in error', () => {
    const view = render(banner('sequence', 1, true))
    expect(screen.queryByRole('status')).toBeNull()
    view.rerender(banner('sequence', 1, false))
    expect(screen.getByRole('status')).toBeTruthy()
    view.rerender(banner('sequence', 2, true))
    expect(screen.queryByRole('status')).toBeNull()
    view.rerender(banner('sequence', 2, false))
    expect(screen.getByRole('status')).toBeTruthy()
  })
  it.each([
    [0, false],
    [1, undefined],
    [1, true],
  ] as const)('hides for count %s and latest state %s', (count, latest) => {
    render(banner(`hidden-${count}-${latest}`, count, latest))
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('opens sign-in and provider settings on desktop', () => {
    render(banner('desktop-actions', 1, false))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Chatbox AI' }))
    expect(mocks.navigateToSettings).toHaveBeenCalledWith()
    fireEvent.click(screen.getByRole('button', { name: 'Web Search settings' }))
    expect(mocks.navigateToSettings).toHaveBeenCalledWith('/web-search')
  })
  it('offers the compact sign-in action on narrow screens', () => {
    mocks.isSmallScreen = true
    render(banner('narrow-actions', 1, false))
    expect(screen.getByText('Web Search was skipped: sign in to Chatbox AI')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(mocks.navigateToSettings).toHaveBeenCalledWith()
    expect(screen.queryByRole('button', { name: 'Web Search settings' })).toBeNull()
  })
  it('keeps dismissal scoped to a conversation', () => {
    const view = render(banner('dismissed', 1, false))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('status')).toBeNull()
    view.rerender(banner('another-conversation', 1, false))
    expect(screen.getByRole('status')).toBeTruthy()
    view.rerender(banner('dismissed', 2, false))
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('hides once the user signs in', () => {
    mocks.licenseKey = 'licensed'
    render(banner('licensed', 1, false))
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('hides when the user selects another provider', () => {
    mocks.webSearchProvider = 'tavily'
    render(banner('different-provider', 1, false))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
