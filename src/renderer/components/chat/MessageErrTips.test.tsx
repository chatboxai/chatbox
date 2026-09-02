// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { MESSAGE_ERROR_CODES } from '@shared/models/errors'
import type { ChatboxAILicenseDetail, ChatboxAIPlanType, Message, Session } from '@shared/types'
import { afterEach, expect, test, vi } from 'vitest'
import { settingsStore } from '@/stores/settingsStore'
import { fireEvent, render, screen } from '@/test-utils'
import MessageErrTips from './MessageErrTips'

const platformMocks = vi.hoisted(() => ({
  openLink: vi.fn(),
}))
const trackingMocks = vi.hoisted(() => ({
  trackTokenExhaustedCard: vi.fn(),
  useSession: vi.fn<(sessionId: string | null) => { session?: Pick<Session, 'settings'>; isFetched: boolean }>(() => ({
    session: undefined,
    isFetched: false,
  })),
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    isDesktopLike: true,
    openLink: platformMocks.openLink,
  },
}))

vi.mock('@/analytics/token-exhausted-card', () => ({
  trackTokenExhaustedCard: trackingMocks.trackTokenExhaustedCard,
}))

vi.mock('@/app/renderer-application', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/renderer-application')>()
  return {
    rendererApplication: {
      ...actual.rendererApplication,
      sessionHooks: {
        ...actual.rendererApplication.sessionHooks,
        useSession: trackingMocks.useSession,
      },
    },
  }
})

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

const initialSettings = settingsStore.getState()
const proPlusLicenseDetail: ChatboxAILicenseDetail = {
  name: 'Chatbox AI Pro+',
  plan: 'pro_plus',
  remaining_quota_35: 0,
  remaining_quota_4: 0,
  remaining_quota_image: 0,
  image_used_count: 0,
  image_total_quota: 0,
  plan_image_limit: 0,
  token_refreshed_time: '2026-08-12T00:00:00Z',
  remaining_quota_unified: 0,
  expansion_pack_limit: 0,
  expansion_pack_usage: 0,
  unified_token_usage: 0,
  unified_token_limit: 0,
  unified_token_usage_details: [],
  aggregated_reward_details: {
    type: 'reward',
    token_usage: 0,
    token_limit: 0,
    expires_at: null,
  },
}

afterEach(() => {
  platformMocks.openLink.mockReset()
  trackingMocks.trackTokenExhaustedCard.mockReset()
  trackingMocks.useSession.mockReset()
  trackingMocks.useSession.mockReturnValue({ session: undefined, isFetched: false })
  settingsStore.setState(initialSettings)
})

