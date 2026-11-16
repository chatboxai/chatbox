// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Message, MessageToolCallPart, Session } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const rowReads = vi.hoisted(() => ({ message: undefined as Message | undefined }))
const settings = vi.hoisted(() => ({ licenseKey: 'license-a', language: 'en' }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: typeof settings) => unknown) => selector(settings),
}))
vi.mock('@/packages/image-points-billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/image-points-billing')>()
  return {
    withImagePointsApproval: vi.fn((_params, _license, _always, resume: () => Promise<void>) => resume()),
    refreshImageLicense: vi.fn(),
    hasImagePointsConsent: vi.fn().mockResolvedValue(false),
    remainingImageQuota: actual.remainingImageQuota,
    imagePointsChargeNeeded: actual.imagePointsChargeNeeded,
    getImagePointsCharge: actual.getImagePointsCharge,
  }
})
vi.mock('@/packages/remote', () => ({
  buildChatboxUrl: (path: string) => `https://chatboxai.app${path}`,
  getChatboxAIModelList: vi.fn(),
}))
vi.mock('@/components/common/Link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessionHooks: {
      useSessionMessage: (_sessionId: string, messageId: string | null) => ({
        message: rowReads.message?.id === messageId ? rowReads.message : null,
      }),
    },
  },
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      key.startsWith('Image quota remaining:') ||
      key.startsWith('Compute points remaining:') ||
      key.startsWith('This request will use ') ||
      key.startsWith('This request will consume ')
        ? key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values?.[name] ?? '')
        : key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/platform', () => ({
  default: { appLog: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/adapters/CurrentGenerationService', () => ({
  currentGenerationService: {
    continuePausedToolCall: vi.fn().mockResolvedValue(undefined),
    stopPausedToolCall: vi.fn().mockResolvedValue(undefined),
    disableToolCallLimitPauseAndContinue: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/stores/approvalAttentionStore', () => ({
  revealPausedStep: vi.fn().mockResolvedValue(undefined),
  usePendingActionBarPulseToken: () => 0,
  pulsePendingActionBar: vi.fn(),
}))

vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))

import { APPROVAL_RESPONSE_TIMEOUT_MS } from '@chatbox/core/message-approval'
import { currentGenerationService } from '@/adapters/CurrentGenerationService'
import { hasImagePointsConsent, refreshImageLicense, withImagePointsApproval } from '@/packages/image-points-billing'
import { getChatboxAIModelList } from '@/packages/remote'
import { pulsePendingActionBar } from '@/stores/approvalAttentionStore'
import RowPendingActionBar, { PENDING_ACTION_ARMING_MS } from './PendingActionBar'

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

function pausedPart(overrides: Partial<MessageToolCallPart>): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'paused',
    toolCallId: 'tc-1',
    toolName: 'user_exec',
    args: {},
    ...overrides,
  } as MessageToolCallPart
}

function makeSession(
  parts: MessageToolCallPart[],
  { sessionId = 'session-1', messageId = 'msg-1' }: { sessionId?: string; messageId?: string } = {}
): Session {
  const message = { id: messageId, role: 'assistant', contentParts: parts } as unknown as Message
  return { id: sessionId, type: 'chat', name: 'test', messages: [message] } as unknown as Session
}

function PendingActionBar({ session }: { session: Session }) {
  rowReads.message = session.messages[0]
  return (
    <RowPendingActionBar
      sessionId={session.id}
      activeThreadId={session.messages[0]?.id ?? 'active'}
      messageIds={session.messages.map((message) => message.id)}
    />
  )
}

function renderBar(session: Session) {
  const queryClient = new QueryClient()
  return render(<PendingActionBar session={session} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <MantineProvider>{children}</MantineProvider>
      </QueryClientProvider>
    ),
  })
}

/** Let the input-protection window elapse so decision clicks register. */
function armBar() {
  vi.advanceTimersByTime(PENDING_ACTION_ARMING_MS)
}

function withForkPosition(session: Session, pivotMessageId: string, position: number): Session {
  return {
    ...session,
    messageForksHash: {
      [pivotMessageId]: {
        position,
        lists: [
          { id: 'fork-0', messages: [] },
          { id: 'fork-1', messages: [] },
        ],
        createdAt: 1,
      },
    },
  }
}

