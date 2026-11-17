// @vitest-environment jsdom

import type { SessionSearchHit, SessionSearchOptions, SessionSearchResult } from '@chatbox/core/application/session'
import { TestId } from '@shared/automation/testids'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from '@/test-utils'

const mocks = vi.hoisted(() => ({
  open: false,
  globalOnly: true,
  currentSessionId: 'current',
  hidePrompt: false,
  searchSessions: vi.fn(),
  setOpen: vi.fn(),
  openSearch: vi.fn(),
  switchSession: vi.fn(),
  prepareTarget: vi.fn(),
}))

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView = vi.fn()

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('jotai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jotai')>()),
  useAtomValue: () => mocks.currentSessionId,
}))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => ({ transcriptNavigation: { sessionId: mocks.currentSessionId, openSearch: mocks.openSearch } }),
  },
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      openSearchDialog: mocks.open,
      searchDialogGlobalOnly: mocks.globalOnly,
      setOpenSearchDialog: mocks.setOpen,
    }),
}))
vi.mock('@/stores/sessionHelpers', () => ({ searchSessions: mocks.searchSessions }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { hideSystemPromptMessage: boolean }) => unknown) =>
    selector({ hideSystemPromptMessage: mocks.hidePrompt }),
}))
vi.mock('@/stores/session/crud', () => ({ switchCurrentSession: mocks.switchSession }))
vi.mock('@/stores/session-search-target', () => ({ prepareSessionSearchTarget: mocks.prepareTarget }))
vi.mock('@/components/common/Mark', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))

import SearchDialog from './SearchDialog'

function result(...hits: SessionSearchHit[]): SessionSearchResult {
  return { hits, failedSessionIds: [], limitReached: false }
}
function hit(preview: string, sessionId = 'current', messageId: string | undefined = preview): SessionSearchHit {
  return { sessionId, sessionName: `Chat ${sessionId}`, messageId, preview }
}
function deferredSearch() {
  let resolve!: (value: SessionSearchResult) => void
  const promise = new Promise<SessionSearchResult>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function search(query: string) {
  const input = screen.getByTestId(TestId.session.searchInput)
  fireEvent.input(input, { target: { value: query } })
  fireEvent.keyDown(input, { key: 'Enter' })
}
function options(call = 0): SessionSearchOptions {
  return mocks.searchSessions.mock.calls[call][1]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.open = true
  mocks.globalOnly = true
  mocks.currentSessionId = 'current'
  mocks.hidePrompt = false
  mocks.searchSessions.mockReset()
  mocks.searchSessions.mockResolvedValue(result())
})

describe('SearchDialog', () => {
  test('does not hide the application from assistive technology while closed', () => {
    mocks.open = false
    const appRoot = document.createElement('div')
    document.body.appendChild(appRoot)
    const { unmount } = render(<SearchDialog />, { container: appRoot })
    expect(appRoot.getAttribute('aria-hidden')).toBeNull()
    unmount()
    appRoot.remove()
  })

  test('replaces progressive snapshots and displays partial results while searching', async () => {
    const pending = deferredSearch()
    mocks.searchSessions.mockReturnValue(pending.promise)
    render(<SearchDialog />)
    search('needle')
    expect(screen.getByRole('status')).toBeTruthy()
    act(() => options().onProgress?.(result(hit('first'))))
    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
    act(() => options().onProgress?.(result(hit('second'))))
    expect(screen.queryByText('first')).toBeNull()
    expect(screen.getByText('second')).toBeTruthy()
    await act(async () => pending.resolve(result(hit('second'))))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getAllByText('second')).toHaveLength(1)
  })

  test('cancels superseded searches and ignores their late progress and completion', async () => {
    const first = deferredSearch()
    const second = deferredSearch()
    mocks.searchSessions.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<SearchDialog />)
    search('first query')
    const firstOptions = options()
    search('second query')
    expect(firstOptions.signal?.aborted).toBe(true)
    act(() => firstOptions.onProgress?.(result(hit('stale progress'))))
    await act(async () => first.resolve(result(hit('stale completion'))))
    expect(screen.queryByText('stale progress')).toBeNull()
    expect(screen.queryByText('stale completion')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
    await act(async () => second.resolve(result(hit('fresh result'))))
    expect(screen.getByText('fresh result')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('aborts on input changes, dialog close, and unmount', () => {
    mocks.searchSessions.mockReturnValue(new Promise(() => {}))
    const view = render(<SearchDialog />)
    search('first')
    fireEvent.input(screen.getByTestId(TestId.session.searchInput), { target: { value: 'editing' } })
    expect(options().signal?.aborted).toBe(true)
    search('second')
    mocks.open = false
    view.rerender(<SearchDialog />)
    expect(options(1).signal?.aborted).toBe(true)
    mocks.open = true
    view.rerender(<SearchDialog />)
    search('third')
    view.unmount()
    expect(options(2).signal?.aborted).toBe(true)
  })

  test('passes prompt visibility to the service and opens a current-session hit', async () => {
    mocks.hidePrompt = true
    mocks.searchSessions.mockResolvedValue(result(hit('visible hit')))
    render(<SearchDialog />)
    search('visible')
    await screen.findByText('visible hit')
    expect(options().hideSystemPromptMessage).toBe(true)
    fireEvent.click(screen.getByText('visible hit'))
    expect(mocks.openSearch).toHaveBeenCalledWith('visible hit')
    expect(mocks.switchSession).not.toHaveBeenCalled()
    expect(mocks.setOpen).toHaveBeenCalledWith(false)
  })

  test('prepares a message target before switching to another conversation', async () => {
    mocks.searchSessions.mockResolvedValue(result(hit('other hit', 'other', 'message')))
    render(<SearchDialog />)
    search('other')
    fireEvent.click(await screen.findByText('other hit'))
    expect(mocks.prepareTarget).toHaveBeenCalledWith('other', 'message')
    expect(mocks.switchSession).toHaveBeenCalledWith('other')
    expect(mocks.prepareTarget.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.switchSession.mock.invocationCallOrder[0]
    )
  })

  test('opens a title-only match without a message target', async () => {
    mocks.searchSessions.mockResolvedValue(
      result({ sessionId: 'other', sessionName: 'Other', preview: 'Title result' })
    )
    render(<SearchDialog />)
    search('Title')
    fireEvent.click(await screen.findByText('Title result'))
    expect(mocks.prepareTarget).not.toHaveBeenCalled()
    expect(mocks.switchSession).toHaveBeenCalledWith('other')
  })

  test('keeps readable results visible when some conversations fail', async () => {
    mocks.searchSessions.mockResolvedValue({ ...result(hit('readable')), failedSessionIds: ['broken'] })
    render(<SearchDialog />)
    search('readable')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Error'))
    expect(screen.getByText('readable')).toBeTruthy()
    expect(screen.queryByText('No results found')).toBeNull()
  })
})
