// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { createMessage, type Session } from '@shared/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
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

import { add as addToast } from '@/stores/toastActions'
import { ContextLimitSettingRow } from '../settings/ParamControl'
import { SessionSettingsContent } from './SessionSettingsContent'
import type { SessionEdit } from './session-edit'

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
    expect(screen.getByTestId('session-settings-max-context')).toHaveProperty('value', 'Follows global · 20')
    expect(screen.getByTestId('session-panel-inherit-max-context').getAttribute('data-inherit-state')).toBe('inherited')
    expect(screen.getByTestId('session-panel-inherit-temperature').textContent).toBe('Follows global · Model default')
    expect(screen.getByText('All parameters follow global defaults')).toBeTruthy()
  })

  test('sets a conversation context limit and follows global again from the picker', () => {
    const onEdit = renderContent(makeSession({ maxContextMessageCount: 37 }))
    const maxContext = screen.getByTestId('session-settings-max-context')
    expect(maxContext).toHaveProperty('value', '37')
    expect(screen.getByTestId('session-settings-max-context-custom')).toHaveProperty('value', '37')
    fireEvent.click(maxContext)
    fireEvent.click(screen.getByRole('option', { name: '10' }))
    expect(onEdit).toHaveBeenLastCalledWith({ settings: { maxContextMessageCount: 10 } })
    fireEvent.click(maxContext)
    fireEvent.click(screen.getByRole('option', { name: 'Follows global · 20' }))
    expect(onEdit).toHaveBeenLastCalledWith({ settings: { maxContextMessageCount: undefined } })
  })

  test('opens a custom count without changing inheritance and saves it on panel close', () => {
    const onEdit = renderContent(makeSession({}))
    fireEvent.click(screen.getByTestId('session-settings-max-context'))
    fireEvent.click(screen.getByRole('option', { name: 'Custom' }))
    expect(onEdit).not.toHaveBeenCalled()
    const input = screen.getByTestId('session-settings-max-context-custom')
    fireEvent.change(input, { target: { value: '8' } })
    onEdit.view.unmount()
    expect(onEdit).toHaveBeenLastCalledWith({ settings: { maxContextMessageCount: 8 } })
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

  test('shows a switch change at once and follows the stored value once its save settles', async () => {
    let finishSave = () => {}
    const onEdit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        })
    )
    const renderWith = (session: Session) => (
      <MantineProvider>
        <SessionSettingsContent session={session} mode="chat" onEdit={onEdit} />
      </MantineProvider>
    )
    const view = render(renderWith(makeSession({})))
    const streamSwitch = () => screen.getByRole('switch', { name: 'Stream output' }) as HTMLInputElement
    fireEvent.click(streamSwitch())
    expect(onEdit).toHaveBeenLastCalledWith({ settings: { stream: false } })
    expect(streamSwitch().checked).toBe(false)
    await act(async () => finishSave())
    expect(streamSwitch().checked).toBe(false)
    view.rerender(renderWith(makeSession({ stream: false })))
    expect(streamSwitch().checked).toBe(false)
    view.rerender(renderWith(makeSession({ stream: true })))
    expect(streamSwitch().checked).toBe(true)
  })

  test('a failed save reverts only its own change and reports it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const saves: { resolve: () => void; reject: (error: Error) => void }[] = []
    const onEdit = vi.fn(
      (_edit: SessionEdit) =>
        new Promise<void>((resolve, reject) => {
          saves.push({ resolve, reject })
        })
    )
    const renderWith = (session: Session) => (
      <MantineProvider>
        <SessionSettingsContent session={session} mode="chat" onEdit={onEdit} />
      </MantineProvider>
    )
    const view = render(renderWith(makeSession({})))
    const streamSwitch = () => screen.getByRole('switch', { name: 'Stream output' }) as HTMLInputElement
    fireEvent.click(streamSwitch())
    fireEvent.click(streamSwitch())
    fireEvent.click(streamSwitch())
    expect(onEdit.mock.calls.map(([edit]) => edit)).toEqual([
      { settings: { stream: false } },
      { settings: { stream: true } },
      { settings: { stream: false } },
    ])
    await act(async () => saves[0].reject(new Error('Disk full')))
    expect(addToast).toHaveBeenLastCalledWith('Failed to save settings')
    expect(streamSwitch().checked).toBe(false)
    await act(() => {
      saves[1].resolve()
      saves[2].resolve()
      return Promise.resolve()
    })
    view.rerender(renderWith(makeSession({ stream: false })))
    expect(streamSwitch().checked).toBe(false)

    await act(() => {
      fireEvent.click(streamSwitch())
      saves[3].reject(new Error('Disk full'))
      return Promise.resolve()
    })
    expect(streamSwitch().checked).toBe(false)
  })

  test('reports a failed name save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(addToast).mockClear()
    const onEdit = vi.fn(() => Promise.reject(new Error('Session not found')))
    render(
      <MantineProvider>
        <SessionSettingsContent session={makeSession({})} mode="chat" onEdit={onEdit} />
      </MantineProvider>
    )
    const name = screen.getByTestId('session-settings-name')
    fireEvent.change(name, { target: { value: 'Renamed chat' } })
    await act(async () => fireEvent.blur(name))
    expect(onEdit).toHaveBeenCalledWith({ name: 'Renamed chat' })
    expect(addToast).toHaveBeenCalledWith('Failed to save settings')
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

test('global context count accepts custom counts and zero, restores invalid drafts, and switches to presets', () => {
  function GlobalContextControl() {
    const [value, setValue] = useState(Number.MAX_SAFE_INTEGER)
    return <ContextLimitSettingRow value={value} onChange={setValue} inputTestId="custom-count" />
  }
  render(
    <MantineProvider>
      <GlobalContextControl />
    </MantineProvider>
  )
  const input = screen.getByTestId('custom-count')
  fireEvent.change(input, { target: { value: '37' } })
  fireEvent.blur(input)
  expect(input).toHaveProperty('value', '37')
  fireEvent.change(input, { target: { value: '9007199254740992' } })
  fireEvent.blur(input)
  expect(input).toHaveProperty('value', '37')
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.blur(input)
  expect(input).toHaveProperty('value', '37')
  fireEvent.change(input, { target: { value: '0' } })
  fireEvent.blur(input)
  expect(input).toHaveProperty('value', '0')
  fireEvent.click(screen.getByRole('radio', { name: '50' }))
  expect(input).toHaveProperty('value', '50')
  fireEvent.click(screen.getByRole('radio', { name: 'No Limit' }))
  expect(input).toHaveProperty('value', '')
})
