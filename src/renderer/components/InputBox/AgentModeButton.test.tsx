// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { AgentModeValue } from '@shared/types'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@/test-utils'

const mocks = vi.hoisted(() => ({
  platform: { type: 'desktop', isDesktopLike: true },
  addBackButtonListener: vi.fn(),
  settingsState: {
    extension: { webSearch: { provider: 'build-in' as const } },
    licenseKey: '',
  },
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

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/', search: {} }),
}))

let agentModeValue: AgentModeValue = 'on'

vi.mock('@/stores/session/agent-mode', () => ({
  useSessionAgentMode: () => ({ value: agentModeValue, locked: false, lockReason: null }),
}))

vi.mock('@/platform', () => ({ default: mocks.platform }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: typeof mocks.settingsState) => unknown) => selector(mocks.settingsState),
}))

vi.mock('@capacitor/app', () => ({
  App: { addListener: mocks.addBackButtonListener },
}))

vi.mock('./AgentModePanel', () => ({
  default: ({ onWebBrowsingChange }: { onWebBrowsingChange: (enabled: boolean) => void }) => (
    <div>
      Agent mode menu
      <button type="button" onClick={() => onWebBrowsingChange(true)}>
        Toggle Web Search
      </button>
    </div>
  ),
}))

import AgentModeButton from './AgentModeButton'

function renderButton({
  modelSupportsAgentMode = true,
  compact = false,
  layout,
  onWebBrowsingChange = vi.fn(),
  webBrowsingMode = false,
}: {
  modelSupportsAgentMode?: boolean
  compact?: boolean
  layout?: 'desktop' | 'touch'
  onWebBrowsingChange?: (enabled: boolean) => void
  webBrowsingMode?: boolean
} = {}) {
  return render(
    <MantineProvider>
      <AgentModeButton
        sessionId="session-1"
        modelSupportsAgentMode={modelSupportsAgentMode}
        compact={compact}
        layout={layout}
        webBrowsingMode={webBrowsingMode}
        onWebBrowsingChange={onWebBrowsingChange}
        onKnowledgeBaseSelect={vi.fn()}
        onSkillSelect={vi.fn()}
      />
    </MantineProvider>
  )
}

describe('AgentModeButton', () => {
  beforeEach(() => {
    agentModeValue = 'on'
    mocks.platform.type = 'desktop'
    mocks.platform.isDesktopLike = true
    mocks.settingsState.extension.webSearch.provider = 'build-in'
    mocks.settingsState.licenseKey = ''
    mocks.addBackButtonListener.mockReset()
    window.localStorage.clear()
  })

  test('keeps independent capabilities available when the selected model does not support agent tools', () => {
    window.localStorage.setItem('chatbox.web-search-moved-tip-dismissed.v1', 'true')
    renderButton({ modelSupportsAgentMode: false })

    const button = screen.getByRole('button', { name: 'Chat Mode' })
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)

    expect(screen.getByText('Agent mode menu')).toBeTruthy()
  })

  test('remains enabled for a model that supports agent tools', () => {
    renderButton()

    expect(screen.getByRole('button', { name: 'Work Mode' })).toHaveProperty('disabled', false)
  })

  test('keeps the mode text in regular mode', () => {
    renderButton()

    expect(screen.getByRole('button', { name: 'Work Mode' }).textContent).toBe('Work Mode')
  })

  test('marks the mode trigger while enabled Web Search needs configuration', () => {
    const view = renderButton({ webBrowsingMode: true })

    expect(view.container.querySelector('[data-web-search-warning]')).toBeTruthy()
  })

  test('opens and closes the mode menu by click for touch input', () => {
    window.localStorage.setItem('chatbox.web-search-moved-tip-dismissed.v1', 'true')
    renderButton({ layout: 'touch' })

    const button = screen.getByRole('button', { name: 'Work Mode' })
    fireEvent.click(button)
    expect(screen.getByText('Agent mode menu')).toBeTruthy()

    fireEvent.click(button)
    expect(screen.queryByText('Agent mode menu')).toBeNull()
  })

  test('keeps the desktop mode menu open when the trigger is clicked after hover', async () => {
    window.localStorage.setItem('chatbox.web-search-moved-tip-dismissed.v1', 'true')
    renderButton({ layout: 'desktop' })

    const button = screen.getByRole('button', { name: 'Work Mode' })
    fireEvent.mouseEnter(button)
    await waitFor(() => expect(screen.getByText('Agent mode menu')).toBeTruthy())

    fireEvent.click(button)
    expect(screen.getByText('Agent mode menu')).toBeTruthy()
  })

  test('keeps the message input blurred after changing Web Search in the touch sheet', () => {
    window.localStorage.setItem('chatbox.web-search-moved-tip-dismissed.v1', 'true')
    const input = document.createElement('textarea')
    input.id = 'message-input'
    document.body.append(input)
    const onWebBrowsingChange = vi.fn(() => input.focus())
    renderButton({ layout: 'touch', onWebBrowsingChange })

    fireEvent.click(screen.getByRole('button', { name: 'Work Mode' }))
    input.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Web Search' }))

    expect(onWebBrowsingChange).toHaveBeenCalledWith(true)
    expect(document.activeElement).not.toBe(input)
    input.remove()
  })

  test('removes an Android back listener that resolves after the touch sheet closes', async () => {
    window.localStorage.setItem('chatbox.web-search-moved-tip-dismissed.v1', 'true')
    mocks.platform.type = 'mobile'
    mocks.platform.isDesktopLike = false
    const remove = vi.fn(async () => undefined)
    let resolveListener: ((handle: { remove: () => Promise<void> }) => void) | undefined
    mocks.addBackButtonListener.mockReturnValue(
      new Promise((resolve) => {
        resolveListener = resolve
      })
    )
    renderButton({ layout: 'touch' })

    const trigger = screen.getByRole('button', { name: 'Chat Mode' })
    fireEvent.click(trigger)
    await waitFor(() => expect(mocks.addBackButtonListener).toHaveBeenCalledOnce())
    fireEvent.click(trigger)
    await act(async () => {
      resolveListener?.({ remove })
      await Promise.resolve()
    })

    expect(remove).toHaveBeenCalledOnce()
  })

  test.each([
    ['on', 'on', 'Work Mode'],
    ['off', 'off', 'Chat Mode'],
  ] as const)('shows a status icon instead of the mode text for %s', (value, expectedMode, label) => {
    agentModeValue = value
    const view = renderButton({ compact: true })

    const button = screen.getByRole('button', { name: label })
    expect(button.textContent).toBe('')
    expect(view.container.querySelector(`[data-agent-mode="${expectedMode}"]`)).toBeTruthy()
    expect(view.container.querySelector(`[data-agent-mode-status="${expectedMode}"]`)).toBeTruthy()
  })

  test('falls back to the chat mode status icon when the model is unsupported', () => {
    const view = renderButton({ modelSupportsAgentMode: false, compact: true })

    expect(screen.getByRole('button', { name: 'Chat Mode' })).toHaveProperty('disabled', false)
    expect(view.container.querySelector('[data-agent-mode-status="off"]')).toBeTruthy()
  })

  test('shows the Web Search migration tip until the user dismisses it', () => {
    const view = renderButton()

    expect(screen.getByText('Web Search has moved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByText('Web Search has moved')).toBeNull()
    expect(screen.queryByText('Agent mode menu')).toBeNull()
    expect(window.localStorage.getItem('chatbox.web-search-moved-tip-dismissed.v1')).toBe('true')

    view.unmount()
    renderButton()
    expect(screen.queryByText('Web Search has moved')).toBeNull()
  })
})
