// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { useGuideSession } from './useGuideSession'

const fixture = vi.hoisted(() => ({
  settings: { language: 'zh-Hans', languageInited: true, licenseKey: '', providers: {} },
  onboarding: { completed: false, markCompleted: vi.fn(), reset: vi.fn() },
  auth: { accessToken: '', refreshToken: '', clearTokens: vi.fn() },
  i18n: { language: 'zh-Hans' },
  t: (key: string) => key,
  navigate: vi.fn(),
  activate: vi.fn(),
  trackClick: vi.fn(),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fixture.t, i18n: fixture.i18n }) }))
vi.mock('@/analytics/jk', () => ({ trackJkClickEvent: fixture.trackClick }))
vi.mock('@/components/Confetti', () => ({ confetti: vi.fn(), cancelConfetti: vi.fn() }))
vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: fixture.navigate }))
vi.mock('@/packages/remote', () => ({ buildChatboxUrl: (path: string) => `https://chatboxai.app${path}` }))
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/stores/authInfoStore', () => ({
  authInfoStore: { getState: () => fixture.auth },
  useAuthInfoStore: (selector: (state: typeof fixture.auth) => unknown) => selector(fixture.auth),
}))
vi.mock('@/stores/onboardingStore', () => ({
  onboardingStore: { getState: () => fixture.onboarding },
  useOnboardingStore: (selector: (state: typeof fixture.onboarding) => unknown) => selector(fixture.onboarding),
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => fixture.settings },
  useSettingsStore: (selector: (state: typeof fixture.settings) => unknown) => selector(fixture.settings),
}))
vi.mock('@/stores/premiumActions', () => ({ activate: fixture.activate }))
vi.mock('../-utils/guideApi', () => ({ sendGuideMessage: vi.fn() }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  fixture.settings.language = 'zh-Hans'
  fixture.i18n.language = 'zh-Hans'
  fixture.settings.licenseKey = ''
  fixture.settings.providers = {}
  fixture.onboarding.completed = false
  fixture.onboarding.markCompleted.mockImplementation(() => {
    fixture.onboarding.completed = true
  })
  fixture.onboarding.reset.mockImplementation(() => {
    fixture.onboarding.completed = false
  })
  fixture.auth.accessToken = ''
  fixture.auth.refreshToken = ''
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function settle(action?: () => void | Promise<void>) {
  await act(async () => {
    const pending = action?.()
    await vi.runAllTimersAsync()
    await pending
  })
}

function toolNames(result: ReturnType<typeof renderGuide>['result']) {
  return result.current.messages.flatMap((message) =>
    message.parts.flatMap((part) => ('toolName' in part ? [part.toolName] : []))
  )
}
function renderGuide() {
  return renderHook(() => useGuideSession())
}

describe('guide import choice', () => {
  it('offers import after existing-plan setup and starts redirect only after declining once', async () => {
    const { result } = renderGuide()
    await settle()
    await settle(() => result.current.selectUserType('novice'))
    expect(toolNames(result)).not.toContain('show_import_conversations')
    fixture.settings.licenseKey = 'test-existing-plan'
    await settle(() => result.current.markGuideCompleted())
    expect(toolNames(result)).toContain('show_import_conversations')
    expect(toolNames(result)).not.toContain('show_auto_new_chat_loading')
    expect(result.current.canSendMessage).toBe(false)
    act(() => {
      result.current.skipImport()
      result.current.skipImport()
    })
    expect(toolNames(result).filter((name) => name === 'show_auto_new_chat_loading')).toHaveLength(1)
    expect(fixture.onboarding.completed).toBe(true)
    expect(
      fixture.trackClick.mock.calls.filter(([event]) => event === JK_EVENTS.ONBOARDING_IMPORT_CHOICE_CLICK)
    ).toEqual([
      [
        JK_EVENTS.ONBOARDING_IMPORT_CHOICE_CLICK,
        { pageName: JK_PAGE_NAMES.HELP_PAGE, content: 'skip', contentType: 'novice' },
      ],
    ])
  })

  it('keeps the free-plan flow before offering import', async () => {
    const { result } = renderGuide()
    await settle()
    await settle(() => result.current.selectUserType('novice'))
    await settle(() => result.current.markGuideCompleted())
    expect(toolNames(result)).toContain('show_free_trial_link')
    expect(toolNames(result)).not.toContain('show_import_conversations')
    await settle(() => result.current.onClaimStart())
    expect(toolNames(result)).toContain('show_claim_waiting')
    await settle(() =>
      result.current.onClaimDetected(
        { key: 'test-new-plan' } as Parameters<typeof result.current.onClaimDetected>[0],
        'qa@example.invalid'
      )
    )
    expect(fixture.activate).toHaveBeenCalled()
    expect(toolNames(result)).toContain('show_import_conversations')
    expect(toolNames(result)).not.toContain('show_auto_new_chat_loading')
  })

  it.each(['novice', 'expert'] as const)(
    'completes %s before opening settings and keeps the completed page on reentry',
    async (type) => {
      const hook = renderGuide()
      await settle()
      await settle(() => hook.result.current.selectUserType(type))
      if (type === 'novice') {
        fixture.settings.licenseKey = 'test-plan'
        await settle(() => hook.result.current.markGuideCompleted())
      }
      fixture.navigate.mockImplementation(() => expect(fixture.onboarding.completed).toBe(true))
      act(() => {
        hook.result.current.importConversations()
        hook.result.current.importConversations()
      })
      expect(fixture.navigate).toHaveBeenCalledWith('/data')
      expect(fixture.navigate).toHaveBeenCalledTimes(1)
      expect(
        fixture.trackClick.mock.calls.filter(([event]) => event === JK_EVENTS.ONBOARDING_IMPORT_CHOICE_CLICK)
      ).toEqual([
        [
          JK_EVENTS.ONBOARDING_IMPORT_CHOICE_CLICK,
          { pageName: JK_PAGE_NAMES.HELP_PAGE, content: 'import', contentType: type },
        ],
      ])
      expect(toolNames(hook.result)).not.toContain('show_import_conversations')
      expect(toolNames(hook.result)).not.toContain('show_auto_new_chat_loading')
      expect(toolNames(hook.result)).toContain('show_suggested_questions')
      hook.unmount()
      const reentered = renderGuide()
      await settle()
      expect(toolNames(reentered.result)).not.toContain('show_import_conversations')
      expect(toolNames(reentered.result)).toContain('show_new_chat_button')
    }
  )

  it('retains API setup alongside import for skip users, without auto redirect', async () => {
    const { result } = renderGuide()
    await settle()
    await settle(() => result.current.selectUserType('expert'))
    const names = toolNames(result)
    expect(names).toEqual(expect.arrayContaining(['show_provider_settings_button', 'show_import_conversations']))
    expect(names.indexOf('show_provider_settings_button')).toBeLessThan(names.indexOf('show_import_conversations'))
    expect(JSON.stringify(result.current.messages)).toContain('You can also import your DeepSeek chats into Chatbox.')
    expect(toolNames(result)).not.toContain('show_auto_new_chat_loading')
    expect(
      result.current.messages
        .flatMap((message) => message.parts)
        .find((part) => 'toolName' in part && part.toolName === 'show_import_conversations')
    ).toMatchObject({ result: { allowSkip: false } })
  })

  it.each(['en', 'zh-Hant'])('preserves automatic completion in %s', async (language) => {
    fixture.settings.language = language
    fixture.i18n.language = language
    const { result } = renderGuide()
    await settle()
    await settle(() => result.current.selectUserType('novice'))
    fixture.settings.licenseKey = 'test-plan'
    await settle(() => result.current.markGuideCompleted())
    expect(toolNames(result)).not.toContain('show_import_conversations')
    expect(toolNames(result)).toContain('show_auto_new_chat_loading')
  })

  it.each(['en', 'zh-Hant'])('keeps skip users unchanged in %s', async (language) => {
    fixture.settings.language = language
    fixture.i18n.language = language
    const { result } = renderGuide()
    await settle()
    await settle(() => result.current.selectUserType('expert'))
    expect(toolNames(result)).not.toContain('show_import_conversations')
    expect(toolNames(result)).toContain('show_provider_settings_button')
  })

  it('does not offer import to an already completed user', async () => {
    fixture.onboarding.completed = true
    const { result } = renderGuide()
    await settle()
    expect(toolNames(result)).not.toContain('show_import_conversations')
    expect(toolNames(result)).toContain('show_suggested_questions')
  })
})
