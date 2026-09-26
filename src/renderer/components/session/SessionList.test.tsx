// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { SessionFolder, SessionMetaRecord } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

type DndContextHandlers = {
  onDragStart?: (event: { active: { id: string } }) => void
  onDragEnd?: (event: { active: { id: string }; over: { id: string } | null }) => Promise<void>
}

const {
  dndContextState,
  foldersState,
  reorderSessionsMock,
  sessionListState,
  sortableContextState,
  sortablePointerDownMock,
  uiStoreState,
  useSortableMock,
} = vi.hoisted(() => ({
  dndContextState: { handlers: null as DndContextHandlers | null },
  foldersState: { folders: [] as SessionFolder[] },
  reorderSessionsMock: vi.fn(),
  sessionListState: { sessions: [] as SessionMetaRecord[] },
  sortableContextState: { items: [] as string[] },
  sortablePointerDownMock: vi.fn(),
  uiStoreState: { collapsedFolders: {} as Record<string, boolean | undefined> },
  useSortableMock: vi.fn(),
}))

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
    useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
    useSensors: (...sensors: unknown[]) => sensors,
  }
})

vi.mock('@dnd-kit/sortable', async () => {
  const React = await import('react')
  return {
    SortableContext: ({ children, items }: { children: React.ReactNode; items: string[] }) => {
      sortableContextState.items = items
      return React.createElement(React.Fragment, null, children)
    },
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
  type Item = { id: string }
  type VirtuosoProps = {
    data: Item[]
    itemContent: (index: number, item: Item) => React.ReactNode
  }
  return {
    Virtuoso: ({ data, itemContent }: VirtuosoProps) =>
      React.createElement(
        'div',
        { 'data-testid': 'session-list' },
        data.map((item, index) => React.createElement(React.Fragment, { key: item.id }, itemContent(index, item)))
      ),
  }
})

vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => true }))
vi.mock('@/platform', () => ({ default: { type: 'mobile' } }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessionHooks: {
      useSessionList: () => ({
        sessionMetaList: sessionListState.sessions,
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    },
  },
}))
vi.mock('@/stores/session/crud', () => ({ reorderSessions: reorderSessionsMock }))
vi.mock('@/stores/sessionFolders', () => ({
  useFolders: () => ({ folders: foldersState.folders, isLoading: false }),
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: { collapsedFolders: Record<string, boolean | undefined> }) => unknown) =>
    selector({ collapsedFolders: uiStoreState.collapsedFolders }),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({ location: { pathname: '/session/session-1' } }),
}))
vi.mock('./SessionItem', async () => {
  const React = await import('react')
  return {
    default: ({
      isReordering,
      onStartReordering,
      session,
    }: {
      isReordering?: boolean
      onStartReordering?: () => void
      session: SessionMetaRecord
    }) =>
      React.createElement(
        'div',
        { 'data-testid': `session-content-${session.id}` },
        session.name,
        !isReordering &&
          onStartReordering &&
          React.createElement('button', { onClick: onStartReordering, type: 'button' }, 'Enter reorder')
      ),
  }
})

vi.mock('./FolderHeader', async () => {
  const React = await import('react')
  return {
    default: ({ folder }: { folder: SessionFolder }) =>
      React.createElement('div', { 'data-testid': `folder-header-${folder.id}` }, folder.name),
  }
})

import SessionList from './SessionList'

const sessions: SessionMetaRecord[] = [
  { id: 'session-1', name: 'Pinned session', sortOrder: 1, starred: true, createdAt: 1 },
  { id: 'session-2', name: 'Regular session', sortOrder: 2, starred: false, createdAt: 2 },
]
function renderList() {
  const sessionListViewportRef = { current: null }
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <SessionList sessionListViewportRef={sessionListViewportRef} />
      </QueryClientProvider>
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
    foldersState.folders = []
    uiStoreState.collapsedFolders = {}
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

    const overlayContent = screen.getByTestId('drag-overlay').firstElementChild
    expect(overlayContent?.className).toContain('scale-[1.02]')
    expect(overlayContent?.className).toContain('shadow-lg')
  })

  test('forwards cross-group drag ends to reorderSessions (the store layer guards groups)', async () => {
    renderList()

    await act(async () => {
      await dndContextState.handlers?.onDragEnd?.({
        active: { id: 'session-1' },
        over: { id: 'session-2' },
      })
    })

    expect(reorderSessionsMock).toHaveBeenCalledWith('session-1', 'session-2')
  })

  test('drops same-position drag ends without calling reorderSessions', async () => {
    renderList()

    await act(async () => {
      await dndContextState.handlers?.onDragEnd?.({
        active: { id: 'session-1' },
        over: { id: 'session-1' },
      })
    })

    expect(reorderSessionsMock).not.toHaveBeenCalled()
  })
})

