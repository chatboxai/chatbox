// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { MessageToolCallPart } from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { useImageGenerationRecordsMock } = vi.hoisted(() => ({ useImageGenerationRecordsMock: vi.fn() }))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/components/chat/ImageGenerationResultGallery', () => ({
  ImageGenerationResultGallery: ({ images }: { images: readonly string[] }) =>
    images.length > 0 ? <div data-testid="picture-gallery">{images.join(',')}</div> : null,
}))

vi.mock('@/components/common/ChatboxAIErrorMessage', () => ({
  ChatboxAIErrorMessage: () => null,
}))

vi.mock('@/platform', () => ({
  default: {
    appLog: vi.fn().mockResolvedValue(undefined),
    openLink: vi.fn(),
  },
}))

vi.mock('@/stores/imageGenerationStore', () => ({
  useCurrentGeneratingId: () => null,
  useImageGenerationRecord: () => ({ data: undefined, isFetched: true }),
  useImageGenerationRecords: useImageGenerationRecordsMock,
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

import { MessageArtifactsUI } from './ToolCallPartUI'

const imageToolCallPart: MessageToolCallPart = {
  type: 'tool-call',
  state: 'result',
  toolCallId: 'tool-image',
  toolName: 'chatbox_cli',
  args: { command: 'image generate' },
  result: {
    ok: true,
    command: 'image generate',
    accepted: true,
    background: true,
    recordId: 'record-1',
    status: 'pending',
    startedAt: 1,
    wait: { mode: 'callback', managedBy: 'chatbox', modelShouldPoll: false },
  },
}

describe('generated images in the artifacts area', () => {
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

  afterEach(cleanup)

  function renderArtifacts() {
    return render(
      <MantineProvider>
        <MessageArtifactsUI imageParts={[imageToolCallPart]} downloadParts={[]} sessionId="s1" messageId="m1" />
      </MantineProvider>
    )
  }

  it('shows the generated images of an image generation tool call', () => {
    useImageGenerationRecordsMock.mockReturnValue([{ generatedImages: ['key-1', 'key-2'] }])

    renderArtifacts()

    expect(screen.getByText('Artifacts')).toBeTruthy()
    expect(screen.getByTestId('picture-gallery').textContent).toBe('key-1,key-2')
  })

  it('stays hidden while the image record has no result yet', () => {
    useImageGenerationRecordsMock.mockReturnValue([null])

    renderArtifacts()

    expect(screen.queryByText('Artifacts')).toBeNull()
    expect(screen.queryByTestId('picture-gallery')).toBeNull()
  })
})
