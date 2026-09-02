// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { MessageToolCallPart } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { useBlobMock } = vi.hoisted(() => ({ useBlobMock: vi.fn() }))

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

vi.mock('@/hooks/useBlob', () => ({ useBlob: useBlobMock }))

vi.mock('@/platform', () => ({
  default: { appLog: vi.fn().mockResolvedValue(undefined), openLink: vi.fn() },
}))

vi.mock('@/stores/imageGenerationStore', () => ({
  useCurrentGeneratingId: () => null,
  useImageGenerationRecord: () => ({ data: undefined, isFetched: true }),
}))

vi.mock('@/adapters/CurrentGenerationService', () => ({
  currentGenerationService: {
    continuePausedToolCall: vi.fn(),
    stopPausedToolCall: vi.fn(),
    disableToolCallLimitPauseAndContinue: vi.fn(),
  },
}))

vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: { setPictureShow: () => void }) => unknown) => selector({ setPictureShow: vi.fn() }),
}))

import { StepTimelineUI } from './ToolCallPartUI'

function commandPart(overrides: Partial<MessageToolCallPart> = {}): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'call',
    toolCallId: 'tool-1',
    toolName: 'user_exec',
    args: { command: 'printf "hello\\n"' },
    startTime: Date.now() - 3_000,
    ...overrides,
  }
}

describe('command execution timeline', () => {
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
    useBlobMock.mockReturnValue({ data: undefined })
  })
  afterEach(cleanup)

  it('can expand while the command is running', () => {
    render(
      <MantineProvider>
        <StepTimelineUI parts={[commandPart()]} />
      </MantineProvider>
    )

    const runningLabel = screen.getByText(/Running/)
    const toggle = runningLabel.closest('button')
    expect(toggle).not.toBeNull()
    fireEvent.click(toggle as HTMLButtonElement)

    expect(screen.getByText('Command')).toBeTruthy()
    expect(screen.getByText('printf "hello\\n"')).toBeTruthy()
  })

  it('renders structured stdout and omits empty stderr', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            commandPart({
              state: 'result',
              result: { success: true, exitCode: 0, stdout: 'hello\n', stderr: '' },
              duration: 3_000,
            }),
          ]}
        />
      </MantineProvider>
    )

    const summary = screen.getByText(/exit 0/)
    fireEvent.click(summary.closest('button') as HTMLButtonElement)

    expect(screen.getByText('Command')).toBeTruthy()
    expect(screen.getByText('stdout')).toBeTruthy()
    expect(screen.getByText('hello')).toBeTruthy()
    expect(screen.queryByText('stderr')).toBeNull()
    expect(screen.queryByText('Arguments')).toBeNull()
    expect(screen.queryByText('Result')).toBeNull()
  })

  it('loads structured command output that was offloaded to blob storage', () => {
    useBlobMock.mockImplementation((storageKey?: string) => ({
      data:
        storageKey === 'tool-result:session-1:tool-1'
          ? JSON.stringify({ success: true, exitCode: 0, stdout: 'full stored output\n', stderr: '' })
          : undefined,
    }))

    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            commandPart({
              state: 'result',
              result: '{"success":true,"stdout":"truncated',
              resultStorageKey: 'tool-result:session-1:tool-1',
              duration: 3_000,
            }),
          ]}
        />
      </MantineProvider>
    )

    const summary = screen.getByText(/exit 0/)
    fireEvent.click(summary.closest('button') as HTMLButtonElement)

    expect(screen.getByText('full stored output')).toBeTruthy()
    expect(screen.queryByText('truncated')).toBeNull()
    expect(useBlobMock).toHaveBeenCalledWith('tool-result:session-1:tool-1')
  })

  it('renders a cancelled command as Stopped instead of Failed', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            commandPart({
              state: 'result',
              result: { success: false, exitCode: 130, stdout: '', stderr: '', cancelled: true },
              duration: 3_000,
            }),
          ]}
        />
      </MantineProvider>
    )

    expect(screen.getByText(/Stopped/)).toBeTruthy()
    expect(screen.queryByText(/Failed/)).toBeNull()
  })

  it('shows only line counts for a paused file mutation', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            commandPart({
              state: 'paused',
              toolName: 'edit_file',
              pauseReason: {
                type: 'file_mutation_approval',
                title: 'Edit config.ts',
                preview: '# Edit 1\n--- old\nsecret = old\n+++ new\nsecret = new',
              },
            }),
          ]}
        />
      </MantineProvider>
    )

    expect(screen.getByText(/Edit config\.ts/)).toBeTruthy()
    expect(screen.getByText(/\+1 -1/)).toBeTruthy()
    expect(screen.queryByText(/secret/)).toBeNull()
  })

  it('renders a cancelled non-command tool as Stopped instead of Failed', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            commandPart({
              toolName: 'read_file',
              args: { file_path: 'notes.txt' },
              state: 'error',
              result: { error: 'Tool execution stopped by user.', cancelled: true },
              duration: 3_000,
            }),
          ]}
        />
      </MantineProvider>
    )

    expect(screen.getByText(/Stopped/)).toBeTruthy()
    expect(screen.queryByText(/Failed/)).toBeNull()
  })

  it('still renders a genuine non-command tool error as Failed', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            commandPart({
              toolName: 'read_file',
              args: { file_path: 'notes.txt' },
              state: 'error',
              result: { error: 'File not found.' },
              duration: 3_000,
            }),
          ]}
        />
      </MantineProvider>
    )

    expect(screen.getByText(/Failed/)).toBeTruthy()
    expect(screen.queryByText(/Stopped/)).toBeNull()
  })
})
