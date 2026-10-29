// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { Message, MessageContentParts, MessageTextPart, MessageToolCallPart } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('i18next')>()),
  t: (key: string) => key,
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => key.replace('{{count}}', String(options?.count ?? '')),
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

import { type StepTimelinePart, StepTimelineUI } from './StepTimelineUI'

type MessageTimelinePart = MessageContentParts[number]

function toolCall(overrides: Partial<MessageToolCallPart> = {}): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'call-1',
    toolName: 'read_file',
    args: { path: 'src/a.ts' },
    result: { content: 'file body' },
    ...overrides,
  }
}

function narration(text: string): MessageTextPart {
  return { type: 'text', text }
}

/** The owning message, so the timeline can see past the display group it renders. */
function owningMessage(contentParts: MessageContentParts): Message {
  return { id: 'msg-1', role: 'assistant', contentParts } as Message
}

describe('StepTimelineUI folded runs', () => {
  it('does not transfer an expanded run to different tool calls at the same position', () => {
    const view = (ids: string[]) => (
      <MantineProvider>
        <StepTimelineUI parts={ids.map((toolCallId) => toolCall({ toolCallId }))} />
      </MantineProvider>
    )
    const { rerender } = render(view(['a', 'b']))
    fireEvent.click(screen.getByText('Read 2 files'))
    expect(screen.getAllByText('Read File')).toHaveLength(2)
    rerender(view(['c', 'd']))
    expect(screen.queryByText('Read File')).toBeNull()
    expect(screen.getByText('Read 2 files').closest('button')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('preserves an expanded run when narration is inserted before it', () => {
    const parts = [toolCall({ toolCallId: 'a' }), toolCall({ toolCallId: 'b' })]
    const view = (steps: StepTimelinePart[]) => (
      <MantineProvider>
        <StepTimelineUI parts={steps} />
      </MantineProvider>
    )
    const { rerender } = render(view(parts))
    fireEvent.click(screen.getByText('Read 2 files'))
    rerender(view([narration('Inspect the files.'), ...parts]))
    expect(screen.getAllByText('Read File')).toHaveLength(2)
  })

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

  it('shows one summary row for a settled run and unfolds it on demand', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[toolCall({ toolCallId: 'call-1' }), toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' } })]}
        />
      </MantineProvider>
    )

    expect(screen.queryByText('Read File')).toBeNull()
    const summary = screen.getByText('Read 2 files')

    fireEvent.click(summary)

    expect(screen.getAllByText('Read File')).toHaveLength(2)
  })

  it('keeps a run that reached every action on one line', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            toolCall({ toolCallId: 'call-1' }),
            toolCall({ toolCallId: 'call-2', toolName: 'search_file_content', args: { query: 'fold' } }),
            toolCall({
              toolCallId: 'call-3',
              toolName: 'run_command',
              args: { command: 'pnpm test' },
              result: { exitCode: 0 },
            }),
            toolCall({ toolCallId: 'call-4', toolName: 'edit_file', args: { path: 'src/a.ts' } }),
            toolCall({ toolCallId: 'call-5', toolName: 'web_search', args: { query: 'vitest jsdom' } }),
            toolCall({ toolCallId: 'call-6', toolName: 'parse_link', args: { url: 'https://example.com' } }),
          ]}
        />
      </MantineProvider>
    )

    expect(screen.getByText('Read a file, searched files, ran a command, edited a file, and 2 more')).not.toBeNull()
  })

  it('marks every row with a bare icon and no status disc', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            toolCall({ toolCallId: 'call-1' }),
            toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' } }),
            narration('Now check the tests.'),
            toolCall({
              toolCallId: 'call-3',
              toolName: 'run_command',
              args: { command: 'pnpm test' },
              result: { exitCode: 0 },
            }),
          ]}
        />
      </MantineProvider>
    )

    // The rail and its filled status nodes are gone: an icon sits on the row's own
    // surface, so a settled step never paints a marker-shaped patch behind itself.
    const icons = Array.from(document.querySelectorAll('[data-timeline-step-icon]')) as HTMLElement[]
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) {
      expect(icon.style.backgroundColor).toBe('')
      expect(icon.style.borderRadius).toBe('')
    }
  })

  it('keeps a settled step grey and colors only the one that needs the user', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            toolCall({ toolCallId: 'call-1' }),
            toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' } }),
            toolCall({ toolCallId: 'call-3', state: 'paused', args: { path: 'src/c.ts' } }),
          ]}
        />
      </MantineProvider>
    )

    const icons = Array.from(document.querySelectorAll('[data-timeline-step-icon]')) as HTMLElement[]
    const colors = icons.map((icon) => icon.style.color)
    expect(colors).toContain('var(--chatbox-tint-warning)')
    expect(colors.filter((color) => color === 'var(--chatbox-tint-tertiary)').length).toBeGreaterThan(0)
  })

  it('hangs the unfolded steps under the summary row in an indented group', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[toolCall({ toolCallId: 'call-1' }), toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' } })]}
        />
      </MantineProvider>
    )

    fireEvent.click(screen.getByText('Read 2 files'))

    const group = document.querySelector('[data-timeline-group="fold"]') as HTMLElement | null
    expect(group).not.toBeNull()

    const summary = screen.getByText('Read 2 files')
    // The steps belong to the summary row rather than standing beside it, and the
    // group marks them as a list with an indent instead of their own rail markers.
    expect(group?.parentElement?.contains(summary)).toBe(true)
    expect(group?.style.borderLeft).toContain('1px solid color-mix')
    expect(Number.parseFloat(group?.style.paddingLeft ?? '0')).toBeGreaterThan(0)
    for (const row of screen.getAllByText('Read File')) {
      expect(group?.contains(row)).toBe(true)
    }
  })

  it('shows how long the folded run took', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            toolCall({ toolCallId: 'call-1', duration: 4100 }),
            toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' }, duration: 5000 }),
          ]}
        />
      </MantineProvider>
    )

    expect(screen.getByText('9.1s')).toBeTruthy()
  })

  it('leaves the duration out for a run that finished instantly', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            toolCall({ toolCallId: 'call-1', duration: 300 }),
            toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' }, duration: 500 }),
          ]}
        />
      </MantineProvider>
    )

    expect(screen.queryByText('0.8s')).toBeNull()
  })

  it('reads the running step at full strength, like the one waiting on the user', () => {
    const labelWeight = (part: MessageToolCallPart) => {
      const view = render(
        <MantineProvider>
          <StepTimelineUI parts={[part]} />
        </MantineProvider>
      )
      const weight = screen.getByText('Read File').style.fontWeight
      view.unmount()
      return weight
    }

    // A settled step stays quiet; the step the user is waiting on stands out.
    expect(labelWeight(toolCall())).toBe('')
    expect(labelWeight(toolCall({ state: 'call' }))).toBe('500')
  })

  it('names an approval pause in the summary, leaving the wait to the approval card', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            toolCall({
              toolCallId: 'call-1',
              state: 'paused',
              toolName: 'run_command',
              args: { command: 'rm -rf build' },
              pauseReason: { type: 'user_exec_approval', command: 'rm -rf build' },
            }),
          ]}
        />
      </MantineProvider>
    )

    expect(screen.getByText('Paused')).toBeTruthy()
  })

  it('keeps the disclosure arrow on screen where there is no hover to reveal it', () => {
    render(
      <MantineProvider>
        <StepTimelineUI parts={[toolCall()]} />
      </MantineProvider>
    )

    const arrows = Array.from(document.querySelectorAll('span')).filter((el) => el.className.includes('hover:none'))
    expect(arrows.length).toBeGreaterThan(0)
    // Revealed on hover where a pointer can hover, and standing there on its own where none can.
    expect(arrows[0]?.className).toContain('group-hover:opacity-100')
    expect(arrows[0]?.className).toContain('group-focus-visible:opacity-100')
  })

  it('shows a running step beside the folded work that came before it', () => {
    render(
      <MantineProvider>
        <StepTimelineUI
          parts={[
            toolCall({ toolCallId: 'call-1' }),
            toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' } }),
            toolCall({ toolCallId: 'call-3', state: 'call', args: { path: 'src/c.ts' } }),
          ]}
        />
      </MantineProvider>
    )

    // What ran already folds away; what is running right now stays on its own row.
    expect(screen.getByText('Read 2 files')).toBeTruthy()
    expect(screen.getAllByText('Read File')).toHaveLength(1)
    expect(screen.getByText('Running')).toBeTruthy()
  })

  it('folds a stopped step the message carried on past, even in the group that ends on it', () => {
    const stopped = toolCall({
      toolCallId: 'call-2',
      toolName: 'run_command',
      args: { command: 'pnpm test' },
      result: { success: false, exitCode: 130, cancelled: true },
    })
    const group: MessageToolCallPart[] = [toolCall({ toolCallId: 'call-1', args: { path: 'src/a.ts' } }), stopped]
    const messageParts: MessageTimelinePart[] = [
      ...group,
      { type: 'image', storageKey: 'img-1' },
      toolCall({ toolCallId: 'call-3', args: { path: 'src/c.ts' } }),
      toolCall({ toolCallId: 'call-4', args: { path: 'src/d.ts' } }),
    ]

    render(
      <MantineProvider>
        <StepTimelineUI parts={group} message={owningMessage(messageParts)} />
      </MantineProvider>
    )

    // The message carried on past the stopped command, so the group folds into one
    // settled row instead of surfacing a step that no longer ends the run.
    expect(screen.getByText('Read a file, ran a command')).toBeTruthy()
    expect(screen.queryByText('Stopped')).toBeNull()
    expect(screen.queryByText('pnpm test')).toBeNull()
  })

  it('keeps the stopped step the message ended on beside the run it sits in', () => {
    const stopped = toolCall({
      toolCallId: 'call-3',
      toolName: 'run_command',
      args: { command: 'pnpm test' },
      result: { success: false, exitCode: 130, cancelled: true },
    })
    const messageParts = [
      toolCall({ toolCallId: 'call-1', args: { path: 'src/a.ts' } }),
      toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' } }),
      stopped,
    ] satisfies MessageContentParts

    render(
      <MantineProvider>
        <StepTimelineUI parts={messageParts} message={owningMessage(messageParts)} />
      </MantineProvider>
    )

    // The two reads and the stopped command stay in one run, so the stopped step is
    // still the one the message ended on and stands beside the fold as its own row.
    expect(screen.getByText('Read 2 files')).toBeTruthy()
    expect(screen.getByText('Run Command')).toBeTruthy()
    expect(screen.getByText('Stopped')).toBeTruthy()
    expect(screen.getByText('pnpm test', { exact: false })).toBeTruthy()
  })
})
