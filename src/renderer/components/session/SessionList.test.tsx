// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { SessionFolder, SessionMetaRecord } from '@shared/types'
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type DndContextHandlers = {
  onDragStart?: (event: { active: { id: string } }) => void
  onDragEnd?: (event: { active: { id: string }; over: { id: string } | null }) => Promise<void>
}

const {
  dndContextState,
  isSmallScreenMock,
  platformMock,
  moveSessionToFolderMock,
  reorderSessionsMock,
  sessionListState,
  showModalMock,
  sortablePointerDownMock,
  useSortableMock,
} = vi.hoisted(() => ({
  dndContextState: { handlers: null as DndContextHandlers | null },
  isSmallScreenMock: vi.fn(() => true),
  platformMock: { type: 'mobile' },
  moveSessionToFolderMock: vi.fn(),
  reorderSessionsMock: vi.fn(),
  sessionListState: {
    sessions: [] as SessionMetaRecord[] | undefined,
    isLoading: false,
    folders: [] as SessionFolder[],
    hasNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
  },
  showModalMock: vi.fn(),
  sortablePointerDownMock: vi.fn(),
  useSortableMock: vi.fn(),
}))

vi.mock('@ebay/nice-modal-react', () => ({
  default: { show: showModalMock },
}))

vi.mock('../ActionMenu', async () => {
  const React = await import('react')
  type Item = { text?: string; testId?: string; onClick?: () => void }
  return {
    default: ({ children, items, opened }: { children: React.ReactNode; items: Item[]; opened?: boolean }) =>
      React.createElement(
        React.Fragment,
        null,
        children,
        opened !== false &&
          items.map((item) =>
            React.createElement(
              'button',
              { key: item.text, 'data-testid': item.testId, onClick: item.onClick, type: 'button' },
              item.text
            )
          )
      ),
  }
})

vi.mock('@dnd-kit/core', async () => {
  const React = await import('react')
  return {
    closestCenter: vi.fn(),
    DndContext: ({ children, ...handlers }: { children: React.ReactNode } & DndContextHandlers) => {
      dndContextState.handlers = handlers
      return React.createElement(React.Fragment, null, children)
    },
    DragOverlay: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'drag-overlay' }, children),
    KeyboardSensor: 'KeyboardSensor',
    MouseSensor: 'MouseSensor',
    TouchSensor: 'TouchSensor',
    useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
    useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
    useSensors: (...sensors: unknown[]) => sensors,
  }
})

vi.mock('@dnd-kit/sortable', async () => {
  const React = await import('react')
  return {
    SortableContext: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    sortableKeyboardCoordinates: vi.fn(),
    useSortable: useSortableMock,
    verticalListSortingStrategy: {},
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  type VirtuosoProps = {
    groupCounts: number[]
    groupContent: (index: number) => React.ReactNode
    itemContent: (index: number, groupIndex: number) => React.ReactNode
  }
  return {
    GroupedVirtuoso: ({ groupCounts, groupContent, itemContent }: VirtuosoProps) => {
      let offset = 0
      return React.createElement(
        'div',
        { 'data-testid': 'session-list' },
        groupCounts.map((count, groupIndex) => {
          const start = offset
          offset += count
          return React.createElement(
            React.Fragment,
            { key: groupIndex },
            groupContent(groupIndex),
            Array.from({ length: count }, (_, index) =>
              React.createElement(React.Fragment, { key: start + index }, itemContent(start + index, groupIndex))
            )
          )
        })
      )
    },
  }
})

vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: isSmallScreenMock }))
vi.mock('@/platform', () => ({ default: platformMock }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessionHooks: {
      useSessionList: () => ({
        sessionMetaList: sessionListState.sessions,
        fetchNextPage: sessionListState.fetchNextPage,
        hasNextPage: sessionListState.hasNextPage,
        isFetchingNextPage: false,
        isFetchNextPageError: sessionListState.isFetchNextPageError,
        isLoading: sessionListState.isLoading,
      }),
      useSessionFolders: () => ({ folders: sessionListState.folders }),
    },
  },
}))
vi.mock('@/stores/session/crud', () => ({ reorderSessions: reorderSessionsMock }))
vi.mock('@/stores/session/folders', () => ({
  deleteSessionFolder: vi.fn(),
  moveSessionToFolder: moveSessionToFolderMock,
  renameSessionFolder: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ location: { pathname: '/session/session-1' } }),
}))
vi.mock('./SessionItem', async () => {
  const React = await import('react')
  return {
    default: ({
      isReordering,
      onStartReordering,
      session,
      hideAvatar,
    }: {
      hideAvatar?: boolean
      isReordering?: boolean
      onStartReordering?: () => void
      session: SessionMetaRecord
    }) =>
      React.createElement(
        'div',
        { 'data-testid': `session-content-${session.id}`, 'data-hide-avatar': String(Boolean(hideAvatar)) },
        session.name,
        !isReordering &&
          onStartReordering &&
          React.createElement('button', { onClick: onStartReordering, type: 'button' }, 'Enter reorder')
      ),
  }
})

