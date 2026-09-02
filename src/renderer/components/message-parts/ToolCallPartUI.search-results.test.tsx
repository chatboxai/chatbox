// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { MessageToolCallPart } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/hooks/useBlob', () => ({ useBlob: () => ({ data: undefined }) }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: vi.fn() }))

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

import { StepTimelineUI, ToolCallPartUI } from './ToolCallPartUI'

const LONG_LINK =
  'https://example.com/docs/very-long-path/that-has-no-spaces-and-would-overflow-the-viewport-if-the-card-grew-with-its-content?token=abcdefghijklmnopqrstuvwxyz0123456789'

function webSearchPart(overrides: Partial<MessageToolCallPart> = {}): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'search-1',
    toolName: 'web_search',
    args: { query: 'token refresh best practices' },
    result: {
      query: 'token refresh best practices',
      searchResults: [
        {
          title: 'OAuth token refresh patterns with an extremely long title that should stay inside the card',
          snippet: 'How to rotate refresh tokens…',
          link: LONG_LINK,
        },
      ],
    },
    ...overrides,
  }
}

function parseLinkPart(): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'parse-1',
    toolName: 'parse_link',
    args: { url: LONG_LINK },
    result: {
      url: LONG_LINK,
      title: 'OAuth token refresh patterns',
      content: `Parsed page that also contains ${LONG_LINK} inline.`,
    },
  }
}

function expandByLabel(label: RegExp | string) {
  const toggle = screen.getByText(label).closest('button')
  expect(toggle).not.toBeNull()
  fireEvent.click(toggle as HTMLButtonElement)
}

describe('tool call search result overflow', () => {
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
  })
  afterEach(cleanup)

  it('keeps long search result links inside a fixed-width card', () => {
    render(
      <MantineProvider>
        <ToolCallPartUI part={webSearchPart()} />
      </MantineProvider>
    )

    expandByLabel('web_search')

    const link = screen.getByRole('link', { name: /OAuth token refresh patterns/ })
    expect(link.getAttribute('href')).toBe(LONG_LINK)
    expect(link.getAttribute('style')).toContain('min-width: 0')
    expect(link.getAttribute('style')).toContain('max-width:')

    const card = link.firstElementChild as HTMLElement
    expect(card.getAttribute('style')).toContain('min-width: 0')
    expect(card.getAttribute('style')).toContain('overflow: hidden')
    expect(card.getAttribute('style')).toContain('max-width:')
    expect(link.parentElement?.className).toContain('min-w-0')
    expect(link.parentElement?.className).toContain('max-w-full')
    expect(link.parentElement?.className).toContain('overflow-x-auto')
  })

  it('wraps a long parsed-link URL instead of overflowing the details pane', () => {
    render(
      <MantineProvider>
        <ToolCallPartUI part={parseLinkPart()} />
      </MantineProvider>
    )

    expandByLabel('parse_link')

    const url = screen.getByText(LONG_LINK)
    expect(url.getAttribute('style')).toContain('overflow-wrap: anywhere')
  })

  it('keeps timeline search result cards constrained after expand', () => {
    render(
      <MantineProvider>
        <StepTimelineUI parts={[webSearchPart({ duration: 3_000 })]} />
      </MantineProvider>
    )

    expandByLabel('web_search')

    const link = screen.getByRole('link', { name: /OAuth token refresh patterns/ })
    expect(link.getAttribute('href')).toBe(LONG_LINK)
    expect(link.getAttribute('style')).toContain('min-width: 0')
    expect(link.parentElement?.className).toContain('min-w-0')
    expect(link.parentElement?.className).toContain('overflow-x-auto')
  })

  it('wraps long URLs in generic tool-call arguments and results', () => {
    render(
      <MantineProvider>
        <ToolCallPartUI
          part={{
            type: 'tool-call',
            state: 'result',
            toolCallId: 'kb-1',
            toolName: 'query_knowledge_base',
            args: { query: LONG_LINK },
            result: { snippet: `See ${LONG_LINK}` },
          }}
        />
      </MantineProvider>
    )

    expandByLabel('query_knowledge_base')

    const blocks = Array.from(document.querySelectorAll('pre, code'))
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    for (const block of blocks) {
      expect(block.getAttribute('style') ?? block.parentElement?.getAttribute('style')).toContain(
        'overflow-wrap: anywhere'
      )
    }
    expect(screen.getAllByText(new RegExp(LONG_LINK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).length).toBe(2)
  })

  it('wraps a long URL in tool-call error text', () => {
    render(
      <MantineProvider>
        <ToolCallPartUI
          part={{
            type: 'tool-call',
            state: 'error',
            toolCallId: 'err-1',
            toolName: 'read_file',
            args: { path: '/tmp/report.txt' },
            result: { error: `Failed to fetch ${LONG_LINK}` },
          }}
        />
      </MantineProvider>
    )

    expandByLabel('read_file')

    const error = screen.getByText(`Failed to fetch ${LONG_LINK}`)
    expect(error.getAttribute('style')).toContain('overflow-wrap: anywhere')
  })

  it('wraps a long URL in reasoning details', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            {
              type: 'reasoning',
              text: `I should open ${LONG_LINK} next.`,
              duration: 3_000,
            },
          ]}
        />
      </MantineProvider>
    )

    expandByLabel('Deeply thought')

    const reasoning = screen.getByText(`I should open ${LONG_LINK} next.`)
    expect(reasoning.getAttribute('style')).toContain('overflow-wrap: anywhere')
  })

  it('expands actionable Web Search guidance without another click', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            webSearchPart({
              state: 'error',
              result: { error: 'chatbox_search_license_key_required', errorCode: 20024 },
            }),
          ]}
        />
      </MantineProvider>
    )

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('Web Search was not run: sign in to use Chatbox AI Search')).toBeTruthy()
  })
})
