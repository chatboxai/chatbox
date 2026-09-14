// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import type { LocalWorkCapabilityId } from '@shared/mobile-work/capabilities'
import type { AgentModeEntry, Session } from '@shared/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import type { AgentModePanelHandle } from './AgentModePanel'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  plugins: ['Camera', 'MobileSystemTools'],
  entry: { value: 'on', locked: false, lockReason: null } as AgentModeEntry,
  session: { id: 'existing', settings: {}, messages: [] } as unknown as Session,
  draft: {} as { localWorkCapabilities?: LocalWorkCapabilityId[] },
  setDraft: vi.fn(),
  updateSession: vi.fn(),
  saveMode: vi.fn(),
  navigate: vi.fn(),
  active: false,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => mocks.platform,
    isPluginAvailable: (name: string) => mocks.plugins.includes(name),
  },
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { updateSession: mocks.updateSession },
    generationHooks: { useVersion: () => 0 },
    generationRuntime: { getActiveMessageIds: () => new Set(mocks.active ? ['running'] : []) },
  },
}))
vi.mock('@/hooks/useSessionPresentation', () => ({
  useSessionPresentation: () => ({ readModel: { kind: 'full', session: mocks.session }, header: mocks.session }),
}))
vi.mock('@/hooks/useSessionLockState', () => ({
  useSessionLockState: () => ({ anyReplyGenerating: false, compactionRunning: false, awaitingPauseDecision: false }),
}))
vi.mock('@/stores/session/agent-mode', () => ({
  useSessionAgentMode: () => mocks.entry,
  setSessionAgentMode: mocks.saveMode,
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: unknown) => unknown) =>
    selector({ newSessionState: mocks.draft, setNewSessionState: mocks.setDraft, setAgentModeLastSelected: vi.fn() }),
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ extension: { webSearch: { provider: 'build-in' } }, licenseKey: '' }),
}))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: mocks.navigate }))

import MobileAgentModePanel from './MobileAgentModePanel'

const renderPanel = (sessionId = 'new', hasDraftAttachments = false, ref?: React.Ref<AgentModePanelHandle>) =>
  render(
    <MantineProvider>
      <MobileAgentModePanel
        ref={ref}
        sessionId={sessionId}
        hasDraftAttachments={hasDraftAttachments}
        webBrowsingMode={false}
        onWebBrowsingChange={vi.fn()}
        onClose={vi.fn()}
        onKnowledgeBaseSelect={vi.fn()}
        onSkillSelect={vi.fn()}
      />
    </MantineProvider>
  )

beforeEach(() => {
  vi.clearAllMocks()
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  mocks.platform = 'ios'
  mocks.plugins = ['Camera', 'MobileSystemTools']
  mocks.entry = { value: 'on', locked: false, lockReason: null }
  mocks.session = { id: 'existing', settings: {}, messages: [] } as unknown as Session
  mocks.draft = {}
  mocks.active = false
  mocks.updateSession.mockImplementation((_id: string, update: (session: Session) => Session) => {
    mocks.session = update(mocks.session)
    return Promise.resolve()
  })
  mocks.setDraft.mockImplementation((update: (draft: typeof mocks.draft) => typeof mocks.draft) => {
    mocks.draft = update(mocks.draft)
  })
})

describe('Mobile Agent Mode capabilities', () => {
  test('offers only opt-in system capabilities and saves selection on a new chat', async () => {
    renderPanel()
    expect(screen.queryByRole('switch', { name: 'Code Execution' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Spreadsheets and presentations' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Device services' }))
    expect(screen.getAllByRole('switch')).toHaveLength(4)
    expect(screen.getByRole('switch', { name: 'Calendar' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('switch', { name: 'Calendar' }))
    await waitFor(() => expect(mocks.draft.localWorkCapabilities).toContain('calendar'))
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })
  test('queues existing-session changes and preserves other system selections', async () => {
    mocks.session.settings = { localWorkCapabilities: ['calendar', 'photos'] }
    renderPanel('existing')
    fireEvent.click(screen.getByRole('button', { name: 'Device services' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Calendar' }))
    await waitFor(() => expect(mocks.session.settings?.localWorkCapabilities).toEqual(['photos']))
    expect(mocks.updateSession).toHaveBeenCalledWith('existing', expect.any(Function))
  })
  test('does not offer unavailable Android system tools', () => {
    mocks.platform = 'android'
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Device services' }))
    expect(screen.queryByRole('switch', { name: 'Calendar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Reminders' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Health (read only)' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Photos' })).not.toBeDisabled()
  })
  test('locks mode after a user message and locks capabilities while generation runs', () => {
    mocks.session.messages = [{ id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] }]
    mocks.active = true
    renderPanel('existing')
    expect(screen.getByRole('button', { name: 'Chat Mode' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Device services' }))
    expect(screen.getByRole('switch', { name: 'Calendar' })).toBeDisabled()
  })
  test('returns from device services to the main menu', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Device services' }))
    expect(screen.queryByRole('switch', { name: 'Web Search' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('switch', { name: 'Web Search' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Calendar' })).not.toBeInTheDocument()
  })
  test('consumes the host back action only while a submenu is open', () => {
    const ref = createRef<AgentModePanelHandle>()
    renderPanel('new', false, ref)
    expect(ref.current?.goBack()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Device services' }))
    act(() => {
      expect(ref.current?.goBack()).toBe(true)
    })
    expect(screen.getByRole('switch', { name: 'Web Search' })).toBeInTheDocument()
    expect(ref.current?.goBack()).toBe(false)
  })
  test('opens the existing Web Search settings entry', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Web Search Settings' }))
    expect(mocks.navigate).toHaveBeenCalledWith('/web-search')
  })
})

test('keeps attachment processing mode fixed until draft attachments are removed', () => {
  renderPanel('new', true)
  const chat = screen.getByRole('button', { name: 'Chat Mode' })
  expect(chat).toBeDisabled()
  fireEvent.click(chat)
  expect(mocks.saveMode).not.toHaveBeenCalled()
})
