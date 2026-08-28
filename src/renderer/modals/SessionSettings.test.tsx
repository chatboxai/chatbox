// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { Session, Updater } from '@shared/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  delBlob: vi.fn(() => Promise.resolve()),
  hide: vi.fn(),
  persistedSession: null as Session | null,
  resolve: vi.fn(),
  updateSessionWithMessages: vi.fn(),
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})

vi.mock('@ebay/nice-modal-react', () => ({
  default: { create: (component: unknown) => component },
  useModal: () => ({ visible: true, hide: mocks.hide, resolve: mocks.resolve }),
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { updateSessionWithMessages: mocks.updateSessionWithMessages },
  },
}))

vi.mock('@/components/common/AdaptiveModal', () => {
  const AdaptiveModal = ({ children }: { children: ReactNode }) => <div>{children}</div>
  AdaptiveModal.Actions = ({ children }: { children: ReactNode }) => <div>{children}</div>
  AdaptiveModal.CloseButton = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {props.children ?? 'Cancel'}
    </button>
  )
  return { AdaptiveModal }
})

vi.mock('@/components/common/Avatar', () => ({ AssistantAvatar: () => <div /> }))
vi.mock('@/components/Image', () => ({
  handleImageInputAndSave: vi.fn(),
  ImageInStorage: () => <div />,
}))
vi.mock('@/components/ui/tooltip', () => ({ AppTooltip: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('@/packages/event', () => ({ trackingEvent: vi.fn() }))
vi.mock('@/storage', () => ({
  default: {
    delBlob: mocks.delBlob,
    setBlob: vi.fn(() => Promise.resolve()),
  },
}))
vi.mock('@/stores/sessionHelpers', () => ({
  getSessionMeta: (session: Session) => ({
    id: session.id,
    name: session.name,
    type: session.type,
    backgroundImage: session.backgroundImage,
  }),
}))

import SessionSettings from './SessionSettings'

const originalSession: Session = {
  id: 'session-1',
  type: 'picture',
  name: 'Picture session',
  messages: [],
  backgroundImage: { type: 'storage-key', storageKey: 'picture:session-bg:old' },
}

function renderSettings() {
  return render(
    <MantineProvider>
      <SessionSettings id="session-settings-test" session={originalSession} />
    </MantineProvider>
  )
}

describe('SessionSettings background image lifecycle', () => {
  beforeEach(() => {
    mocks.delBlob.mockClear()
    mocks.hide.mockClear()
    mocks.resolve.mockClear()
    mocks.updateSessionWithMessages.mockReset()
    mocks.persistedSession = { ...originalSession }
    mocks.updateSessionWithMessages.mockImplementation((_sessionId: string, updater: Updater<Session>) => {
      const updated =
        typeof updater === 'function'
          ? updater(mocks.persistedSession)
          : ({ ...mocks.persistedSession, ...updater } as Session)
      mocks.persistedSession = updated
      return Promise.resolve(updated)
    })
  })

  test('keeps the persisted background blob when deletion is cancelled', () => {
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mocks.updateSessionWithMessages).not.toHaveBeenCalled()
    expect(mocks.delBlob).not.toHaveBeenCalled()
  })

  test('keeps a shared background blob after removing it from one Session and saving', async () => {
    const copiedSession: Session = {
      ...originalSession,
      id: 'session-copy',
      backgroundImage: originalSession.backgroundImage,
    }
    let finishSave: (() => void) | undefined
    mocks.updateSessionWithMessages.mockImplementationOnce(async (_sessionId: string, updater: Updater<Session>) => {
      const updated =
        typeof updater === 'function'
          ? updater(mocks.persistedSession)
          : ({ ...mocks.persistedSession, ...updater } as Session)
      await new Promise<void>((resolve) => {
        finishSave = resolve
      })
      mocks.persistedSession = updated
      return updated
    })
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateSessionWithMessages).toHaveBeenCalledTimes(1))
    expect(mocks.delBlob).not.toHaveBeenCalled()

    await act(async () => finishSave?.())

    await waitFor(() => {
      expect(mocks.persistedSession?.backgroundImage).toBeUndefined()
      expect(copiedSession.backgroundImage).toEqual({
        type: 'storage-key',
        storageKey: 'picture:session-bg:old',
      })
      expect(mocks.delBlob).not.toHaveBeenCalled()
    })
  })
})
