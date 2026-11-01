// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { SessionHeader } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SessionEdit } from '@/components/session/session-edit'

const mocks = vi.hoisted(() => ({
  hide: vi.fn(),
  resolve: vi.fn(),
  delBlob: vi.fn(),
  updateSessionHeader: vi.fn(),
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
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

vi.mock('@ebay/nice-modal-react', () => ({
  default: { create: (component: unknown) => component },
  useModal: () => ({ visible: true, hide: mocks.hide, resolve: mocks.resolve }),
}))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessions: { updateSessionHeader: mocks.updateSessionHeader } },
}))
vi.mock('@/storage', () => ({ default: { delBlob: mocks.delBlob } }))
vi.mock('@/components/common/AdaptiveModal', () => {
  const AdaptiveModal = ({ children }: { children: ReactNode }) => <div>{children}</div>
  AdaptiveModal.Actions = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return { AdaptiveModal }
})
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('@/packages/event', () => ({ trackingEvent: vi.fn() }))
vi.mock('@/stores/session/agent-mode', () => ({ getSessionAgentModeEntry: () => ({ value: 'off' }) }))
vi.mock('@/components/session/SessionSettingsContent', () => ({
  SessionSettingsContent: ({ onEdit }: { onEdit: (edit: SessionEdit) => void }) => (
    <div>
      <button type="button" onClick={() => onEdit({ backgroundImage: null })}>
        Remove background
      </button>
      <button type="button" onClick={() => onEdit({ settings: { temperature: 0.2 } })}>
        Set temperature
      </button>
      <input aria-label="Name" onBlur={(event) => onEdit({ name: event.currentTarget.value })} />
    </div>
  ),
}))

import SessionSettings from './SessionSettings'

const draftSession: SessionHeader = {
  id: 'new',
  type: 'chat',
  name: 'Untitled',
  settings: { provider: 'openai', modelId: 'gpt-4o' },
  backgroundImage: { type: 'storage-key', storageKey: 'picture:session-bg:shared' },
}

describe('SessionSettings for an unsaved chat', () => {
  beforeEach(() => {
    mocks.hide.mockClear()
    mocks.resolve.mockClear()
    mocks.delBlob.mockClear()
    mocks.updateSessionHeader.mockClear()
  })

  test('resolves with the edited draft without saving it or deleting shared blobs', () => {
    render(
      <MantineProvider>
        <SessionSettings id="session-settings-test" session={draftSession} systemPrompt="Default prompt" />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove background' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set temperature' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    const resolved = mocks.resolve.mock.calls[0][0] as { session: SessionHeader; systemPrompt: string }
    expect(resolved.session.backgroundImage).toBeUndefined()
    expect(resolved.session.settings).toEqual({ provider: 'openai', modelId: 'gpt-4o', temperature: 0.2 })
    expect(resolved.systemPrompt).toBe('Default prompt')
    expect(mocks.hide).toHaveBeenCalled()
    expect(mocks.updateSessionHeader).not.toHaveBeenCalled()
    expect(mocks.delBlob).not.toHaveBeenCalled()
  })

  test('includes text a focused field commits when the dialog closes', () => {
    render(
      <MantineProvider>
        <SessionSettings id="session-settings-test" session={draftSession} systemPrompt="Default prompt" />
      </MantineProvider>
    )

    const name = screen.getByRole('textbox', { name: 'Name' })
    name.focus()
    fireEvent.change(name, { target: { value: 'Pricing research' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect((mocks.resolve.mock.calls[0][0] as { session: SessionHeader; systemPrompt: string }).session.name).toBe(
      'Pricing research'
    )
  })
})
