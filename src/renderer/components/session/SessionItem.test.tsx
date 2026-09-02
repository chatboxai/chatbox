// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { SessionMetaRecord } from '@shared/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { isSmallScreenMock, platformMock, switchCurrentSessionMock, updateSessionMock } = vi.hoisted(() => ({
  isSmallScreenMock: vi.fn(() => false),
  platformMock: { type: 'desktop' },
  switchCurrentSessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/ui/tooltip', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: isSmallScreenMock }))
vi.mock('@/platform', () => ({ default: platformMock }))
vi.mock('@/router', () => ({ router: { navigate: vi.fn() }, navigateToDynamicPath: vi.fn() }))
vi.mock('@/app/renderer-application', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/renderer-application')>()
  return {
    rendererApplication: {
      ...actual.rendererApplication,
      sessions: {
        archiveSession: vi.fn(),
        countArchivedSessionsMeta: vi.fn(),
        updateSession: updateSessionMock,
      },
    },
  }
})
vi.mock('@/stores/session/crud', () => ({ switchCurrentSession: switchCurrentSessionMock }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: { setShowSidebar: () => void }) => unknown) => selector({ setShowSidebar: vi.fn() }),
}))

import { rendererApplication } from '@/app/renderer-application'
import { resetSessionActivityStore, sessionActivityStore } from '@/stores/sessionActivityStore'
import SessionItem from './SessionItem'

const generationRuntimeStore = rendererApplication.generationRuntime

const session: SessionMetaRecord = {
  id: 'session-1',
  name: 'Original name',
  sortOrder: 1,
  createdAt: Date.now(),
}

function renderItem(selected = true) {
  return render(
    <MantineProvider>
      <SessionItem session={session} selected={selected} />
    </MantineProvider>
  )
}

describe('SessionItem inline rename', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generationRuntimeStore.clear(session.id)
    resetSessionActivityStore()
    isSmallScreenMock.mockReturnValue(false)
    platformMock.type = 'desktop'
    updateSessionMock.mockResolvedValue(undefined)
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
        dispatchEvent: vi.fn(() => false),
      })),
    })
  })

  test.each(['desktop', 'web'] as const)(
    'double-clicks the title to edit and saves a trimmed name with Enter on %s',
    (platformType) => {
      platformMock.type = platformType
      renderItem()

      fireEvent.doubleClick(screen.getByTestId(TestId.sidebar.sessionTitle))
      const input = screen.getByRole('textbox', { name: 'Name' })
      expect(input).toHaveProperty('value', 'Original name')

      fireEvent.change(input, { target: { value: '  Renamed session  ' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(updateSessionMock).toHaveBeenCalledWith('session-1', { name: 'Renamed session' })
      expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    }
  )

  test('saves on blur', () => {
    renderItem()

    fireEvent.doubleClick(screen.getByTestId(TestId.sidebar.sessionTitle))
    const input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'Blurred name' } })
    fireEvent.blur(input)

    expect(updateSessionMock).toHaveBeenCalledWith('session-1', { name: 'Blurred name' })
  })

  test('cancels with Escape and ignores an empty name', () => {
    const view = renderItem()

    fireEvent.doubleClick(screen.getByTestId(TestId.sidebar.sessionTitle))
    const escapeInput = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(escapeInput, { target: { value: 'Discard me' } })
    fireEvent.keyDown(escapeInput, { key: 'Escape' })
    expect(updateSessionMock).not.toHaveBeenCalled()

    view.unmount()
    renderItem()
    fireEvent.doubleClick(screen.getByTestId(TestId.sidebar.sessionTitle))
    const emptyInput = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(emptyInput, { target: { value: '   ' } })
    fireEvent.blur(emptyInput)
    expect(updateSessionMock).not.toHaveBeenCalled()
  })

  test('does not enable inline rename in the small-screen/mobile interaction mode', () => {
    isSmallScreenMock.mockReturnValue(true)
    renderItem()

    fireEvent.doubleClick(screen.getByTestId(TestId.sidebar.sessionTitle))

    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })

  test('removes the right margin only on desktop', () => {
    const desktopView = renderItem()
    expect(screen.getByTestId(TestId.sidebar.sessionItem).style.marginRight).toBe('0rem')
    desktopView.unmount()

    isSmallScreenMock.mockReturnValue(true)
    renderItem()
    expect(screen.getByTestId(TestId.sidebar.sessionItem).style.marginRight).toBe('var(--mantine-spacing-xs)')
  })

  test('switches a non-current session before allowing a later double-click to rename it', () => {
    const view = renderItem(false)
    const title = screen.getByTestId(TestId.sidebar.sessionTitle)

    fireEvent.mouseDown(title, { detail: 1 })
    fireEvent.click(title)
    view.rerender(
      <MantineProvider>
        <SessionItem session={session} selected />
      </MantineProvider>
    )
    fireEvent.doubleClick(screen.getByTestId(TestId.sidebar.sessionTitle))

    expect(switchCurrentSessionMock).toHaveBeenCalledWith('session-1')
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()

    const selectedTitle = screen.getByTestId(TestId.sidebar.sessionTitle)
    fireEvent.mouseDown(selectedTitle, { detail: 1 })
    fireEvent.doubleClick(selectedTitle)

    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy()
  })

  test('shows generation and unread completion activity', () => {
    const runtime = generationRuntimeStore.start(session.id, 'reply-1')
    const view = renderItem(false)

    expect(screen.getByRole('status', { name: 'Generating...' })).toBeTruthy()

    act(() => {
      generationRuntimeStore.finishActive(session.id, runtime.messageId, runtime)
      sessionActivityStore.setState({ unreadCompletedSessionIds: { [session.id]: true } })
    })

    expect(screen.getByRole('status', { name: 'Completed' })).toBeTruthy()
    view.unmount()
  })
})