import { uiStore } from '@/stores/uiStore'
import SessionList from './SessionList'

afterEach(() => {
  vi.useRealTimers()
})

const sessions: SessionMetaRecord[] = [
  { id: 'session-1', name: 'Pinned session', sortOrder: 1, starred: true, createdAt: 1 },
  { id: 'session-2', name: 'Regular session', sortOrder: 2, starred: false, createdAt: 2 },
]

function renderList() {
  const sessionListViewportRef = { current: null }
  return render(
    <MantineProvider>
      <SessionList sessionListViewportRef={sessionListViewportRef} />
    </MantineProvider>
  )
}

function getSortableRow(sessionId: string): HTMLElement {
  const row = screen.getByTestId(`session-content-${sessionId}`).parentElement
  if (!row) {
    throw new Error(`Missing sortable row for ${sessionId}`)
  }
  return row
}

describe('SessionList mobile reorder mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    platformMock.type = 'mobile'
    isSmallScreenMock.mockReturnValue(true)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    })
    dndContextState.handlers = null
    sessionListState.sessions = sessions
    sessionListState.isLoading = false
    sessionListState.folders = []
    sessionListState.hasNextPage = false
    uiStore.setState({ collapsedSessionFolderIds: [] })
    reorderSessionsMock.mockResolvedValue(undefined)
    useSortableMock.mockImplementation(({ disabled, id }: { disabled?: boolean; id: string }) => ({
      attributes: {
        'aria-disabled': disabled,
        role: 'button',
        tabIndex: 0,
      },
      isDragging: false,
      listeners: {
        onPointerDown: () => sortablePointerDownMock(id),
      },
      setActivatorNodeRef: vi.fn(),
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
    }))
  })

  test('uses the whole row as the accessible drag activator only after entering reorder mode', () => {
    renderList()

    const normalRow = getSortableRow('session-1')
    fireEvent.pointerDown(normalRow)
    expect(sortablePointerDownMock).not.toHaveBeenCalled()
    expect(normalRow.getAttribute('aria-label')).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Enter reorder' })[0])

    const reorderRow = getSortableRow('session-1')
    fireEvent.pointerDown(reorderRow)
    expect(sortablePointerDownMock).toHaveBeenCalledWith('session-1')
    expect(reorderRow.getAttribute('role')).toBe('button')
    expect(reorderRow.getAttribute('tabindex')).toBe('0')
    expect(reorderRow.getAttribute('aria-label')).toBe('Adjust order: Pinned session')
    expect(document.querySelectorAll('[data-session-drag-handle]')).toHaveLength(sessions.length)
    expect(document.querySelector('button[aria-label="Adjust order"]')).toBeNull()
  })

  test('shows a lifted overlay after the long-press drag activates', () => {
    renderList()
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter reorder' })[0])

    act(() => {
      dndContextState.handlers?.onDragStart?.({ active: { id: 'session-1' } })
    })

    const overlayRow = screen.getByTestId('drag-overlay').firstElementChild
    expect(overlayRow?.className).not.toContain('pl-[22px]')
    const overlayContent = overlayRow?.firstElementChild
    expect(overlayContent?.className).toContain('scale-[1.02]')
    expect(overlayContent?.className).toContain('shadow-lg')
  })

  test('keeps pinned and regular sessions in separate reorder groups', async () => {
    renderList()

    await act(async () => {
      await dndContextState.handlers?.onDragEnd?.({
        active: { id: 'session-1' },
        over: { id: 'session-2' },
      })
    })

    expect(reorderSessionsMock).not.toHaveBeenCalled()
  })
})

