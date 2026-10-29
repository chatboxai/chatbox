// @vitest-environment jsdom

import type { SessionHeader } from '@chatbox/core/ports'
import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { ChatboxAIAPIError, MESSAGE_ERROR_CODES } from '@shared/models/errors'
import type { ChatboxAILicenseDetail, ChatboxAIPlanType, Message } from '@shared/types'
import { afterEach, expect, test, vi } from 'vitest'
import { settingsStore } from '@/stores/settingsStore'
import { fireEvent, render, screen, waitFor } from '@/test-utils'
import MessageErrTips from './MessageErrTips'

const translationMocks = vi.hoisted(() => ({ translateTexts: vi.fn<() => Promise<string[]>>() }))
vi.mock('@/packages/translation', () => translationMocks)

const platformMocks = vi.hoisted(() => ({
  openLink: vi.fn(),
}))
const trackingMocks = vi.hoisted(() => ({
  trackTokenExhaustedCard: vi.fn(),
  useSessionHeader: vi.fn<
    (sessionId: string | null) => { session?: Pick<SessionHeader, 'settings'>; isFetched: boolean }
  >(() => ({
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
        useSessionHeader: trackingMocks.useSessionHeader,
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
  translationMocks.translateTexts.mockReset()
  platformMocks.openLink.mockReset()
  trackingMocks.trackTokenExhaustedCard.mockReset()
  trackingMocks.useSessionHeader.mockReset()
  trackingMocks.useSessionHeader.mockReturnValue({ session: undefined, isFetched: false })
  settingsStore.setState(initialSettings)
})

test('shows the Free plan downgrade and license refresh guidance for a backend downgrade error', () => {
  const error = ChatboxAIAPIError.fromCodeName('Plan Downgraded', 'license_downgraded')
  expect(error).not.toBeNull()

  const msg = {
    id: 'assistant-downgraded',
    role: 'assistant',
    contentParts: [],
    error: error?.message,
    errorCode: error?.code,
    aiProvider: 'chatbox-ai',
  } as Message

  render(
    <MantineProvider>
      <MessageErrTips msg={msg} />
    </MantineProvider>
  )

  expect(
    screen.getByText(
      'Your plan has expired and has been automatically downgraded to the Free plan. Please refresh your license information and try again.'
    )
  ).not.toBeNull()
  expect(
    screen.queryByText('Your license has expired. Please check your subscription or purchase a new one.')
  ).toBeNull()
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
  trackingMocks.useSessionHeader.mockReturnValue({
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

test('resolves a missing generation mode from the cached session header before tracking', () => {
  trackingMocks.useSessionHeader.mockReturnValue({
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

  expect(trackingMocks.useSessionHeader).toHaveBeenCalledWith('session-123')
  expect(trackingMocks.trackTokenExhaustedCard).toHaveBeenCalledWith('exposure', {
    sessionId: 'session-123',
    mode: 'work_mode',
    provider: 'chatbox-ai',
    model: 'claude-opus-5',
    action: 'upgrade-plan',
    plan: 'pro',
  })
})

test('keeps raw details copyable while collapsed and supports expanding them without retrying', () => {
  settingsStore.setState((state) => ({ ...state, language: 'en', licenseKey: 'test-license' }))
  const onRetry = vi.fn()
  const execCommand = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const raw = `Invalid API key. ${'The provider returned diagnostic details. '.repeat(10)}`
  const msg = {
    id: 'detail-error',
    role: 'assistant',
    contentParts: [],
    error: 'API Error',
    errorCode: 10001,
    errorExtra: { httpStatusCode: 401, responseBody: raw, requestId: 'request-123' },
  } as Message
  render(
    <MantineProvider>
      <MessageErrTips msg={msg} onRetry={onRetry} />
    </MantineProvider>
  )
  expect(screen.queryByText(raw)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }))
  expect(writeText).toHaveBeenCalledWith(raw)
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
  expect(screen.getByRole('alert').textContent).toContain(raw)
  expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
  expect(screen.queryByText(raw)).toBeNull()
  expect(onRetry).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(document, 'execCommand')
})

test('disables retry until the pending retry completes', async () => {
  let finishRetry: (() => void) | undefined
  const onRetry = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishRetry = resolve
      })
  )
  const msg = { id: 'retry-error', role: 'assistant', contentParts: [], error: 'Expired', errorCode: 20002 } as Message
  render(
    <MantineProvider>
      <MessageErrTips msg={msg} onRetry={onRetry} />
    </MantineProvider>
  )
  const retry = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement
  fireEvent.click(retry)
  expect(retry.disabled).toBe(true)
  fireEvent.click(retry)
  expect(onRetry).toHaveBeenCalledOnce()
  finishRetry?.()
  await waitFor(() => expect(retry.disabled).toBe(false))
})

test('shows translation progress and lets the user return to the original error', async () => {
  settingsStore.setState((state) => ({ ...state, language: 'zh-Hans', licenseKey: 'test-license' }))
  let finishTranslation: ((texts: string[]) => void) | undefined
  translationMocks.translateTexts.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishTranslation = resolve
      })
  )
  const msg = {
    id: 'translate-error',
    role: 'assistant',
    contentParts: [],
    error: 'API Error',
    errorCode: 10001,
    errorExtra: { httpStatusCode: 401, responseBody: 'Provider authentication failed.' },
  } as Message
  render(
    <MantineProvider>
      <MessageErrTips msg={msg} />
    </MantineProvider>
  )
  const translate = screen.getByRole('button', { name: 'Translate' }) as HTMLButtonElement
  fireEvent.click(translate)
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Translate' }) as HTMLButtonElement).disabled).toBe(true)
  )
  finishTranslation?.(['服务商身份验证失败。'])
  await waitFor(() => expect(screen.getByText('服务商身份验证失败。')).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Show original' }))
  expect(screen.getByText('Provider authentication failed.')).not.toBeNull()
})
