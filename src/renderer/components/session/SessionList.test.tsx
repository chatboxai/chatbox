// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { SessionMetaRecord } from '@shared/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

type DndContextHandlers = {
  onDragStart?: (event: { active: { id: string } }) => void
  onDragEnd?: (event: { active: { id: string }; over: { id: string } | null }) => Promise<void>
}

const { dndContextState, reorderSessionsMock, sessionListState, sortablePointerDownMock, useSortableMock } = vi.hoisted(
  () => ({
    dndContextState: { handlers: null as DndContextHandlers | null },
    reorderSessionsMock: vi.fn(),
    sessionListState: { sessions: [] as SessionMetaRecord[] },
    sortablePointerDownMock: vi.fn(),
    useSortableMock: vi.fn(),
  })
)

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

import SessionList from './SessionList'

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