describe('SessionList section headers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    platformMock.type = 'mobile'
    isSmallScreenMock.mockReturnValue(true)
    sessionListState.sessions = sessions
    sessionListState.isLoading = false
    sessionListState.folders = []
    sessionListState.hasNextPage = false
    useSortableMock.mockImplementation(() => ({
      attributes: {},
      isDragging: false,
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
    }))
    uiStore.setState({ showSidebar: true })
  })

  test('shows a loading indicator until the first page arrives', () => {
    sessionListState.sessions = undefined
    sessionListState.isLoading = true
    const { container, rerender } = renderList()
    expect(container.querySelector('.animate-spin')).toBeTruthy()

    sessionListState.sessions = [sessions[1]]
    sessionListState.isLoading = false
    rerender(
      <MantineProvider>
        <SessionList sessionListViewportRef={{ current: null }} />
      </MantineProvider>
    )
    expect(container.querySelector('.animate-spin')).toBeNull()
    expect(screen.getByText('Regular session')).toBeTruthy()
  })

  test('shows the chats section even when nothing is pinned', () => {
    sessionListState.sessions = [sessions[1]]
    renderList()

    expect(screen.queryByTestId(TestId.sidebar.pinnedSection)).toBeNull()
    expect(screen.getByText('Chats')).toBeTruthy()
    expect(screen.getByTestId(TestId.sidebar.chatsSectionMenu)).toBeTruthy()
  })

  test('closes the mobile sidebar before opening the cleanup modal from the chats section menu', () => {
    renderList()

    fireEvent.click(screen.getByTestId(TestId.sidebar.clearSessionList))

    expect(uiStore.getState().showSidebar).toBe(false)
    expect(showModalMock).toHaveBeenCalledWith('clear-session-list')
  })
})

