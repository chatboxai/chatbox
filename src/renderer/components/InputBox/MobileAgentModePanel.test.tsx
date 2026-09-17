// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import type { LocalWorkCapabilityId } from '@shared/mobile-work/capabilities'
import type { AgentModeEntry, Session } from '@shared/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ComponentProps, createRef } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentModePanelHandle } from './AgentModePanel'

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
  settings: { memoryEnabled: true },
  setSettings: vi.fn(),
  owners: [] as Array<{ id: string; name: string }>,
  copilots: [] as Array<{ id: string; name: string; prompt: string }>,
  setCopilotMemory: vi.fn(),
  updateCopilot: vi.fn(),
  listMemories: vi.fn(),
  listCopilotMemories: vi.fn(),
  showModal: vi.fn(),
  close: vi.fn(),
  trackMemory: vi.fn(),
}))
vi.mock('@/components/mcp/MCPConnectionSummary', () => ({ MCPConnectionSummary: () => null }))
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
    selector({
      extension: { webSearch: { provider: 'build-in' } },
      licenseKey: '',
      ...mocks.settings,
      setSettings: mocks.setSettings,
    }),
}))
vi.mock('@/hooks/useCopilots', () => ({
  useMyCopilots: () => ({ copilots: mocks.copilots, addOrUpdate: mocks.updateCopilot }),
  useCopilotMemory: () => ({
    owners: mocks.owners,
    isEnabled: (id: string) => mocks.owners.some((owner) => owner.id === id),
    setEnabled: mocks.setCopilotMemory,
  }),
}))
vi.mock('@/stores/agentPersonaStore', () => ({
  listMemories: mocks.listMemories,
  listCopilotMemories: mocks.listCopilotMemories,
}))
vi.mock('@ebay/nice-modal-react', () => ({ default: { show: mocks.showModal } }))
vi.mock('@/analytics/agent-mode', () => ({ trackMemoryClick: mocks.trackMemory }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: mocks.navigate }))

import MobileAgentModePanel from './MobileAgentModePanel'

const panel = (props: Partial<ComponentProps<typeof MobileAgentModePanel>> = {}) => (
  <MantineProvider>
    <MobileAgentModePanel
      sessionId="new"
      webBrowsingMode={false}
      onWebBrowsingChange={vi.fn()}
      onClose={mocks.close}
      onKnowledgeBaseSelect={vi.fn()}
      onSkillSelect={vi.fn()}
      {...props}
    />
  </MantineProvider>
)
const renderPanel = (sessionId = 'new', hasDraftAttachments = false, ref?: React.Ref<AgentModePanelHandle>) =>
  render(panel({ sessionId, hasDraftAttachments, ref }))

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
  mocks.settings.memoryEnabled = true
  mocks.owners = []
  mocks.copilots = []
  mocks.listMemories.mockResolvedValue([])
  mocks.listCopilotMemories.mockResolvedValue([])
  mocks.setSettings.mockImplementation((update: { memoryEnabled: boolean }) => Object.assign(mocks.settings, update))
  mocks.setCopilotMemory.mockImplementation((owner: { id: string; name: string }, enabled: boolean) => {
    mocks.owners = enabled ? [...mocks.owners, owner] : mocks.owners.filter((item) => item.id !== owner.id)
  })
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

test('opens mobile MCP settings', () => {
  renderPanel()
  fireEvent.click(screen.getByRole('button', { name: 'MCP Settings' }))
  expect(mocks.navigate).toHaveBeenCalledWith('/mcp')
})

describe('Mobile Agent Mode memory', () => {
  test.each(['on', 'off'] as const)(
    'offers memory in %s mode and returns with the header and native back',
    async (mode) => {
      mocks.entry.value = mode
      mocks.listMemories.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }])
      const ref = createRef<AgentModePanelHandle>()
      renderPanel('new', false, ref)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Memory' })).toHaveTextContent('2'))
      expect(screen.getByRole('button', { name: 'Memory' })).toHaveTextContent('Global Memory')
      fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
      expect(screen.getByRole('switch', { name: 'Copilot Memory' })).toBeDisabled()
      expect(screen.getByRole('switch', { name: 'Global Memory' })).toBeChecked()
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
      act(() => {
        expect(ref.current?.goBack()).toBe(true)
      })
      expect(screen.getByRole('button', { name: 'Memory' })).toBeInTheDocument()
      expect(ref.current?.goBack()).toBe(false)
    }
  )

  test('toggles global memory, keeps retained memories manageable, and closes before settings', async () => {
    const view = render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Global Memory' }))
    expect(mocks.setSettings).toHaveBeenCalledWith({ memoryEnabled: false })
    view.rerender(panel())
    expect(screen.getByRole('switch', { name: 'Global Memory' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Memory' })).toHaveTextContent('Off')
    fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Manage memories' }))
    expect(mocks.navigate).toHaveBeenCalledWith('/agent')
    expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.navigate.mock.invocationCallOrder[0])
  })

  test('enables draft Copilot memory by id and falls back to global memory when disabled', async () => {
    const props = { draftCopilotId: 'featured', draftCopilotName: 'Writing Coach' }
    const view = render(panel(props))
    fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Copilot Memory' }))
    expect(mocks.setCopilotMemory).toHaveBeenCalledWith({ id: 'featured', name: 'Writing Coach' }, true)
    view.rerender(panel(props))
    expect(screen.getByRole('switch', { name: 'Copilot Memory' })).toBeChecked()
    expect(screen.queryByRole('switch', { name: 'Global Memory' })).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.listCopilotMemories).toHaveBeenCalledWith('featured'))
    fireEvent.click(screen.getByRole('switch', { name: 'Copilot Memory' }))
    view.rerender(panel(props))
    expect(screen.getByRole('switch', { name: 'Global Memory' })).toBeChecked()
    await waitFor(() => expect(mocks.listMemories).toHaveBeenCalledTimes(2))
  })

  test('uses the existing session Copilot and closes before opening its saved settings', async () => {
    mocks.session.copilotId = 'saved'
    mocks.copilots = [{ id: 'saved', name: 'Tutor', prompt: '' }]
    mocks.owners = [{ id: 'saved', name: 'Tutor' }]
    render(panel({ sessionId: 'existing', draftCopilotId: 'other' }))
    expect(screen.getByRole('button', { name: 'Memory' })).toHaveTextContent('Copilot Memory')
    fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
    expect(screen.getByText('Tutor')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Manage memories' }))
    expect(mocks.listCopilotMemories).toHaveBeenCalledWith('saved')
    expect(mocks.showModal).toHaveBeenCalledWith('copilot-settings', {
      copilot: mocks.copilots[0],
      mode: 'edit',
      onSave: mocks.updateCopilot,
    })
    expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.showModal.mock.invocationCallOrder[0])
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
