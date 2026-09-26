// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { SessionMetaRecord } from '@shared/types'
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const {
  archiveSessionMock,
  countArchivedSessionsMetaMock,
  isSmallScreenMock,
  platformMock,
  restoreSessionMock,
  routerNavigateMock,
  switchCurrentSessionMock,
  toastAddMock,
  updateSessionMock,
} = vi.hoisted(() => ({
  archiveSessionMock: vi.fn(),
  countArchivedSessionsMetaMock: vi.fn(),
  isSmallScreenMock: vi.fn(() => false),
  platformMock: { type: 'desktop' },
  restoreSessionMock: vi.fn(),
  routerNavigateMock: vi.fn(),
  switchCurrentSessionMock: vi.fn(),
  toastAddMock: vi.fn(),
  updateSessionMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/ui/tooltip', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: isSmallScreenMock }))
vi.mock('@/platform', () => ({ default: platformMock }))
vi.mock('@/router', () => ({ router: { navigate: routerNavigateMock }, navigateToDynamicPath: vi.fn() }))
vi.mock('@/app/renderer-application', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/renderer-application')>()
  return {
    rendererApplication: {
      ...actual.rendererApplication,
      sessions: {
        archiveSession: archiveSessionMock,
        countArchivedSessionsMeta: countArchivedSessionsMetaMock,
        restoreSession: restoreSessionMock,
        updateSession: updateSessionMock,
      },
    },
  }
})
vi.mock('@/stores/session/crud', () => ({ switchCurrentSession: switchCurrentSessionMock }))
vi.mock('@/stores/toastActions', () => ({ add: toastAddMock }))
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

describe('SessionItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generationRuntimeStore.clear(session.id)
    resetSessionActivityStore()
    isSmallScreenMock.mockReturnValue(false)
    platformMock.type = 'desktop'
    archiveSessionMock.mockResolvedValue(undefined)
    countArchivedSessionsMetaMock.mockResolvedValue(0)
    restoreSessionMock.mockResolvedValue(undefined)
    routerNavigateMock.mockResolvedValue(undefined)
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

  test('opens the chat menu with a right click on desktop', async () => {
    renderItem()

    expect(screen.queryByRole('button', { name: 'Move to project' })).toBeNull()
    fireEvent.contextMenu(screen.getByTestId(TestId.sidebar.sessionItem))

    expect(await screen.findByText('Move to project')).toBeTruthy()
    expect(screen.getByText('Pin')).toBeTruthy()
    expect(screen.getByText('Archive')).toBeTruthy()
    expect(screen.queryByText('Adjust order')).toBeNull()
  })

  test('uses long press instead of hover actions on a wide touch screen', async () => {
    platformMock.type = 'web'
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }))
    renderItem()
    expect(screen.getByTestId(TestId.sidebar.sessionPin).parentElement?.className).not.toContain('group-hover')

    fireEvent.pointerDown(screen.getByTestId(TestId.sidebar.sessionItem), { clientX: 10, clientY: 10 })

    expect(await screen.findByText('Move to project', undefined, { timeout: 2000 })).toBeTruthy()
    expect(screen.getByText('Adjust order')).toBeTruthy()
  })

  test('opens the chat menu with a right click in a narrow window', async () => {
    isSmallScreenMock.mockReturnValue(true)
    renderItem()

    fireEvent.contextMenu(screen.getByTestId(TestId.sidebar.sessionItem))

    expect(await screen.findByText('Move to project')).toBeTruthy()
    expect(screen.getByText('Adjust order')).toBeTruthy()
  })

  test('keeps a touch long press menu open through the click that follows it', async () => {
    isSmallScreenMock.mockReturnValue(true)
    renderItem()
    const row = screen.getByTestId(TestId.sidebar.sessionItem)

    const contextMenu = createEvent.contextMenu(row)
    Object.defineProperty(contextMenu, 'pointerType', { value: 'touch' })
    fireEvent(row, contextMenu)
    fireEvent.click(row)

    expect(await screen.findByText('Move to project')).toBeTruthy()
    expect(switchCurrentSessionMock).not.toHaveBeenCalled()
  })

  test('dismisses a touch long press menu on the next tap when no click followed the press', async () => {
    renderItem()
    const row = screen.getByTestId(TestId.sidebar.sessionItem)

    const contextMenu = createEvent.contextMenu(row)
    Object.defineProperty(contextMenu, 'pointerType', { value: 'touch' })
    fireEvent(row, contextMenu)
    expect(await screen.findByText('Move to project')).toBeTruthy()

    fireEvent.pointerDown(row)
    fireEvent.click(row)
    expect(switchCurrentSessionMock).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Move to project')).toBeNull())
  })

  test('dismisses the right-click menu when its row is clicked', async () => {
    renderItem()
    const row = screen.getByTestId(TestId.sidebar.sessionItem)

    fireEvent.contextMenu(row)
    expect(await screen.findByText('Move to project')).toBeTruthy()

    fireEvent.click(row)
    expect(switchCurrentSessionMock).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Move to project')).toBeNull())

    fireEvent.click(row)
    expect(switchCurrentSessionMock).toHaveBeenCalledWith(session.id)
  })

  test('keeps the native edit menu while renaming on desktop', () => {
    renderItem()
    fireEvent.doubleClick(screen.getByTestId(TestId.sidebar.sessionTitle))
    const input = screen.getByRole('textbox', { name: 'Name' })

    expect(fireEvent.contextMenu(input)).toBe(true)
    expect(screen.queryByText('Move to project')).toBeNull()
  })

  test('leaves project moves out of a pinned chat menu', async () => {
    render(
      <MantineProvider>
        <SessionItem session={{ ...session, starred: true, folderId: 'work' }} selected />
      </MantineProvider>
    )

    fireEvent.contextMenu(screen.getByTestId(TestId.sidebar.sessionItem))

    expect(await screen.findByText('Unpin')).toBeTruthy()
    expect(screen.queryByText('Move to project')).toBeNull()
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

  test('does not show waiting for a paused runtime without the persisted flag', () => {
    // A paused runtime can belong to an inactive fork branch with nothing to
    // act on; only the persisted hasPausedToolCall projection marks waiting.
    const runtime = generationRuntimeStore.start(session.id, 'reply-1')
    generationRuntimeStore.setPhase(session.id, runtime.messageId, 'paused', runtime)
    const view = renderItem(false)

    expect(screen.queryByRole('status', { name: 'Waiting for you...' })).toBeNull()
    view.unmount()
  })


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

  test('shows the switch shortcut digit instead of the row actions while the list peeks', () => {
    const view = render(
      <MantineProvider>
        <SessionItem session={session} selected={false} switchShortcutDigit={3} />
      </MantineProvider>
    )

    const hint = screen.getByTestId(TestId.sidebar.sessionSwitchHint)
    expect(hint.textContent).toContain('3')
    // The key takes the hover actions' place, so the row never shows both.
    expect(screen.getByTestId(TestId.sidebar.sessionPin).closest('div')?.className).toContain('hidden')

    view.rerender(
      <MantineProvider>
        <SessionItem session={session} selected={false} />
      </MantineProvider>
    )
    expect(screen.queryByTestId(TestId.sidebar.sessionSwitchHint)).toBeNull()
    expect(screen.getByTestId(TestId.sidebar.sessionPin).closest('div')?.className).toContain(
      'group-hover/session-item:flex'
    )
  })

  test('shows generation and unread completion activity', () => {
    const runtime = generationRuntimeStore.start(session.id, 'reply-1')
    const view = renderItem(false)

    expect(screen.getByRole('status', { name: 'Generating...' })).toBeTruthy()

    act(() => {
      generationRuntimeStore.finishActive(session.id, runtime.messageId, runtime)
      sessionActivityStore.setState({ unreadSessionIds: { [session.id]: 'completed' } })
    })

    expect(screen.getByRole('status', { name: 'Completed' })).toBeTruthy()
    // The dot alone marks an unread completion; the title keeps its default weight.
    expect(screen.getByTestId(TestId.sidebar.sessionTitle).style.fontWeight).toBe('')
    view.unmount()
  })

  test('shows unread failure activity as a status dot', () => {
    sessionActivityStore.setState({ unreadSessionIds: { [session.id]: 'failed' } })
    const view = renderItem(false)

    expect(screen.getByRole('status', { name: 'Failed' })).toBeTruthy()
    view.unmount()
  })

  test('shows waiting activity for a persisted paused tool call', () => {
    render(
      <MantineProvider>
        <SessionItem session={{ ...session, hasPausedToolCall: true }} selected={false} />
      </MantineProvider>
    )

    expect(screen.getByRole('status', { name: 'Waiting for you...' })).toBeTruthy()
    // The clock icon alone marks the waiting state; the title keeps its default weight.
    expect(screen.getByTestId(TestId.sidebar.sessionTitle).style.fontWeight).toBe('')
  })

  test('always offers undo after archiving and offers to open the restored chat', async () => {
    renderItem(false)

    fireEvent.click(screen.getByTestId(TestId.sidebar.sessionArchive))

    await waitFor(() => expect(archiveSessionMock).toHaveBeenCalledWith(session.id))
    await waitFor(() =>
      expect(toastAddMock).toHaveBeenCalledWith(
        'Archived. Manage archived chats in Settings.',
        8000,
        expect.objectContaining({ label: 'Undo', onClick: expect.any(Function) })
      )
    )

    const undoAction = toastAddMock.mock.calls[0]?.[2] as { onClick?: () => void }
    undoAction.onClick?.()

    await waitFor(() => expect(restoreSessionMock).toHaveBeenCalledWith(session.id))
    await waitFor(() =>
      expect(toastAddMock).toHaveBeenCalledWith(
        'Chat restored',
        5000,
        expect.objectContaining({ label: 'Open', onClick: expect.any(Function) })
      )
    )

    const openAction = toastAddMock.mock.calls[1]?.[2] as { onClick?: () => void }
    openAction.onClick?.()
    expect(switchCurrentSessionMock).toHaveBeenCalledWith(session.id)
  })

  test('keeps the undo action when the cleanup check fails after a successful archive', async () => {
    const cleanupError = new Error('count failed')
    countArchivedSessionsMetaMock.mockRejectedValueOnce(cleanupError)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderItem(false)

    fireEvent.click(screen.getByTestId(TestId.sidebar.sessionArchive))

    await waitFor(() => expect(countArchivedSessionsMetaMock).toHaveBeenCalledOnce())
    expect(toastAddMock).toHaveBeenCalledWith(
      'Archived. Manage archived chats in Settings.',
      8000,
      expect.objectContaining({ label: 'Undo' })
    )
    expect(toastAddMock).not.toHaveBeenCalledWith('Failed to archive chat. Please try again.')
    expect(consoleError).toHaveBeenCalledWith('Failed to check archived session cleanup:', cleanupError)
    consoleError.mockRestore()
  })

  test('offers retry when undo cannot restore the chat on the first attempt', async () => {
    restoreSessionMock.mockRejectedValueOnce(new Error('restore failed')).mockResolvedValueOnce(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderItem(false)

    fireEvent.click(screen.getByTestId(TestId.sidebar.sessionArchive))
    await waitFor(() => expect(toastAddMock).toHaveBeenCalledWith(expect.any(String), 8000, expect.anything()))
    const undoAction = toastAddMock.mock.calls[0]?.[2] as { onClick?: () => void }
    undoAction.onClick?.()

    await waitFor(() =>
      expect(toastAddMock).toHaveBeenCalledWith(
        'Failed to restore chat. Please try again.',
        8000,
        expect.objectContaining({ label: 'Retry', onClick: expect.any(Function) })
      )
    )
    const retryCall = toastAddMock.mock.calls.find(
      ([content]) => content === 'Failed to restore chat. Please try again.'
    )
    const retryAction = retryCall?.[2] as { onClick?: () => void }
    retryAction.onClick?.()

    await waitFor(() => expect(restoreSessionMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(toastAddMock).toHaveBeenCalledWith('Chat restored', 5000, expect.anything()))
    consoleError.mockRestore()
  })

  test('reports archive failures without offering undo', async () => {
    const archiveError = new Error('archive failed')
    archiveSessionMock.mockRejectedValueOnce(archiveError)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderItem(false)

    fireEvent.click(screen.getByTestId(TestId.sidebar.sessionArchive))

    await waitFor(() => expect(toastAddMock).toHaveBeenCalledWith('Failed to archive chat. Please try again.'))
    expect(toastAddMock).not.toHaveBeenCalledWith(
      'Archived. Manage archived chats in Settings.',
      8000,
      expect.anything()
    )
    expect(countArchivedSessionsMetaMock).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('Failed to archive session:', archiveError)
    consoleError.mockRestore()
  })
})
