// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { SessionMetaRecord } from '@shared/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { useArchivedSessionListMock, deleteAllArchivedSessionsMock, showModalMock } = vi.hoisted(() => ({
  useArchivedSessionListMock: vi.fn(),
  deleteAllArchivedSessionsMock: vi.fn(),
  showModalMock: vi.fn(),
}))

vi.mock('@ebay/nice-modal-react', () => ({
  default: { show: (...args: unknown[]) => showModalMock(...args) },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessionHooks: {
      useArchivedSessionList: useArchivedSessionListMock,
    },
    sessions: {
      restoreSession: vi.fn(),
    },
  },
}))
vi.mock('@/stores/session/crud', () => ({
  deleteSession: vi.fn(),
  deleteAllArchivedSessions: deleteAllArchivedSessionsMock,
}))
vi.mock('@/presentation/session/session-deletion-confirmation', () => ({
  confirmSessionDeletion: vi.fn(),
}))
vi.mock('@/components/common/Avatar', () => ({
  AssistantAvatar: () => <div />,
}))
vi.mock('@/components/ui/tooltip', () => ({
  AppTooltip: ({ children }: { children: ReactNode }) => children,
}))

import { RouteComponent } from './archive'

function archivedSession(id: string): SessionMetaRecord {
  return {
    id,
    name: id,
    sortOrder: 1,
    createdAt: 1,
    archivedAt: 1,
  }
}

function renderArchivePage() {
  return render(
    <MantineProvider>
      <RouteComponent />
    </MantineProvider>
  )
}

describe('archived chats page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    deleteAllArchivedSessionsMock.mockResolvedValue(undefined)
    showModalMock.mockResolvedValue(false)
    useArchivedSessionListMock.mockReturnValue({
      archivedSessionMetaList: [archivedSession('archived-1')],
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    })
  })

  test('hides the delete-all action when there are no archived chats', () => {
    useArchivedSessionListMock.mockReturnValue({
      archivedSessionMetaList: [],
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    })

    renderArchivePage()

    expect(screen.queryByRole('button', { name: 'Delete All' })).toBeNull()
    expect(screen.getByText('No archived chats')).toBeTruthy()
  })

  test('asks for confirmation before deleting every archived chat', async () => {
    showModalMock.mockResolvedValue(true)

    renderArchivePage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete All' }))
    })

    expect(showModalMock).toHaveBeenCalledWith(
      'confirm',
      expect.objectContaining({
        title: 'Delete all archived chats?',
        confirmText: 'Delete All',
        danger: true,
      })
    )
    expect(deleteAllArchivedSessionsMock).toHaveBeenCalledTimes(1)
  })

  test('does not delete archived chats when confirmation is cancelled', async () => {
    renderArchivePage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete All' }))
    })

    expect(deleteAllArchivedSessionsMock).not.toHaveBeenCalled()
  })
})