test.each([
  { name: 'paid quota for Pro', errorCode: 10004, plan: 'pro', agentMode: false, action: 'upgrade' },
  { name: 'paid quota for Pro+', errorCode: 10004, plan: 'pro_plus', agentMode: false, action: 'buy_token' },
  { name: 'Free quota', errorCode: 20039, plan: 'free', agentMode: false, action: 'upgrade' },
  {
    name: 'paid OCR quota for Pro',
    errorCode: MESSAGE_ERROR_CODES.CHATBOX_AI_OCR_QUOTA_EXHAUSTED,
    plan: 'pro',
    agentMode: true,
    action: 'upgrade',
  },
  {
    name: 'paid OCR quota for Pro+',
    errorCode: MESSAGE_ERROR_CODES.CHATBOX_AI_OCR_QUOTA_EXHAUSTED,
    plan: 'pro_plus',
    agentMode: true,
    action: 'buy_token',
  },
  {
    name: 'Free OCR quota',
    errorCode: MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_OCR_QUOTA_EXHAUSTED,
    plan: 'free',
    agentMode: true,
    action: 'upgrade',
  },
] as const)('tracks exposure and click for $name', ({ errorCode, plan, agentMode, action }) => {
  settingsStore.setState((state) => ({
    ...state,
    language: 'en',
    licenseKey: `${plan}-license`,
    licenseDetail:
      plan === 'free'
        ? undefined
        : {
            ...proPlusLicenseDetail,
            name: `Chatbox AI ${plan}`,
            plan: plan as ChatboxAIPlanType,
          },
  }))
  trackingMocks.useSession.mockReturnValue({
    session: { settings: { agentMode: { value: agentMode ? 'on' : 'off', locked: false, lockReason: null } } },
    isFetched: true,
  })
  const msg = {
    id: 'assistant-error',
    role: 'assistant',
    contentParts: [],
    error: 'Token Quota Exhausted',
    errorCode,
    aiProvider: 'chatbox-ai',
    model: 'claude-opus-5',
  } as Message
  const expectedContext = {
    sessionId: 'session-123',
    action: action === 'buy_token' ? 'buy-expansion-pack' : 'upgrade-plan',
    plan,
    mode: agentMode ? 'work_mode' : 'chat_mode',
    provider: 'chatbox-ai',
    model: 'claude-opus-5',
  }

  render(
    <MantineProvider>
      <MessageErrTips msg={msg} sessionId="session-123" />
    </MantineProvider>
  )

  expect(trackingMocks.trackTokenExhaustedCard).toHaveBeenCalledOnce()
  expect(trackingMocks.trackTokenExhaustedCard).toHaveBeenCalledWith('exposure', expectedContext)

  fireEvent.click(screen.getByRole('button', { name: action === 'buy_token' ? 'Buy expansion pack' : 'Upgrade plan' }))

  expect(trackingMocks.trackTokenExhaustedCard).toHaveBeenCalledTimes(2)
  expect(trackingMocks.trackTokenExhaustedCard).toHaveBeenLastCalledWith('click', expectedContext)
  expect(platformMocks.openLink).toHaveBeenCalledWith(
    'https://chatboxai.app/redirect_app/view_more_plans/en?utm_source=app&utm_content=msg_quota_exhausted'
  )
})

test('renders file preprocessing errors as generic backend errors instead of OCR quota cards', () => {
  settingsStore.setState((state) => ({ ...state, language: 'en', licenseKey: 'test-license' }))
  const onRetry = vi.fn()
  const msg = {
    id: 'assistant-error',
    role: 'assistant',
    contentParts: [],
    error: 'file failed',
    errorCode: MESSAGE_ERROR_CODES.FILE_PREPROCESS_FAILED,
  } as Message

  render(
    <MantineProvider>
      <MessageErrTips msg={msg} sessionId="session-123" onRetry={onRetry} />
    </MantineProvider>
  )

  expect(screen.getByRole('alert').textContent).toContain(
    'Failed to parse file. Please try again or use a different file format.'
  )
  expect(screen.getByTestId(TestId.message.errorTips)).toBe(screen.getByRole('alert'))
  fireEvent.click(screen.getByTestId(TestId.message.errorRetry))
  expect(onRetry).toHaveBeenCalledOnce()
  expect(screen.queryByRole('status')).toBeNull()
  expect(trackingMocks.trackTokenExhaustedCard).not.toHaveBeenCalled()
})

test('resolves a missing generation mode from the cached session before tracking', () => {
  trackingMocks.useSession.mockReturnValue({
    session: { settings: { agentMode: { value: 'on', locked: false, lockReason: null } } },
    isFetched: true,
  })
  settingsStore.setState((state) => ({
    ...state,
    language: 'en',
    licenseKey: 'pro-license',
    licenseDetail: { ...proPlusLicenseDetail, name: 'Chatbox AI Pro', plan: 'pro' },
  }))
  const msg = {
    id: 'assistant-error',
    role: 'assistant',
    contentParts: [],
    error: 'Token Quota Exhausted',
    errorCode: MESSAGE_ERROR_CODES.CHATBOX_AI_QUOTA_EXHAUSTED,
    aiProvider: 'chatbox-ai',
    model: 'claude-opus-5',
  } as Message

  render(
    <MantineProvider>
      <MessageErrTips msg={msg} sessionId="session-123" />
    </MantineProvider>
  )

  expect(trackingMocks.useSession).toHaveBeenCalledWith('session-123')
  expect(trackingMocks.trackTokenExhaustedCard).toHaveBeenCalledWith('exposure', {
    sessionId: 'session-123',
    mode: 'work_mode',
    provider: 'chatbox-ai',
    model: 'claude-opus-5',
    action: 'upgrade-plan',
    plan: 'pro',
  })
})