const commandApproval = pausedPart({
  toolCallId: 'tc-cmd',
  pauseReason: { type: 'user_exec_approval', command: 'rm -rf build', workdir: '/repo' },
})

const fileApproval = pausedPart({
  toolCallId: 'tc-file',
  toolName: 'edit_file',
  pauseReason: {
    type: 'file_mutation_approval',
    title: 'Edit config.ts',
    preview: '  const config = {\n- retries: 3,\n+ retries: 5,\n  }',
    stats: { mode: 'edit', edits: 1, addedLines: 1, removedLines: 1 },
  },
})

const limitPause = pausedPart({
  toolCallId: 'tc-limit',
  toolName: 'sandbox_bash',
  pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
})

const imageApproval = pausedPart({
  toolCallId: 'tc-image',
  toolName: 'chatbox_cli',
  pauseReason: {
    type: 'app_action_approval',
    action: 'image.generate',
    title: 'Generate image',
    preview: 'cat',
    details: {
      type: 'image_generation',
      provider: 'chatbox-ai',
      modelId: 'image',
      prompt: 'cat',
      count: 1,
      billing: 'chatbox_quota',
      imageQuota: { remaining: 0, total: 100 },
    },
  },
})
const alwaysAllowLabel = 'Always allow this license to use compute points for images on this device'
const chargeLine =
  'This request will use 1 image quota first, then charge 2 × 27,000 points/image = 54,000 points. Approving confirms this charge.'
const quotaOnlyLine = 'This request will consume 1 image quota.'
const pointsFallbackLine =
  'This request may use remaining image quota first, with any additional images charged in compute points.'
const realtimeQuota = {
  plan: 'pro',
  image_total_quota: 200,
  image_used_count: 195,
  unified_token_limit: 100000,
  unified_token_usage: 70000,
  unified_token_usage_details: [{ type: 'plan', token_limit: 100000, token_usage: 70000 }],
  expansion_pack_limit: 50000,
  expansion_pack_usage: 0,
} as Awaited<ReturnType<typeof refreshImageLicense>>
/** One image left, three requested: two images are charged in compute points. */
const chargedQuota = { ...realtimeQuota, image_used_count: 199 }

function withImageCount(count: number): MessageToolCallPart {
  if (
    imageApproval.pauseReason?.type !== 'app_action_approval' ||
    imageApproval.pauseReason.details?.type !== 'image_generation'
  ) {
    throw new Error('Image approval fixture is missing')
  }
  return {
    ...imageApproval,
    pauseReason: { ...imageApproval.pauseReason, details: { ...imageApproval.pauseReason.details, count } },
  }
}
const chargedImageApproval = withImageCount(3)

