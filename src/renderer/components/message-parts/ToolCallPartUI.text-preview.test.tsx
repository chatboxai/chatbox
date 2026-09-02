// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { MessageToolCallPart } from '@shared/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { useBlobMock, niceModalShowMock, platformMock } = vi.hoisted(() => ({
  useBlobMock: vi.fn(),
  niceModalShowMock: vi.fn(),
  platformMock: {
    sandboxReadFileBase64: vi.fn(),
    appLog: vi.fn().mockResolvedValue(undefined),
    openLink: vi.fn(),
  },
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

vi.mock('@/hooks/useBlob', () => ({ useBlob: useBlobMock }))

vi.mock('@ebay/nice-modal-react', () => ({
  default: { show: niceModalShowMock },
}))

vi.mock('@/platform', () => ({ default: platformMock }))

vi.mock('@/stores/imageGenerationStore', () => ({
  useCurrentGeneratingId: () => null,
  useImageGenerationRecord: () => ({ data: undefined, isFetched: true }),
  useImageGenerationRecords: () => [],
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

function downloadPart(filePath: string): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'tool-1',
    toolName: 'create_download',
    args: { file_path: filePath },
    result: { file_path: filePath, downloadable: true },
    startTime: Date.now() - 3_000,
    duration: 500,
  }
}

const SANDBOX_PATH = '/tmp/chatbox-sandbox/session-1/notes.md'

describe('text file preview for create_download', () => {
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
    platformMock.sandboxReadFileBase64.mockResolvedValue({
      success: true,
      base64: Buffer.from('# Hello\n\nWorld').toString('base64'),
    })
  })

  afterEach(cleanup)

  function renderDownload(path: string) {
    return render(
      <MantineProvider>
        <MessageArtifactsUI imageParts={[]} downloadParts={[downloadPart(path)]} sessionId="s1" messageId="m1" />
      </MantineProvider>
    )
  }

  it('shows a Preview button for a text file', () => {
    renderDownload(SANDBOX_PATH)

    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(screen.getByText('notes.md')).toBeTruthy()
  })

  it('does not show a Preview button for an unknown extension', () => {
    renderDownload('/tmp/chatbox-sandbox/session-1/archive.7z')

    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
  })

  it('opens the content viewer with decoded text when clicked', async () => {
    renderDownload(SANDBOX_PATH)

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(platformMock.sandboxReadFileBase64).toHaveBeenCalledWith({
        filePath: SANDBOX_PATH,
        maxBytes: 2 * 1024 * 1024,
      })
      expect(niceModalShowMock).toHaveBeenCalledWith('content-viewer', {
        title: 'notes.md',
        content: '# Hello\n\nWorld',
      })
    })
  })

  it('shows an error when the file cannot be read', async () => {
    platformMock.sandboxReadFileBase64.mockResolvedValue({ success: false, error: 'File is too large' })

    renderDownload(SANDBOX_PATH)

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(screen.getByText('File is too large')).toBeTruthy()
    })
  })

  it('opens the content viewer with empty content for a zero-byte file', async () => {
    platformMock.sandboxReadFileBase64.mockResolvedValue({ success: true, base64: '' })

    renderDownload(SANDBOX_PATH)

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(niceModalShowMock).toHaveBeenCalledWith('content-viewer', {
        title: 'notes.md',
        content: '',
      })
    })
  })

  it('opens the artifact preview for a zero-byte HTML file', async () => {
    const htmlPath = '/tmp/chatbox-sandbox/session-1/page.html'
    platformMock.sandboxReadFileBase64.mockResolvedValue({ success: true, base64: '' })

    renderDownload(htmlPath)

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(platformMock.sandboxReadFileBase64).toHaveBeenCalledWith({ filePath: htmlPath })
      expect(niceModalShowMock).toHaveBeenCalledWith(
        'artifact-preview',
        expect.objectContaining({
          htmlCode: '',
          sessionId: 's1',
        })
      )
    })
  })
})
