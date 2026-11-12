// @vitest-environment jsdom

import type { SessionHeader } from '@chatbox/core/ports'
import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { ChatboxAIAPIError, MESSAGE_ERROR_CODES } from '@shared/models/errors'
import type { ChatboxAILicenseDetail, ChatboxAIPlanType, Message } from '@shared/types'
import { ModelProviderType } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import i18n from '@/i18n'
import { settingsStore } from '@/stores/settingsStore'
import { act, fireEvent, render as renderWithProviders, screen, waitFor } from '@/test-utils'
import MessageErrTips from './MessageErrTips'

let queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function render(ui: ReactElement) {
  return renderWithProviders(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const remoteMocks = vi.hoisted(() => ({ getLicenseDetailRealtime: vi.fn() }))
vi.mock('@/packages/remote', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/remote')>()),
  ...remoteMocks,
}))

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
  queryClient.clear()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  remoteMocks.getLicenseDetailRealtime.mockReset()
  translationMocks.translateTexts.mockReset()
  platformMocks.openLink.mockReset()
  trackingMocks.trackTokenExhaustedCard.mockReset()
  trackingMocks.useSessionHeader.mockReset()
  trackingMocks.useSessionHeader.mockReturnValue({ session: undefined, isFetched: false })
  settingsStore.setState(initialSettings)
})

test.each([401, 403])('keeps Chatbox AI guidance for HTTP %i', (httpStatusCode) => {
  settingsStore.setState((state) => ({ ...state, language: 'en' }))
  const msg = {
    id: `chatbox-ai-${httpStatusCode}`,
    role: 'assistant',
    contentParts: [],
    error: 'API Error',
    errorCode: 10001,
    errorExtra: { httpStatusCode },
    aiProvider: 'chatbox-ai',
  } as Message

  render(
    <MantineProvider>
      <MessageErrTips msg={msg} />
    </MantineProvider>
  )

  const guidance = screen.getByRole('alert').textContent || ''
  expect(guidance).toContain('Connection to Chatbox AI failed.')
  expect(guidance).not.toContain('your configured Chatbox AI API')
})

