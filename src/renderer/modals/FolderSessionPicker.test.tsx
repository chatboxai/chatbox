// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { SessionFolder, SessionMetaRecord } from '@shared/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { hideMock, moveSessionsToFolderMock, resolveMock, sessionsState } = vi.hoisted(() => ({
  hideMock: vi.fn(),
  moveSessionsToFolderMock: vi.fn(),
  resolveMock: vi.fn(),
  sessionsState: { sessions: [] as SessionMetaRecord[] },
}))

// NiceModal keeps a shown modal mounted across hide()/show() calls; its props are
// updated in place when show() is called again with different args. Stub the
// library so the component under test stays mounted and merely receives new
// props — exactly the reuse path that leaks useState-initializer state.
vi.mock('@ebay/nice-modal-react', async () => {
  const React = await import('react')
  return {
    default: {
      create: <P,>(Component: React.ComponentType<P>) => Component,
    },
    useModal: () => ({ hide: hideMock, remove: vi.fn(), resolve: resolveMock, visible: true }),
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => key.replace('{{count}}', String(opts?.count ?? '')),
  }),
}))

vi.mock('@/components/common/AdaptiveModal', async () => {
  const React = await import('react')
  const Shell = ({ children, title }: { children: React.ReactNode; title: string }) =>
    React.createElement('div', null, React.createElement('h2', null, title), children)
  Shell.Actions = ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children)
  Shell.CloseButton = ({ onClick }: { onClick?: () => void }) =>
    React.createElement('button', { onClick, type: 'button' }, 'Cancel')
  return { AdaptiveModal: Shell }
})

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessionQueryBridge: {
      getCachedSessionsMeta: () => sessionsState.sessions,
    },
  },
}))
vi.mock('@/stores/sessionFolders', () => ({ moveSessionsToFolder: moveSessionsToFolderMock }))

import FolderSessionPicker from './FolderSessionPicker'

// The nice-modal mock makes create() an identity, so the export is the raw
// component; cast off the HocProps (id) wrapper the real types carry.
const Picker = FolderSessionPicker as unknown as ComponentType<{ folder: SessionFolder }>

// Mantine ScrollArea observes its viewport; jsdom has no ResizeObserver.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const folderA: SessionFolder = { id: 'folder-a', name: 'Folder A', sortOrder: 2000, createdAt: 1 }
const folderB: SessionFolder = { id: 'folder-b', name: 'Folder B', sortOrder: 1000, createdAt: 2 }

const sessions: SessionMetaRecord[] = [
  { id: 's1', name: 'Session in A', sortOrder: 1, createdAt: 1, folderId: 'folder-a' },
  { id: 's2', name: 'Session in B', sortOrder: 2, createdAt: 2, folderId: 'folder-b' },
  { id: 's3', name: 'Unfiled session', sortOrder: 3, createdAt: 3 },
]

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('button')
  if (!row) {
    throw new Error(`Missing picker row for ${name}`)
  }
  return row
}

function checkedRowCount(): number {
  return document.querySelectorAll('[aria-pressed="true"]').length
}

function renderPicker(folder: SessionFolder) {
  return render(
    <MantineProvider>
      <Picker folder={folder} />
    </MantineProvider>
  )
}

describe('FolderSessionPicker state reset across NiceModal reuse', () => {
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
    sessionsState.sessions = sessions
  })

  test('pre-checks only the current folder members', () => {
    renderPicker(folderA)

    expect(checkedRowCount()).toBe(1)
    expect(rowFor('Session in A').getAttribute('aria-pressed')).toBe('true')
    expect(rowFor('Session in B').getAttribute('aria-pressed')).toBe('false')
    expect(rowFor('Unfiled session').getAttribute('aria-pressed')).toBe('false')
  })

  test('reopening for a different folder resets checks and search (NiceModal keeps the component mounted)', () => {
    const { rerender } = renderPicker(folderA)

    // Dirty the state: toggle two rows and type a search term, then "hide".
    fireEvent.click(rowFor('Unfiled session'))
    fireEvent.click(rowFor('Session in B'))
    expect(checkedRowCount()).toBe(3)
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'unfiled' } })

    // NiceModal re-shows for folder B: same mounted component, new props.
    rerender(
      <MantineProvider>
        <Picker folder={folderB} />
      </MantineProvider>
    )

    // Regression guard: without the useEffect sync, the previous folder's
    // checks and search term leak into the new picker (and into its save diff).
    expect(checkedRowCount()).toBe(1)
    expect(rowFor('Session in B').getAttribute('aria-pressed')).toBe('true')
    expect(rowFor('Session in A').getAttribute('aria-pressed')).toBe('false')
    expect(rowFor('Unfiled session').getAttribute('aria-pressed')).toBe('false')
    expect((screen.getByPlaceholderText('Search') as HTMLInputElement).value).toBe('')
  })

  test('saving only writes the sessions whose membership changed', async () => {
    moveSessionsToFolderMock.mockResolvedValue(undefined)
    renderPicker(folderA)

    // Remove s1 from A, add s3; s2 (other folder) stays untouched.
    fireEvent.click(rowFor('Session in A'))
    fireEvent.click(rowFor('Unfiled session'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(moveSessionsToFolderMock).toHaveBeenCalledWith([
        { sessionId: 's1', folderId: null },
        { sessionId: 's3', folderId: 'folder-a' },
      ])
    })
    expect(hideMock).toHaveBeenCalled()
  })
})
