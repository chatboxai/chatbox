// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { ImageGeneration, MessageToolCallPart } from '@shared/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  resumeImageGenerationWithFollowUpMock,
  toastAddMock,
  useCurrentGeneratingIdMock,
  useImageGenerationRecordMock,
} = vi.hoisted(() => ({
  resumeImageGenerationWithFollowUpMock: vi.fn(),
  toastAddMock: vi.fn(),
  useCurrentGeneratingIdMock: vi.fn(),
  useImageGenerationRecordMock: vi.fn(),
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/components/chat/ImageGenerationResultGallery', () => ({
  ImageGenerationResultGallery: () => null,
}))

vi.mock('@/components/common/ChatboxAIErrorMessage', () => ({
  ChatboxAIErrorMessage: () => null,
}))

vi.mock('@/packages/chatbox-cli/image-task-follow-up', () => ({
  resumeImageGenerationWithFollowUp: resumeImageGenerationWithFollowUpMock,
}))

vi.mock('@/platform', () => ({
  default: {
    appLog: vi.fn().mockResolvedValue(undefined),
    openLink: vi.fn(),
  },
}))

vi.mock('@/stores/imageGenerationStore', () => ({
  useCurrentGeneratingId: useCurrentGeneratingIdMock,
  useImageGenerationRecord: useImageGenerationRecordMock,
}))

vi.mock('@/adapters/CurrentGenerationService', () => ({
  currentGenerationService: {
    continuePausedToolCall: vi.fn(),
    stopPausedToolCall: vi.fn(),
    disableToolCallLimitPauseAndContinue: vi.fn(),
  },
}))

vi.mock('@/stores/toastActions', () => ({
  add: toastAddMock,
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: { setPictureShow: () => void }) => unknown) => selector({ setPictureShow: vi.fn() }),
}))

import { StepTimelineUI } from './ToolCallPartUI'

const acceptedResult = {
  ok: true,
  command: 'image generate',
  accepted: true,
  background: true,
  recordId: 'record-1',
  status: 'pending',
  startedAt: 1_000,
  wait: {
    mode: 'callback',
    managedBy: 'chatbox',
    modelShouldPoll: false,
  },
}

const toolCall: MessageToolCallPart = {
  type: 'tool-call',
  state: 'result',
  toolCallId: 'tool-1',
  toolName: 'chatbox_cli',
  args: { command: 'image generate --prompt "red fox"' },
  result: acceptedResult,
}

function record(overrides: Partial<ImageGeneration> = {}): ImageGeneration {
  return {
    id: 'record-1',
    prompt: 'red fox',
    referenceImages: [],
    generatedImages: [],
    createdAt: 1_000,
    model: { provider: 'chatbox-ai', modelId: 'manifest-image' },
    status: 'generating',
    taskId: 'task-1',
    ...overrides,
  }
}

describe('CLI image recovery timeline', () => {
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
    useCurrentGeneratingIdMock.mockReturnValue(null)
    resumeImageGenerationWithFollowUpMock.mockResolvedValue(record({ status: 'done' }))
  })

  afterEach(cleanup)

  it('resumes an interrupted backend task from the original chat', async () => {
    useImageGenerationRecordMock.mockReturnValue({ data: record(), isFetched: true })

    render(
      <MantineProvider>
        <StepTimelineUI parts={[toolCall]} sessionId="session-1" messageId="message-1" />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Resume Generation' }))

    await waitFor(() => {
      expect(resumeImageGenerationWithFollowUpMock).toHaveBeenCalledWith('record-1', {
        sessionId: 'session-1',
        toolCallId: 'tool-1',
      })
    })
  })

  it('shows an interrupted state without a recovery action when the request has no backend task id', () => {
    useImageGenerationRecordMock.mockReturnValue({ data: record({ taskId: undefined }), isFetched: true })

    render(
      <MantineProvider>
        <StepTimelineUI parts={[toolCall]} sessionId="session-1" messageId="message-1" />
      </MantineProvider>
    )

    expect(screen.queryByRole('button', { name: 'Resume Generation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Regenerate in Image Creator' })).toBeNull()
    expect(screen.getByText(/Image generation interrupted/)).toBeTruthy()
    expect(
      screen.getByText('The original task cannot be resumed. Please send a new image generation request.')
    ).toBeTruthy()
  })

  it('keeps the pending state while the linked image record is loading', () => {
    useImageGenerationRecordMock.mockReturnValue({ data: undefined, isFetched: false })

    render(
      <MantineProvider>
        <StepTimelineUI parts={[toolCall]} sessionId="session-1" messageId="message-1" />
      </MantineProvider>
    )

    expect(screen.queryByText(/Image generation interrupted/)).toBeNull()
    expect(
      screen.queryByText('The original task cannot be resumed. Please send a new image generation request.')
    ).toBeNull()
    expect(screen.getByText(/Generating image/)).toBeTruthy()
  })

  it('shows an interrupted state when the linked image record is missing', () => {
    useImageGenerationRecordMock.mockReturnValue({ data: null, isFetched: true })

    render(
      <MantineProvider>
        <StepTimelineUI parts={[toolCall]} sessionId="session-1" messageId="message-1" />
      </MantineProvider>
    )

    expect(screen.queryByRole('button', { name: 'Resume Generation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Regenerate in Image Creator' })).toBeNull()
    expect(screen.getByText(/Image generation interrupted/)).toBeTruthy()
    expect(
      screen.getByText('The original task cannot be resumed. Please send a new image generation request.')
    ).toBeTruthy()
  })

  it('explains why resume is blocked while another image is generating', () => {
    useImageGenerationRecordMock.mockReturnValue({ data: record(), isFetched: true })
    useCurrentGeneratingIdMock.mockReturnValue('other-record')

    render(
      <MantineProvider>
        <StepTimelineUI parts={[toolCall]} sessionId="session-1" messageId="message-1" />
      </MantineProvider>
    )

    const resumeButton = screen.getByRole('button', { name: 'Resume Generation' })
    expect(resumeButton.hasAttribute('disabled')).toBe(true)

    fireEvent.mouseEnter(resumeButton.parentElement as HTMLElement)

    return waitFor(() => {
      expect(screen.getByText('Another image is being generated. Please wait.')).toBeTruthy()
    })
  })

  it('shows a localized message instead of the raw error when resume fails', async () => {
    useImageGenerationRecordMock.mockReturnValue({ data: record(), isFetched: true })
    resumeImageGenerationWithFollowUpMock.mockRejectedValue(new Error('No task ID found for this record'))

    render(
      <MantineProvider>
        <StepTimelineUI parts={[toolCall]} sessionId="session-1" messageId="message-1" />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Resume Generation' }))

    await waitFor(() => {
      expect(toastAddMock).toHaveBeenCalledWith('Unable to resume image generation.')
    })
  })
})
