// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { createMessage, type Session } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const globalSettings = vi.hoisted(() => ({
  maxContextMessageCount: 20 as number | undefined,
  temperature: undefined as number | undefined,
  topP: undefined as number | undefined,
  stream: true as boolean | undefined,
  pauseOnToolCallLimit: undefined as boolean | undefined,
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
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : key,
  }),
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: typeof globalSettings) => unknown) => selector(globalSettings),
}))
vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({ providers: [{ id: 'openai', models: [{ modelId: 'gpt-4o', nickname: 'GPT-4o' }] }] }),
}))
vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: vi.fn() }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/components/common/Avatar', () => ({ AssistantAvatar: () => <div /> }))
vi.mock('@/components/Image', () => ({ handleImageInputAndSave: vi.fn(), ImageInStorage: () => <div /> }))
vi.mock('@/components/ui/tooltip', () => ({ AppTooltip: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/adapters/CurrentBlobStorage', () => ({ currentBlobStorage: { set: vi.fn() } }))
vi.mock('@/storage/StoreStorage', () => ({ StorageKeyGenerator: { picture: (key: string) => `picture:${key}` } }))

import { SessionSettingsContent } from './SessionSettingsContent'

function makeSession(settings: Session['settings']): Session {
  return {
    id: 'session-1',
    name: 'Pricing research',
    type: 'chat',
    messages: [createMessage('system', 'Be concise.')],
    settings: { provider: 'openai', modelId: 'gpt-4o', ...settings },
  }
}

function renderContent(session: Session, mode: 'chat' | 'work' = 'chat') {
  const onEdit = vi.fn()
  return Object.assign(onEdit, {
    view: render(
      <MantineProvider>
        <SessionSettingsContent session={session} mode={mode} onEdit={onEdit} />
      </MantineProvider>
    ),
  })
}

describe('SessionSettingsContent', () => {
  beforeEach(() => {
    globalSettings.maxContextMessageCount = 20
    globalSettings.temperature = undefined
  })

  test('shows inherited values and names the model the parameters apply to', () => {
    renderContent(makeSession({}))
    expect(screen.getByText('Applies to GPT-4o')).toBeTruthy()
    expect(screen.getByTestId('session-panel-inherit-max-context').textContent).toBe('Follows global · 20')
    expect(screen.getByTestId('session-panel-inherit-temperature').textContent).toBe('Follows global · Model default')
    expect(screen.getByText('All parameters follow global defaults')).toBeTruthy()
  })

  test('restores one overridden parameter to the inherited value', () => {
    const onEdit = renderContent(makeSession({ temperature: 0.3 }))
    const state = screen.getByTestId('session-panel-inherit-temperature')
    expect(state.getAttribute('data-inherit-state')).toBe('overridden')
    fireEvent.click(state.querySelector('button') as HTMLButtonElement)
    expect(onEdit).toHaveBeenCalledWith({ settings: { temperature: undefined } })
  })

  test('restores every overridden parameter at once', () => {
    const onEdit = renderContent(makeSession({ temperature: 0.3, maxContextMessageCount: 50 }))
    expect(screen.getByText('2 differ from global defaults')).toBeTruthy()
    fireEvent.click(screen.getByTestId('session-panel-restore-all'))
    const patch = onEdit.mock.calls[0][0].settings
    expect(patch).toMatchObject({ temperature: undefined, maxContextMessageCount: undefined })
    expect(Object.keys(patch)).not.toContain('provider')
  })

  test('offers undo beside the summary after restoring all', () => {
    const session = makeSession({ temperature: 0.3 })
    const onEdit = renderContent(session)
    fireEvent.click(screen.getByTestId('session-panel-restore-all'))
    onEdit.view.rerender(
      <MantineProvider>
        <SessionSettingsContent session={makeSession({})} mode="chat" onEdit={onEdit} />
      </MantineProvider>
    )
    fireEvent.click(screen.getByTestId('session-panel-undo-restore'))
    expect(onEdit).toHaveBeenLastCalledWith({ settings: expect.objectContaining({ temperature: 0.3 }) })
  })

  test('offers the persona instead of a system prompt in Work Mode', () => {
    renderContent(makeSession({}), 'work')
    expect(screen.queryByTestId('session-settings-prompt')).toBeNull()
    expect(screen.getByText('Edit persona')).toBeTruthy()
  })

  test('commits a name still being typed when the panel closes', () => {
    const onEdit = renderContent(makeSession({}))
    fireEvent.change(screen.getByTestId('session-settings-name'), { target: { value: 'Renamed chat' } })
    expect(onEdit).not.toHaveBeenCalled()
    onEdit.view.unmount()
    expect(onEdit).toHaveBeenCalledWith({ name: 'Renamed chat' })
  })
})