const folderA: SessionFolder = { id: 'folder-a', name: 'Folder A', sortOrder: 2000, createdAt: 1 }

describe('SessionList folder grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    foldersState.folders = [folderA]
    uiStoreState.collapsedFolders = {}
    sortableContextState.items = []
    reorderSessionsMock.mockResolvedValue(undefined)
    useSortableMock.mockImplementation(({ id }: { disabled?: boolean; id: string }) => ({
      attributes: { role: 'button', tabIndex: 0 },
      isDragging: false,
      listeners: {},
      setActivatorNodeRef: vi.fn(),
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      id,
    }))
  })

  test('renders a filed session under its folder and not in Chats', () => {
    sessionListState.sessions = [
      { id: 'filed-session', name: 'Filed session', sortOrder: 1, createdAt: 1, folderId: 'folder-a' },
      { id: 'unfiled-session', name: 'Unfiled session', sortOrder: 2, createdAt: 2 },
    ]
    renderList()

    expect(screen.getByTestId('folder-header-folder-a')).toBeTruthy()

    const filedRow = getSortableRow('filed-session')
    const folderHeader = screen.getByTestId('folder-header-folder-a')
    const chatsHeader = screen.getByText('Chats')
    const unfiledRow = getSortableRow('unfiled-session')

    // DOM order: folder header, filed child, Chats section, unfiled child.
    expect(filedRow.compareDocumentPosition(folderHeader) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(chatsHeader.compareDocumentPosition(filedRow) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(unfiledRow.compareDocumentPosition(chatsHeader) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()

    // sortableSessionIds follows mounted order: filed session first, then unfiled.
    expect(sortableContextState.items).toEqual(['filed-session', 'unfiled-session'])
  })

  test('falls back an orphan folderId to the Chats section (folder not loaded/deleted)', () => {
    sessionListState.sessions = [
      { id: 'orphan-session', name: 'Orphan session', sortOrder: 1, createdAt: 1, folderId: 'missing-folder' },
      { id: 'unfiled-session', name: 'Unfiled session', sortOrder: 2, createdAt: 2 },
    ]
    renderList()

    // Folder A exists (so the Chats section header renders) but orphan points elsewhere.
    expect(screen.queryByTestId('folder-header-missing-folder')).toBeNull()
    const chatsHeader = screen.getByText('Chats')
    const orphanRow = getSortableRow('orphan-session')
    const unfiledRow = getSortableRow('unfiled-session')
    expect(orphanRow.compareDocumentPosition(chatsHeader) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(unfiledRow.compareDocumentPosition(chatsHeader) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()

    // The orphan still participates in sorting as a mounted chat.
    expect(sortableContextState.items).toEqual(['orphan-session', 'unfiled-session'])
  })

  test('falls back sessions to Chats while folders are still loading (folders not loaded yet)', () => {
    foldersState.folders = []
    sessionListState.sessions = [
      { id: 'orphan-session', name: 'Orphan session', sortOrder: 1, createdAt: 1, folderId: 'folder-a' },
    ]
    renderList()

    // No folder header mounted; the session must still be visible under Chats
    // (without a section header, since no groups exist in the loading window).
    expect(screen.queryByTestId('folder-header-folder-a')).toBeNull()
    expect(screen.queryByText('Chats')).toBeNull()
    expect(screen.getByTestId('session-content-orphan-session')).toBeTruthy()
    expect(sortableContextState.items).toEqual(['orphan-session'])
  })

  test('omits children of a collapsed folder from the list and the sortable ids', () => {
    uiStoreState.collapsedFolders = { 'folder-a': true }
    sessionListState.sessions = [
      { id: 'filed-session', name: 'Filed session', sortOrder: 1, createdAt: 1, folderId: 'folder-a' },
      { id: 'unfiled-session', name: 'Unfiled session', sortOrder: 2, createdAt: 2 },
    ]
    renderList()

    expect(screen.getByTestId('folder-header-folder-a')).toBeTruthy()
    expect(screen.queryByTestId('session-content-filed-session')).toBeNull()
    expect(screen.getByTestId('session-content-unfiled-session')).toBeTruthy()
    expect(sortableContextState.items).toEqual(['unfiled-session'])
  })
})