describe('PendingActionBar', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    settings.licenseKey = 'license-a'
    vi.mocked(hasImagePointsConsent).mockResolvedValue(false)
    vi.mocked(refreshImageLicense).mockResolvedValue(realtimeQuota)
    vi.mocked(getChatboxAIModelList).mockResolvedValue({
      imageModels: [{ modelId: 'image', points_per_image: 27000 }],
    } as Awaited<ReturnType<typeof getChatboxAIModelList>>)
    // Only Date is faked: the arming guard compares timestamps, while real timers
    // keep Mantine and Testing Library behavior untouched.
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('tints the payload block inside the glass action bar', () => {
    renderBar(makeSession([commandApproval]))
    expect(screen.getByText('rm -rf build').closest('.chatbox-glass-tint')).not.toBeNull()
  })

  it('renders nothing without pending interactions', () => {
    renderBar(makeSession([pausedPart({ state: 'result', pauseReason: undefined })]))
    expect(screen.queryByTestId(TestId.toolCall.actionBar)).toBeNull()
  })

  it.each([false, true])(
    'approves the reviewed image and its points together, always allow: %s',
    async (alwaysAllow) => {
      vi.mocked(refreshImageLicense).mockResolvedValue(chargedQuota)
      renderBar(makeSession([chargedImageApproval]))
      await waitFor(() =>
        expect((screen.getByTestId(TestId.toolCall.approve) as HTMLButtonElement).disabled).toBe(false)
      )
      expect(screen.getByText(chargeLine)).toBeTruthy()
      expect(screen.getByText('Compute points remaining: 80,000')).toBeTruthy()
      expect(getChatboxAIModelList).toHaveBeenCalledWith(
        { licenseKey: 'license-a', language: 'en' },
        expect.any(AbortSignal)
      )
      expect(screen.getByRole('link', { name: 'Model pricing' }).getAttribute('href')).toBe(
        'https://chatboxai.app/en/model-pricing#image-models'
      )
      if (alwaysAllow) fireEvent.click(screen.getByRole('checkbox', { name: alwaysAllowLabel }))
      expect(withImagePointsApproval).not.toHaveBeenCalled()
      expect(pulsePendingActionBar).not.toHaveBeenCalled()
      armBar()
      fireEvent.click(screen.getByRole('button', { name: 'Approve and generate' }))
      expect(withImagePointsApproval).toHaveBeenCalledWith(
        {
          prompt: 'cat',
          referenceImages: [],
          model: { provider: 'chatbox-ai', modelId: 'image' },
          imageGenerateNum: 3,
          source: { type: 'chatbox_cli', sessionId: 'session-1', toolCallId: 'tc-image' },
          aspectRatio: undefined,
          dalleStyle: undefined,
        },
        'license-a',
        alwaysAllow,
        expect.any(Function)
      )
      expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-image')
    }
  )

  it.each([199, 200])(
    'shows saved points permission with %s images used while still requiring approval',
    async (used) => {
      vi.mocked(hasImagePointsConsent).mockResolvedValue(true)
      vi.mocked(refreshImageLicense).mockResolvedValue({
        ...chargedQuota,
        image_used_count: used,
        expansion_pack_limit: 100000,
      })
      renderBar(makeSession([chargedImageApproval]))
      await screen.findByText(/Already allowed to use compute points/)
      expect(screen.queryByRole('checkbox', { name: alwaysAllowLabel })).toBeNull()
      expect(screen.queryByText(/Approving confirms this charge/)).toBeNull()
      expect(screen.getByText(used === 199 ? /54,000 points/ : /81,000 points/)).toBeTruthy()
      expect(hasImagePointsConsent).toHaveBeenCalledWith('license-a')
      expect(currentGenerationService.continuePausedToolCall).not.toHaveBeenCalled()
      armBar()
      fireEvent.click(screen.getByRole('button', { name: 'Approve and generate' }))
      expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledOnce()
    }
  )

  it('loads the saved permission for each license', async () => {
    vi.mocked(hasImagePointsConsent).mockImplementation(async (license) => license === 'license-a')
    vi.mocked(refreshImageLicense).mockResolvedValue(chargedQuota)
    const { rerender } = renderBar(makeSession([chargedImageApproval]))
    await screen.findByText(/Already allowed to use compute points/)
    settings.licenseKey = 'license-b'
    rerender(<PendingActionBar session={makeSession([chargedImageApproval])} />)
    await screen.findByRole('checkbox', { name: alwaysAllowLabel })
    expect(screen.queryByText(/Already allowed to use compute points/)).toBeNull()
    expect(hasImagePointsConsent).toHaveBeenCalledWith('license-b')
  })

  it('charges every image in points when no image quota remains', async () => {
    vi.mocked(refreshImageLicense).mockResolvedValue({ ...realtimeQuota, image_used_count: 200 })
    renderBar(makeSession([withImageCount(2)]))
    await screen.findByText(
      'This request will use compute points: 2 × 27,000 points/image = 54,000 points. Approving confirms this charge.'
    )
    expect(screen.queryByText(/image quota first/)).toBeNull()
    expect(screen.getByRole('checkbox', { name: alwaysAllowLabel })).toBeTruthy()
  })

  it('shows only the image quota consumption when image quota covers the request', async () => {
    renderBar(makeSession([imageApproval]))
    await screen.findByText('Image quota remaining: 5 / 200')
    expect(screen.getByText(quotaOnlyLine)).toBeTruthy()
    expect(screen.queryByText(/compute points/i)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Model pricing' })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(getChatboxAIModelList).not.toHaveBeenCalled()
    armBar()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and generate' }))
    expect(withImagePointsApproval).toHaveBeenCalledWith(
      expect.objectContaining({ imageGenerateNum: 1 }),
      'license-a',
      false,
      expect.any(Function)
    )
  })

  it('shows insufficient points instead of a charge confirmation', async () => {
    vi.mocked(refreshImageLicense).mockResolvedValue({ ...chargedQuota, expansion_pack_limit: 0 })
    renderBar(makeSession([chargedImageApproval]))
    await screen.findByText('Insufficient points')
    expect(screen.queryByText(chargeLine)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('blocks approval while the image price cannot be loaded', async () => {
    vi.mocked(refreshImageLicense).mockResolvedValue(chargedQuota)
    vi.mocked(getChatboxAIModelList).mockRejectedValueOnce(new Error('network unavailable'))
    renderBar(makeSession([chargedImageApproval]))
    await screen.findByText('Unable to check image billing. Please try again.')
    expect((screen.getByTestId(TestId.toolCall.approve) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(chargeLine)
  })

  it('does not grant points permission when the checked image approval is cancelled', async () => {
    vi.mocked(refreshImageLicense).mockResolvedValue(chargedQuota)
    renderBar(makeSession([chargedImageApproval]))
    fireEvent.click(await screen.findByRole('checkbox', { name: alwaysAllowLabel }))
    armBar()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(withImagePointsApproval).not.toHaveBeenCalled()
    expect(currentGenerationService.continuePausedToolCall).not.toHaveBeenCalled()
    expect(currentGenerationService.stopPausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-image', {
      denyReason: 'user',
    })
  })

  it('resets the always-allow choice for another request or license', async () => {
    vi.mocked(refreshImageLicense).mockResolvedValue(chargedQuota)
    const checkbox = async () => (await screen.findByRole('checkbox', { name: alwaysAllowLabel })) as HTMLInputElement
    const { rerender } = renderBar(makeSession([chargedImageApproval]))
    fireEvent.click(await checkbox())
    settings.licenseKey = 'license-b'
    rerender(<PendingActionBar session={makeSession([chargedImageApproval])} />)
    expect((await checkbox()).checked).toBe(false)
    settings.licenseKey = 'license-a'
    rerender(<PendingActionBar session={makeSession([chargedImageApproval])} />)
    expect((await checkbox()).checked).toBe(false)
    fireEvent.click(await checkbox())
    rerender(<PendingActionBar session={makeSession([{ ...chargedImageApproval, toolCallId: 'other' }])} />)
    expect((await checkbox()).checked).toBe(false)
  })

  it('does not show or grant points consent for a generic work-mode approval', () => {
    renderBar(makeSession([commandApproval]))
    expect(screen.queryByRole('checkbox')).toBeNull()
    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(withImagePointsApproval).not.toHaveBeenCalled()
    expect(refreshImageLicense).not.toHaveBeenCalled()
  })

  it('keeps BYOK approval independent of Chatbox quota and consent', () => {
    if (
      imageApproval.pauseReason?.type !== 'app_action_approval' ||
      imageApproval.pauseReason.details?.type !== 'image_generation'
    ) {
      throw new Error('Image approval fixture is missing')
    }
    renderBar(
      makeSession([
        {
          ...imageApproval,
          pauseReason: {
            ...imageApproval.pauseReason,
            details: { ...imageApproval.pauseReason.details, provider: 'openai', billing: 'provider' },
          },
        },
      ])
    )
    expect(screen.getByText('This request may incur charges from {{provider}}.')).toBeTruthy()
    expect(screen.queryByText(/image quota/i)).toBeNull()
    expect(screen.queryByText(/compute points/i)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(refreshImageLicense).not.toHaveBeenCalled()
    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(withImagePointsApproval).not.toHaveBeenCalled()
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-image')
  })

  it('waits for real-time quota and replaces the persisted approval snapshot', async () => {
    let resolve!: (value: typeof realtimeQuota) => void
    vi.mocked(refreshImageLicense).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    renderBar(makeSession([imageApproval]))
    expect(screen.getByText('Loading license details...')).toBeTruthy()
    expect(screen.queryByText('Image quota remaining: 0 / 100')).toBeNull()
    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(withImagePointsApproval).not.toHaveBeenCalled()
    expect(refreshImageLicense).toHaveBeenCalledWith('license-a', expect.any(AbortSignal))
    await act(async () => resolve(realtimeQuota))
    await screen.findByText('Image quota remaining: 5 / 200')
    expect(screen.getByText(quotaOnlyLine)).toBeTruthy()
    expect(screen.queryByText(/compute points/i)).toBeNull()
    expect((screen.getByTestId(TestId.toolCall.approve) as HTMLButtonElement).disabled).toBe(false)
  })

  it('blocks approval on refresh failure and allows retrying the quota request', async () => {
    vi.mocked(refreshImageLicense).mockRejectedValueOnce(new Error('network unavailable'))
    renderBar(makeSession([imageApproval]))
    await screen.findByText('Unable to check image billing. Please try again.')
    expect(screen.getByText(pointsFallbackLine)).toBeTruthy()
    expect(screen.queryByText(quotaOnlyLine)).toBeNull()
    expect(screen.queryByText('Image quota remaining: 0 / 100')).toBeNull()
    expect((screen.getByTestId(TestId.toolCall.approve) as HTMLButtonElement).disabled).toBe(true)
    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(withImagePointsApproval).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Image quota remaining: 5 / 200')
    expect(screen.getByText(quotaOnlyLine)).toBeTruthy()
    expect(screen.queryByText(pointsFallbackLine)).toBeNull()
    expect(refreshImageLicense).toHaveBeenCalledTimes(2)
  })

  it('follows live quota with the points variant after a failed refresh is retried', async () => {
    vi.mocked(refreshImageLicense).mockRejectedValueOnce(new Error('network unavailable'))
    vi.mocked(refreshImageLicense).mockResolvedValue(chargedQuota)
    renderBar(makeSession([chargedImageApproval]))
    await screen.findByText('Unable to check image billing. Please try again.')
    expect(screen.getByText(pointsFallbackLine)).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(chargeLine)
    expect(screen.queryByText(pointsFallbackLine)).toBeNull()
    expect(screen.getByRole('checkbox', { name: alwaysAllowLabel })).toBeTruthy()
    expect((screen.getByTestId(TestId.toolCall.approve) as HTMLButtonElement).disabled).toBe(false)
  })

  it('refreshes on every approval and ignores a late response for the previous license', async () => {
    let resolve!: (value: typeof realtimeQuota) => void
    vi.mocked(refreshImageLicense).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const { rerender, unmount } = renderBar(makeSession([imageApproval]))
    const firstSignal = vi.mocked(refreshImageLicense).mock.calls[0][1]
    settings.licenseKey = 'license-b'
    rerender(<PendingActionBar session={makeSession([imageApproval])} />)
    await screen.findByText('Image quota remaining: 5 / 200')
    expect(firstSignal?.aborted).toBe(true)
    await act(async () => resolve({ ...realtimeQuota, image_used_count: 0 }))
    expect(screen.queryByText('Image quota remaining: 200 / 200')).toBeNull()
    rerender(<PendingActionBar session={makeSession([{ ...imageApproval, toolCallId: 'other' }])} />)
    await waitFor(() => expect(refreshImageLicense).toHaveBeenCalledTimes(3))
    unmount()
    renderBar(makeSession([imageApproval]))
    await waitFor(() => expect(refreshImageLicense).toHaveBeenCalledTimes(4))
  })

  it('shows a command approval and routes Approve/Deny to the generation service', () => {
    renderBar(makeSession([commandApproval]))

    expect(screen.getByText('rm -rf build')).toBeTruthy()
    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-cmd')

    renderBar(makeSession([fileApproval]))
    armBar()
    fireEvent.click(screen.getAllByTestId(TestId.toolCall.deny)[1])
    expect(currentGenerationService.stopPausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-file', {
      denyReason: 'user',
    })
  })

  it('swallows decision clicks until the decision has been visible for a beat', () => {
    renderBar(makeSession([commandApproval]))

    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).not.toHaveBeenCalled()

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledTimes(1)
  })

  it('re-arms the click guard when the displayed decision changes', () => {
    const { rerender } = renderBar(makeSession([commandApproval, fileApproval]))

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledTimes(1)

    // The first item leaving the pending list clears the acting state.
    rerender(<PendingActionBar session={makeSession([fileApproval])} />)
    // A click racing the swap must not act on the item that just took this spot.
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledTimes(1)

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledTimes(2)
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenLastCalledWith('session-1', 'msg-1', 'tc-file')
  })

  it('advances k/N progress as approvals resolve, holding the episode total steady', () => {
    const { rerender } = renderBar(makeSession([commandApproval, fileApproval]))
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('1 / 2')

    rerender(<PendingActionBar session={makeSession([fileApproval])} />)
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('2 / 2')
    // The next decision's content replaced the first one.
    expect(screen.getByText('Edit config.ts')).toBeTruthy()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
    expect(screen.queryByText(/retries/)).toBeNull()
    expect(screen.queryByText('rm -rf build')).toBeNull()
  })

  it('treats a new pause reason on the same tool call as the next actionable interaction', () => {
    const escalatedApproval = pausedPart({
      toolCallId: 'tc-cmd',
      pauseReason: {
        type: 'command_escalation_approval',
        command: 'rm -rf build',
        retryOf: 'retry-tc-cmd',
        workdir: '/repo',
        justification: 'The sandbox is unavailable.',
      },
    })
    const { rerender } = renderBar(makeSession([commandApproval]))

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    rerender(<PendingActionBar session={makeSession([escalatedApproval])} />)

    expect(screen.getByText('Retry with full access')).toBeTruthy()
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('2 / 2')
    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledTimes(2)
  })

  it('resets progress and transient state when the active thread changes', () => {
    const nextThreadApproval = pausedPart({
      toolCallId: 'tc-next-thread',
      pauseReason: { type: 'user_exec_approval', command: 'pnpm check', workdir: '/repo' },
    })
    const { container, rerender } = renderBar(
      makeSession([commandApproval, fileApproval], { messageId: 'thread-a-root' })
    )

    rerender(<PendingActionBar session={makeSession([fileApproval], { messageId: 'thread-a-root' })} />)
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('2 / 2')
    expect(container.querySelector('.chatbox-action-resolve-flash')).not.toBeNull()

    rerender(
      <PendingActionBar session={makeSession([nextThreadApproval, fileApproval], { messageId: 'thread-b-root' })} />
    )

    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('1 / 2')
    expect(container.querySelector('.chatbox-action-resolve-flash')).toBeNull()
    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledWith(
      'session-1',
      'thread-b-root',
      'tc-next-thread'
    )
  })

  it('resets progress when switching forks that share the first message', () => {
    const pivotMessageId = 'fork-pivot'
    const branchOne = (parts: MessageToolCallPart[]) =>
      withForkPosition(makeSession(parts, { messageId: pivotMessageId }), pivotMessageId, 0)
    const branchTwoApproval = pausedPart({
      toolCallId: 'tc-fork-two',
      pauseReason: { type: 'user_exec_approval', command: 'pnpm test', workdir: '/repo' },
    })
    const branchTwoFile = pausedPart({ ...fileApproval, toolCallId: 'tc-fork-two-file' })
    const { rerender } = renderBar(branchOne([commandApproval, fileApproval]))

    rerender(<PendingActionBar session={branchOne([fileApproval])} />)
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('2 / 2')

    rerender(
      <PendingActionBar
        session={withForkPosition(
          makeSession([branchTwoApproval, branchTwoFile], { messageId: pivotMessageId }),
          pivotMessageId,
          1
        )}
      />
    )
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('1 / 2')
    expect(screen.getByText('pnpm test')).toBeTruthy()
  })

  it('removes stale actions immediately when the next thread has no pending interaction', () => {
    const { rerender } = renderBar(makeSession([commandApproval], { messageId: 'thread-a-root' }))

    rerender(
      <PendingActionBar
        session={makeSession([pausedPart({ state: 'result', pauseReason: undefined })], {
          messageId: 'thread-b-root',
        })}
      />
    )

    expect(screen.queryByTestId(TestId.toolCall.actionBar)).toBeNull()
    expect(screen.queryByTestId(TestId.toolCall.approve)).toBeNull()
    expect(currentGenerationService.continuePausedToolCall).not.toHaveBeenCalled()
  })

  it('summarizes a file mutation without exposing the detailed diff', () => {
    renderBar(makeSession([fileApproval]))

    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
    expect(screen.queryByText('- retries: 3,')).toBeNull()
  })

  it('lets the user inspect the diff bound to a file approval', () => {
    renderBar(
      makeSession([
        pausedPart({
          toolCallId: 'preview-edit',
          toolName: 'edit_file',
          pauseReason: {
            type: 'file_mutation_approval',
            title: 'Edit config.ts',
            preview: '-retries: 3\n+retries: 5',
            stats: { mode: 'edit', edits: 1, addedLines: 1, removedLines: 1 },
            editPreview: { version: 'current-version', diffTruncated: true },
          },
        }),
      ])
    )
    const summary = screen.getByText('View changes')
    expect(summary.closest('details')?.open).toBe(false)
    expect(screen.queryByText(/retries: 5/)).toBeNull()
    summary.closest('details')!.open = true
    fireEvent(summary.closest('details')!, new Event('toggle'))
    expect(screen.getByText(/retries: 5/)).toBeTruthy()
    expect(
      screen.getByText('Diff preview is incomplete. Review the file before approving, or request smaller edits.')
    ).toBeTruthy()
  })

  it('derives line counts from a legacy file preview without rendering it', () => {
    const legacyFileApproval = pausedPart({
      toolCallId: 'tc-legacy-file',
      toolName: 'edit_file',
      pauseReason: {
        type: 'file_mutation_approval',
        title: 'Edit legacy.ts',
        preview: '# Edit 1\n--- old\nsecret = old\n+++ new\nsecret = new',
      },
    })
    renderBar(makeSession([legacyFileApproval]))

    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
    expect(screen.queryByText(/secret/)).toBeNull()
  })

  it('pulses when a click misses the buttons, since the input it replaced is gone', () => {
    renderBar(makeSession([commandApproval]))

    fireEvent.click(screen.getByText('rm -rf build'))
    expect(pulsePendingActionBar).toHaveBeenCalledTimes(1)

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    // Acting on the decision is not a missed click.
    expect(pulsePendingActionBar).toHaveBeenCalledTimes(1)
  })

  it('pulses missed clicks for a tool-call-limit pause, which takes over the input too', () => {
    renderBar(makeSession([limitPause]))

    fireEvent.click(screen.getByTestId(TestId.toolCall.actionBar))
    expect(pulsePendingActionBar).toHaveBeenCalledTimes(1)
  })

  it('shows Continue/Stop for a tool-call-limit pause', () => {
    renderBar(makeSession([limitPause]))

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.continue))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-limit')

    fireEvent.click(screen.getByTestId(TestId.toolCall.deny))
    // The first click is still pending, so the second action is ignored.
    expect(currentGenerationService.stopPausedToolCall).not.toHaveBeenCalled()
  })

  describe('approval countdown', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    })

    function elapse(ms: number) {
      act(() => {
        vi.advanceTimersByTime(ms)
      })
    }

    it('stays quiet until the last seconds, then denies with the timeout reason', () => {
      renderBar(makeSession([commandApproval]))

      elapse(APPROVAL_RESPONSE_TIMEOUT_MS - 20_000)
      expect(screen.queryByTestId(TestId.toolCall.actionBarCountdown)).toBeNull()

      elapse(15_000)
      expect(screen.getByTestId(TestId.toolCall.actionBarCountdown).textContent).toBe('Auto-deny in {{count}}s')
      expect(currentGenerationService.stopPausedToolCall).not.toHaveBeenCalled()

      elapse(5_000)
      expect(currentGenerationService.stopPausedToolCall).toHaveBeenCalledTimes(1)
      expect(currentGenerationService.stopPausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-cmd', {
        denyReason: 'timeout',
      })
    })

    it('restarts the countdown for the next decision', () => {
      const { rerender } = renderBar(makeSession([commandApproval, fileApproval]))

      elapse(APPROVAL_RESPONSE_TIMEOUT_MS - 1_000)
      rerender(<PendingActionBar session={makeSession([fileApproval])} />)
      elapse(APPROVAL_RESPONSE_TIMEOUT_MS - 1_000)

      expect(currentGenerationService.stopPausedToolCall).not.toHaveBeenCalled()
      elapse(1_000)
      expect(currentGenerationService.stopPausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-file', {
        denyReason: 'timeout',
      })
    })

    it('never times out a tool-call-limit pause', () => {
      renderBar(makeSession([limitPause]))

      elapse(APPROVAL_RESPONSE_TIMEOUT_MS * 2)
      expect(screen.queryByTestId(TestId.toolCall.actionBarCountdown)).toBeNull()
      expect(currentGenerationService.stopPausedToolCall).not.toHaveBeenCalled()
    })
  })
})
