// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import en from '../../../../packages/chatbox-i18n/src/locales/en/translation.json'

const mocks = vi.hoisted(() => ({
  loggedIn: false,
  manualLicense: false,
  navigateToSettings: vi.fn(),
  openLink: vi.fn(),
  openLinkWithAuth: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/stores/authInfoStore', () => ({
  useAuthInfoStore: (selector: (state: { accessToken: string | null; refreshToken: string | null }) => boolean) =>
    selector({
      accessToken: mocks.loggedIn ? 'access' : null,
      refreshToken: mocks.loggedIn ? 'refresh' : null,
    }),
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { licenseActivationMethod?: 'manual' }) => boolean) =>
    selector({ licenseActivationMethod: mocks.manualLicense ? 'manual' : undefined }),
}))
vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: mocks.navigateToSettings }))
vi.mock('@/packages/openLinkWithAuth', () => ({ openLinkWithAuth: mocks.openLinkWithAuth }))
vi.mock('@/platform', () => ({ default: { openLink: mocks.openLink } }))
vi.mock('@/packages/remote', () => ({ buildChatboxUrl: (path: string) => `https://chatboxai.app${path}` }))
vi.mock('@/stores/settingActions', () => ({ getLanguage: () => 'en' }))
vi.mock('@/packages/event', () => ({ trackingEvent: vi.fn() }))
vi.mock('@/components/common/Link', () => ({ default: 'a' }))

import { ChatboxAIErrorMessage } from './ChatboxAIErrorMessage'

const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

beforeEach(() => {
  mocks.loggedIn = false
  mocks.manualLicense = false
  mocks.navigateToSettings.mockClear()
  mocks.openLink.mockClear()
  mocks.openLinkWithAuth.mockClear()
})

function show(errorCode: number) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ChatboxAIErrorMessage errorCode={errorCode} />
    </I18nextProvider>
  )
}

it('opens the upgrade page when the plan does not support the model', () => {
  show(20001)
  fireEvent.click(screen.getByRole('button', { name: 'upgrade' }))
  expect(mocks.openLink).toHaveBeenCalledWith(
    'https://chatboxai.app/redirect_app/view_more_plans/en?utm_source=app&utm_content=msg_upgrade_required'
  )
})

it.each([20003, 20004])('shows the login action for signed-out error %s', (errorCode) => {
  show(errorCode)
  expect(screen.getByText('Please log in')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Chatbox AI Login' }))
  expect(mocks.navigateToSettings).toHaveBeenCalledWith('chatbox-ai?view=login')
})

it.each([20003, 20004])('shows the free-plan action for signed-in error %s', (errorCode) => {
  mocks.loggedIn = true
  show(errorCode)
  expect(screen.getByText('No Chatbox AI Account')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Claim Free Plan' }))
  expect(mocks.openLinkWithAuth).toHaveBeenCalledWith(
    'https://chatboxai.app/redirect_app/claim_free_plan/en/?utm_source=app&utm_content=msg_license_not_found_claim_free'
  )
})

it('opens the Chatbox AI license input for a signed-in manual license error', () => {
  mocks.loggedIn = true
  mocks.manualLicense = true
  show(20004)
  expect(screen.getByText('Chatbox AI license not found')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Re-enter license key' }))
  expect(mocks.navigateToSettings).toHaveBeenCalledWith('chatbox-ai?view=licenseKey')
  expect(mocks.openLinkWithAuth).not.toHaveBeenCalled()
})

it('keeps login guidance for a signed-out manual license error', () => {
  mocks.manualLicense = true
  show(20004)
  fireEvent.click(screen.getByRole('button', { name: 'Chatbox AI Login' }))
  expect(mocks.navigateToSettings).toHaveBeenCalledWith('chatbox-ai?view=login')
})

it('shows the activation step after opening the free plan page', async () => {
  mocks.loggedIn = true
  show(20003)
  fireEvent.click(screen.getByRole('button', { name: 'Claim Free Plan' }))
  await screen.findByRole('button', { name: 'open Chatbox AI settings' })
  fireEvent.click(screen.getByRole('button', { name: 'open Chatbox AI settings' }))
  expect(mocks.navigateToSettings).toHaveBeenCalledWith('chatbox-ai?view=login')
})

it('shows progress and ignores repeated clicks while opening the free plan page', async () => {
  let finishRequest: (() => void) | undefined
  mocks.openLinkWithAuth.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRequest = resolve
      })
  )
  mocks.loggedIn = true
  show(20003)
  const button = screen.getByRole('button', { name: 'Claim Free Plan' })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(mocks.openLinkWithAuth).toHaveBeenCalledTimes(1)
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(screen.getByLabelText('Loading...')).toBeTruthy()
  finishRequest?.()
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
})
