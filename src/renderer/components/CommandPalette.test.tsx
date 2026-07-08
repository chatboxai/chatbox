/**
 * @vitest-environment jsdom
 */
import { MantineProvider } from '@mantine/core'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  routerNavigate: vi.fn(),
  navigateToSettings: vi.fn(),
  switchCurrentSession: vi.fn(),
  setOpenSearchDialog: vi.fn(),
  setSettings: vi.fn(),
  sessionMetaList: [] as Array<{ id: string; name: string; type?: string }>,
  realTheme: 'light' as 'light' | 'dark',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/router', () => ({ router: { navigate: mocks.routerNavigate } }))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: mocks.navigateToSettings }))
vi.mock('@/stores/sessionActions', () => ({ switchCurrentSession: mocks.switchCurrentSession }))
vi.mock('@/stores/chatStore', () => ({
  useSessionList: () => ({ sessionMetaList: mocks.sessionMetaList }),
}))
vi.mock('@/stores/uiStore', () => ({
  uiStore: { getState: () => ({ setOpenSearchDialog: mocks.setOpenSearchDialog }) },
  useUIStore: (selector: (s: { realTheme: string }) => unknown) => selector({ realTheme: mocks.realTheme }),
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ setSettings: mocks.setSettings }) },
}))

import CommandPalette from './CommandPalette'
import { commandPalette } from './commandPaletteStore'

// Mantine needs matchMedia and ResizeObserver in jsdom
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || (ResizeObserverStub as unknown as typeof ResizeObserver)
window.matchMedia =
  window.matchMedia ||
  ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }) as unknown as MediaQueryList)

function renderPalette() {
  const result = render(
    <MantineProvider>
      <CommandPalette />
    </MantineProvider>
  )
  act(() => {
    commandPalette.open()
  })
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sessionMetaList = []
  mocks.realTheme = 'light'
})

describe('CommandPalette', () => {
  it('lists the core commands when opened', async () => {
    renderPalette()
    expect(await screen.findByText('New Chat')).toBeTruthy()
    expect(screen.getByText('Create Image')).toBeTruthy()
    expect(screen.getByText('Search All Conversations')).toBeTruthy()
    expect(screen.getByText('Provider Settings')).toBeTruthy()
  })

  it('runs a command and closes: New Chat navigates home', async () => {
    renderPalette()
    const item = await screen.findByText('New Chat')
    act(() => {
      item.click()
    })
    expect(mocks.routerNavigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('lists conversations and switches on click', async () => {
    mocks.sessionMetaList = [
      { id: 'sess-1', name: 'Rust questions', type: 'chat' },
      { id: 'sess-2', name: 'Logo ideas', type: 'picture' },
    ]
    renderPalette()
    const item = await screen.findByText('Rust questions')
    expect(screen.getByText('Logo ideas')).toBeTruthy()
    act(() => {
      item.click()
    })
    expect(mocks.switchCurrentSession).toHaveBeenCalledWith('sess-1')
  })

  it('offers the opposite theme and applies it', async () => {
    mocks.realTheme = 'dark'
    renderPalette()
    const item = await screen.findByText('Switch to Light Theme')
    act(() => {
      item.click()
    })
    expect(mocks.setSettings).toHaveBeenCalledWith({ theme: expect.anything() })
  })

  it('opens the global search dialog in global-only mode', async () => {
    renderPalette()
    const item = await screen.findByText('Search All Conversations')
    act(() => {
      item.click()
    })
    expect(mocks.setOpenSearchDialog).toHaveBeenCalledWith(true, true)
  })
})