test.each([
  [408, 'Request Timeout'],
  [429, 'Too Many Requests'],
  [500, 'Internal Server Error'],
  [502, 'Bad Gateway'],
  [503, 'Service Unavailable'],
  [504, 'Gateway Timeout'],
])('keeps Chatbox AI HTTP %i status guidance', (httpStatusCode, statusName) => {
  settingsStore.setState((state) => ({ ...state, language: 'en' }))
  render(
    <MantineProvider>
      <MessageErrTips
        msg={
          {
            id: `chatbox-ai-${httpStatusCode}`,
            role: 'assistant',
            contentParts: [],
            error: 'API Error',
            errorCode: 10001,
            errorExtra: { httpStatusCode },
            aiProvider: 'chatbox-ai',
          } as Message
        }
      />
    </MantineProvider>
  )
  expect(screen.getByRole('alert').textContent).toContain(`HTTP error: ${statusName} (${httpStatusCode}).`)
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

const availableLicenseDetail: ChatboxAILicenseDetail = {
  ...proPlusLicenseDetail,
  unified_token_usage_details: [{ type: 'plan', token_limit: 50000, token_usage: 0 }],
}
const customApiError = {
  id: 'custom-api-error',
  role: 'assistant',
  contentParts: [],
  error: 'API Error',
  errorCode: 10001,
  aiProvider: 'custom-provider',
  errorExtra: { httpStatusCode: 401 },
} as Message
function renderCustomError() {
  return render(
    <MantineProvider>
      <MessageErrTips msg={customApiError} />
    </MantineProvider>
  )
}

test('refreshes persisted quota and shares a fresh query across error cards', async () => {
  settingsStore.setState({ licenseKey: 'license-a', licenseDetail: availableLicenseDetail })
  remoteMocks.getLicenseDetailRealtime.mockResolvedValue({
    data: {
      ...availableLicenseDetail,
      unified_token_usage_details: [{ type: 'plan', token_limit: 50000, token_usage: 40000 }],
    },
  })
  const first = renderCustomError()
  await screen.findByText(/10.00K plan points/)
  expect(screen.queryByText(/50.00K plan points/)).toBeNull()
  renderCustomError()
  expect(remoteMocks.getLicenseDetailRealtime).toHaveBeenCalledTimes(1)
  first.unmount()
})

test('refetches quota when an error is shown after the cache becomes stale', async () => {
  settingsStore.setState({ licenseKey: 'license-a', licenseDetail: availableLicenseDetail })
  queryClient.setQueryData(['chatbox-ai-error-quota', 'license-a'], availableLicenseDetail, {
    updatedAt: Date.now() - 61000,
  })
  remoteMocks.getLicenseDetailRealtime.mockResolvedValue({ data: proPlusLicenseDetail })
  renderCustomError()
  await waitFor(() => expect(remoteMocks.getLicenseDetailRealtime).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.queryByText(/Switch to a model under/)).toBeNull())
})

test('hides quota on logout and does not reuse it for another license', async () => {
  settingsStore.setState({ licenseKey: 'license-a' })
  remoteMocks.getLicenseDetailRealtime
    .mockResolvedValueOnce({ data: availableLicenseDetail })
    .mockResolvedValueOnce({ data: proPlusLicenseDetail })
  renderCustomError()
  await screen.findByText(/50.00K plan points/)
  act(() => settingsStore.setState({ licenseKey: undefined, licenseDetail: undefined }))
  expect(screen.queryByText(/Switch to a model under/)).toBeNull()
  act(() => settingsStore.setState({ licenseKey: 'license-b' }))
  expect(screen.queryByText(/50.00K plan points/)).toBeNull()
  await waitFor(() =>
    expect(remoteMocks.getLicenseDetailRealtime).toHaveBeenLastCalledWith({ licenseKey: 'license-b' })
  )
  await waitFor(() =>
    expect(queryClient.getQueryState(['chatbox-ai-error-quota', 'license-b'])?.status).toBe('success')
  )
  expect(screen.queryByText(/Switch to a model under/)).toBeNull()
})

test('ignores an old license response that arrives after switching licenses', async () => {
  let resolveOld: (value: { data: ChatboxAILicenseDetail }) => void = () => {}
  settingsStore.setState({ licenseKey: 'license-a' })
  remoteMocks.getLicenseDetailRealtime
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    .mockResolvedValueOnce({ data: proPlusLicenseDetail })
  renderCustomError()
  act(() => settingsStore.setState({ licenseKey: 'license-b' }))
  await waitFor(() => expect(remoteMocks.getLicenseDetailRealtime).toHaveBeenCalledTimes(2))
  await act(async () => resolveOld({ data: availableLicenseDetail }))
  expect(screen.queryByText(/Switch to a model under/)).toBeNull()
})

test.each([
  { error: 'API Error', errorCode: 10001, aiProvider: 'chatbox-ai' },
  { error: 'Expired license', errorCode: 20002, aiProvider: 'chatbox-ai' },
  { error: 'Network Error', errorCode: 10002, aiProvider: 'chatbox-ai' },
])('does not fetch or recommend quota for $error from $aiProvider', (error) => {
  settingsStore.setState({ licenseKey: 'license-a', licenseDetail: availableLicenseDetail })
  render(
    <MantineProvider>
      <MessageErrTips msg={{ ...customApiError, ...error }} />
    </MantineProvider>
  )
  expect(remoteMocks.getLicenseDetailRealtime).not.toHaveBeenCalled()
  expect(screen.queryByText(/Switch to a model under/)).toBeNull()
})

test('shows custom provider name, network advice and login guidance after a network failure', () => {
  settingsStore.setState({
    licenseKey: undefined,
    language: 'en',
    customProviders: [{ id: 'custom-provider', name: 'My API', type: ModelProviderType.OpenAI, isCustom: true }],
  })
  render(
    <MantineProvider>
      <MessageErrTips
        msg={{
          ...customApiError,
          error: 'Network Error: connection refused',
          errorCode: 10002,
          errorExtra: { host: 'api.example.test' },
        }}
      />
    </MantineProvider>
  )
  const guidance = screen.getByRole('alert').textContent || ''
  expect(guidance).toContain('connection with api.example.test')
  expect(guidance).toContain('your configured My API')
  expect(guidance).toContain('Sign in to Chatbox AI')
})

test('shows available Chatbox AI points after a custom provider network failure', async () => {
  settingsStore.setState({ licenseKey: 'license-a', language: 'en' })
  remoteMocks.getLicenseDetailRealtime.mockResolvedValue({ data: availableLicenseDetail })
  render(
    <MantineProvider>
      <MessageErrTips
        msg={{
          ...customApiError,
          error: 'Network Error: connection refused',
          errorCode: 10002,
          errorExtra: { host: 'api.example.test' },
        }}
      />
    </MantineProvider>
  )
  await screen.findByText(/50.00K plan points/)
  expect(screen.getByRole('alert').textContent).toContain('connection with api.example.test')
})

test('does not advertise quota when the server rejects the license', async () => {
  settingsStore.setState({ licenseKey: 'license-a', licenseDetail: availableLicenseDetail })
  remoteMocks.getLicenseDetailRealtime.mockResolvedValue({
    data: availableLicenseDetail,
    error: { code: 'expired_license' },
  })
  renderCustomError()
  await waitFor(() =>
    expect(queryClient.getQueryState(['chatbox-ai-error-quota', 'license-a'])?.status).toBe('success')
  )
  expect(screen.queryByText(/Switch to a model under/)).toBeNull()
})

test.each(['token_expire_time', 'plan expires_at'] as const)(
  'hides expired plan points but keeps expansion points when %s has passed',
  async (expiryField) => {
    settingsStore.setState({ licenseKey: 'license-a' })
    const expiredAt = new Date(Date.now() - 60_000).toISOString()
    remoteMocks.getLicenseDetailRealtime.mockResolvedValue({
      data: {
        ...availableLicenseDetail,
        token_expire_time: expiryField === 'token_expire_time' ? expiredAt : undefined,
        unified_token_usage_details: [
          {
            type: 'plan',
            token_limit: 50000,
            token_usage: 0,
            expires_at: expiryField === 'plan expires_at' ? expiredAt : undefined,
          },
        ],
        expansion_pack_limit: 2000,
      },
    })
    renderCustomError()
    await screen.findByText(/2.00K Chatbox expansion pack points/)
    expect(screen.queryByText(/50.00K plan points/)).toBeNull()
  }
)

test.each([
  ['en', '50.00K', '2.00K'],
  ['zh-Hans', '5.00万', '2.00千'],
])('formats plan and expansion points for %s', async (language, planPoints, expansionPoints) => {
  await i18n.changeLanguage(language)
  try {
    settingsStore.setState({ licenseKey: 'license-a' })
    remoteMocks.getLicenseDetailRealtime.mockResolvedValue({
      data: {
        ...availableLicenseDetail,
        expansion_pack_limit: 2000,
      },
    })
    renderCustomError()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(planPoints))
    expect(screen.getByRole('alert').textContent).toContain(expansionPoints)
  } finally {
    await i18n.changeLanguage('en')
  }
})

test('hides cached quota if a refresh fails', async () => {
  settingsStore.setState({ licenseKey: 'license-a' })
  queryClient.setQueryData(['chatbox-ai-error-quota', 'license-a'], availableLicenseDetail, {
    updatedAt: Date.now() - 61000,
  })
  remoteMocks.getLicenseDetailRealtime.mockRejectedValue(new Error('offline'))
  renderCustomError()
  await waitFor(() => expect(queryClient.getQueryState(['chatbox-ai-error-quota', 'license-a'])?.status).toBe('error'))
  await waitFor(() => expect(screen.queryByText(/Switch to a model under/)).toBeNull())
})