describe('SessionList folders', () => {
  const folders: SessionFolder[] = [
    { id: 'work', name: 'Work' },
    { id: 'home', name: 'Home' },
  ]
  const filed: SessionMetaRecord[] = [
    { id: 'w1', name: 'Work chat', folderId: 'work', sortOrder: 3, createdAt: 3 },
    { id: 'h1', name: 'Home chat', folderId: 'home', sortOrder: 2, createdAt: 2 },
    { id: 'u1', name: 'Loose chat', sortOrder: 1, createdAt: 1 },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    platformMock.type = 'mobile'
    isSmallScreenMock.mockReturnValue(true)
    dndContextState.handlers = null
    useSortableMock.mockImplementation(() => ({
      attributes: {},
      isDragging: false,
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
    }))
    sessionListState.sessions = filed
    sessionListState.folders = folders
    sessionListState.hasNextPage = false
    sessionListState.isFetchNextPageError = false
    uiStore.setState({ collapsedSessionFolderIds: [] })
  })

  const folderHeaders = () =>
    Array.from(document.querySelectorAll('[data-folder-id]')).map((node) => node.getAttribute('data-folder-id'))

  test('renders folder groups before unfiled chats and hides collapsed members', () => {
    uiStore.setState({ collapsedSessionFolderIds: ['home'] })
    renderList()

    expect(folderHeaders()).toEqual(['work', 'home'])
    expect(screen.getByRole('button', { name: /Work/ }).querySelector('.tabler-icon-folder-open')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Home/ }).querySelector('.tabler-icon-folder')).toBeTruthy()
    expect(screen.getByText('Work chat')).toBeTruthy()
    expect(screen.queryByText('Home chat')).toBeNull()
    expect(screen.getByText('Chats')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Home/ }).getAttribute('aria-expanded')).toBe('false')
  })

  test('opens the project menu on long press and consumes the release click', () => {
    vi.useFakeTimers()
    renderList()
    const header = screen.getAllByTestId(TestId.sidebar.projectHeader)[0]
    const toggle = within(header).getByRole('button', { name: 'Work' })
    expect(screen.queryByRole('button', { name: 'Project actions' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()

    fireEvent.pointerDown(toggle)
    expect(header.className).toContain('bg-chatbox-background-gray-secondary')
    act(() => vi.advanceTimersByTime(550))
    fireEvent.pointerUp(toggle)
    fireEvent.click(toggle)

    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New Chat' })).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    fireEvent.pointerDown(toggle)
    fireEvent.pointerUp(toggle)
    fireEvent.click(toggle)
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  test('keeps project taps available and cancels an unfinished long press', () => {
    vi.useFakeTimers()
    renderList()
    const toggle = screen.getByRole('button', { name: 'Work' })
    fireEvent.pointerDown(toggle)
    act(() => vi.advanceTimersByTime(200))
    fireEvent.pointerUp(toggle)
    fireEvent.click(toggle)
    act(() => vi.advanceTimersByTime(550))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
  })

  test('cancels the project long press when scrolling or the pointer is canceled', () => {
    vi.useFakeTimers()
    renderList()
    const header = screen.getAllByTestId(TestId.sidebar.projectHeader)[0]
    const down = createEvent.pointerDown(header)
    Object.defineProperties(down, { clientX: { value: 10 }, clientY: { value: 10 } })
    fireEvent(header, down)
    const move = createEvent.pointerMove(header)
    Object.defineProperties(move, { clientX: { value: 10 }, clientY: { value: 30 } })
    fireEvent(header, move)
    act(() => vi.advanceTimersByTime(550))
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
    expect(header.className).not.toContain('bg-chatbox-background-gray-secondary')

    fireEvent.pointerDown(header)
    fireEvent.pointerCancel(header)
    act(() => vi.advanceTimersByTime(550))
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
  })

  test('keeps the touch context menu open through its release click', () => {
    renderList()
    const toggle = screen.getByRole('button', { name: 'Work' })
    const contextMenu = createEvent.contextMenu(toggle)
    Object.defineProperty(contextMenu, 'pointerType', { value: 'touch' })
    fireEvent(toggle, contextMenu)
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  test('preserves the directory project actions and rename dialog', () => {
    sessionListState.folders = [{ ...folders[0], workingDirectory: '/projects/work' }]
    renderList()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Work' }))
    expect(screen.getByRole('button', { name: 'New Chat' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(showModalMock).toHaveBeenCalledWith('session-folder-name', {
      title: 'Rename project',
      initialName: 'Work',
    })
  })

  test('uses the project more button on desktop', () => {
    platformMock.type = 'desktop'
    isSmallScreenMock.mockReturnValue(false)
    renderList()
    expect(screen.getAllByRole('button', { name: 'Project actions' })).toHaveLength(2)
  })

  test('disables the project long press while reordering chats', () => {
    vi.useFakeTimers()
    renderList()
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter reorder' })[0])
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Work' }))
    act(() => vi.advanceTimersByTime(550))
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
  })

  test('indents only project children, not pinned or unfiled chats', () => {
    sessionListState.sessions = [
      { id: 'p1', name: 'Pinned project chat', starred: true, folderId: 'work', sortOrder: 4, createdAt: 4 },
      ...filed,
      { id: 'orphan', name: 'Missing project', folderId: 'missing', sortOrder: 0, createdAt: 0 },
    ]
    renderList()

    for (const id of ['w1', 'h1']) {
      const row = screen.getByTestId(`session-content-${id}`).parentElement
      expect(row?.classList.contains('pl-[22px]')).toBe(true)
      expect(screen.getByTestId(`session-content-${id}`).getAttribute('data-hide-avatar')).toBe('true')
    }
    for (const id of ['p1', 'u1', 'orphan']) {
      expect(screen.getByTestId(`session-content-${id}`).parentElement?.classList.contains('pl-[22px]')).toBe(false)
      expect(screen.getByTestId(`session-content-${id}`).getAttribute('data-hide-avatar')).toBe('false')
    }
  })

  test('keeps the project indent on the drag overlay of a project chat', () => {
    renderList()

    act(() => {
      dndContextState.handlers?.onDragStart?.({ active: { id: 'w1' } })
    })

    const overlay = screen.getByTestId('drag-overlay')
    expect(overlay.firstElementChild?.className).toContain('pl-[22px]')
    expect(within(overlay).getByTestId('session-content-w1').getAttribute('data-hide-avatar')).toBe('true')
  })

  test('shows groups only up to the loaded page boundary', () => {
    sessionListState.sessions = [filed[0]]
    sessionListState.hasNextPage = true
    renderList()

    expect(folderHeaders()).toEqual(['work'])
    expect(screen.queryByText('Chats')).toBeNull()
    expect(screen.queryByText('Drag chats here')).toBeNull()
  })

  test('keeps loading while the loaded pages end inside a collapsed folder', () => {
    sessionListState.sessions = [filed[0]]
    sessionListState.hasNextPage = true
    renderList()
    expect(sessionListState.fetchNextPage).not.toHaveBeenCalled()

    act(() => {
      uiStore.setState({ collapsedSessionFolderIds: ['work'] })
    })
    expect(sessionListState.fetchNextPage).toHaveBeenCalledTimes(1)
  })

  test('does not retry a failed page read on its own', () => {
    sessionListState.sessions = [filed[0]]
    sessionListState.hasNextPage = true
    sessionListState.isFetchNextPageError = true
    uiStore.setState({ collapsedSessionFolderIds: ['work'] })
    renderList()

    expect(sessionListState.fetchNextPage).not.toHaveBeenCalled()
  })

  test('marks a folder empty once loading has passed it', () => {
    sessionListState.sessions = [filed[0], filed[2]]
    renderList()

    expect(folderHeaders()).toEqual(['work', 'home'])
    expect(screen.getByText('Drag chats here')).toBeTruthy()
  })

  test('files a chat dropped on a folder header and unfiles one dropped on Chats', async () => {
    renderList()

    await act(async () => {
      await dndContextState.handlers?.onDragEnd?.({ active: { id: 'u1' }, over: { id: 'folder:work' } })
    })
    expect(moveSessionToFolderMock).toHaveBeenCalledWith('u1', 'work')

    await act(async () => {
      await dndContextState.handlers?.onDragEnd?.({ active: { id: 'w1' }, over: { id: 'section:chats' } })
    })
    expect(moveSessionToFolderMock).toHaveBeenCalledWith('w1', undefined)
  })

  test('shows the projects header with a create button before any project exists', () => {
    sessionListState.folders = []
    sessionListState.sessions = [filed[2]]
    renderList()

    expect(screen.getByTestId(TestId.sidebar.projectsSection).textContent).toBe('Projects')
    fireEvent.click(screen.getByTestId(TestId.sidebar.createProject))
    expect(showModalMock).toHaveBeenCalledWith('session-folder-create')
  })

  test('keeps the projects header when there are no chats or projects', () => {
    sessionListState.folders = []
    sessionListState.sessions = []
    renderList()

    expect(screen.getByTestId(TestId.sidebar.createProject)).toBeTruthy()
    expect(screen.queryByText('Chats')).toBeNull()
  })

  test('reorders across folders through the row the chat is dropped on', async () => {
    renderList()

    await act(async () => {
      await dndContextState.handlers?.onDragEnd?.({ active: { id: 'u1' }, over: { id: 'h1' } })
    })

    expect(reorderSessionsMock).toHaveBeenCalledWith('u1', 'h1')
  })
})
