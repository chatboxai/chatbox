/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test-utils'

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

HTMLElement.prototype.scrollTo = vi.fn()

const mocks = vi.hoisted(() => {
  const settingsState = {
    extension: {
      webSearch: {
        provider: 'build-in',
        tavilyApiKey: '',
      },
    },
    licenseKey: '',
    memoryEnabled: true,
    skills: {
      enabledSkillNames: [],
    },
    setSettings: vi.fn(),
  }
  const uiState = {
    newSessionState: {},
    newSessionCommandApprovalModeDefault: undefined as string | undefined,
    newSessionWorkingDirectoriesDefault: undefined as string[] | undefined,
    setAgentModeSmartSwitchingDefault: vi.fn(),
    setAgentModeLastSelected: vi.fn(),
    setNewSessionState: vi.fn(),
    setNewSessionCommandApprovalModeDefault: vi.fn(),
    setNewSessionWorkingDirectoriesDefault: vi.fn(),
  }
  const agentModeEntry = {
    value: 'on' as 'auto' | 'on' | 'off',
    locked: false,
    lockReason: null,
  }
  const knowledgeBases: Array<{ id: number; name: string }> = []
  const useKnowledgeBasesMock = vi.fn(() => ({ data: knowledgeBases }))
  const openDirectoryDialogMock = vi.fn()
  const trackWebSearchClickMock = vi.fn()
  const trackMemoryClickMock = vi.fn()
  const setSessionAgentModeMock = vi.fn()
  const listMemoriesMock = vi.fn(() => new Promise<Array<{ id: string; content: string; createdAt: number }>>(() => {}))
  const listCopilotMemoriesMock = vi.fn(
    (_copilotId: string) => new Promise<Array<{ id: string; content: string; createdAt: number }>>(() => {})
  )
  const myCopilots: Array<{ id: string; name: string; prompt: string }> = []
  const copilotMemoryOwners: Array<{ id: string; name: string }> = []
  const setCopilotMemoryMock = vi.fn()
  const addOrUpdateCopilotMock = vi.fn()
  const niceModalShowMock = vi.fn()
  const navigateToSettingsMock = vi.fn()
  const platform = { type: 'desktop', isDesktopLike: true, openDirectoryDialog: openDirectoryDialogMock }
  const featureFlags = { knowledgeBase: true, skills: true, mcp: true, agentMode: true }
  const toastAddMock = vi.fn()

  return {
    addOrUpdateCopilotMock,
    agentModeEntry,
    copilotMemoryOwners,
    featureFlags,
    knowledgeBases,
    listCopilotMemoriesMock,
    listMemoriesMock,
    myCopilots,
    navigateToSettingsMock,
    niceModalShowMock,
    openDirectoryDialogMock,
    platform,
    setCopilotMemoryMock,
    setSessionAgentModeMock,
    settingsState,
    trackMemoryClickMock,
    trackWebSearchClickMock,
    toastAddMock,
    uiState,
    useKnowledgeBasesMock,
  }
})

vi.mock('@ebay/nice-modal-react', () => ({
  __esModule: true,
  default: { show: mocks.niceModalShowMock, create: (component: unknown) => component, register: vi.fn() },
  useModal: () => ({ visible: false, hide: vi.fn(), resolve: vi.fn() }),
}))

vi.mock('@/hooks/useCopilots', () => ({
  useMyCopilots: () => ({ copilots: mocks.myCopilots, addOrUpdate: mocks.addOrUpdateCopilotMock, remove: vi.fn() }),
  useCopilotMemory: () => ({
    owners: mocks.copilotMemoryOwners,
    isEnabled: (copilotId: string) => mocks.copilotMemoryOwners.some((owner) => owner.id === copilotId),
    setEnabled: mocks.setCopilotMemoryMock,
  }),
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      typeof options?.count === 'number' ? key.replace('{{count}}', String(options.count)) : key,
  }),
}))

vi.mock('@/analytics/agent-mode', () => ({
  trackAgentModeSelect: vi.fn(),
  trackCodeExecutionClick: vi.fn(),
  trackSmartSwitchingClick: vi.fn(),
  trackMemoryClick: mocks.trackMemoryClickMock,
  trackWebSearchClick: mocks.trackWebSearchClickMock,
}))

vi.mock('@/hooks/knowledge-base', () => ({
  useKnowledgeBases: mocks.useKnowledgeBasesMock,
}))

vi.mock('@/hooks/mcp', () => ({
  useMCPServerStatus: () => undefined,
  useToggleMCPServer: () => vi.fn(),
}))

vi.mock('@/modals/settings-navigation', () => ({
  navigateToSettings: mocks.navigateToSettingsMock,
}))

vi.mock('@/packages/navigator', () => ({
  getOS: () => 'macOS',
}))

vi.mock('@/packages/skills/controller', () => ({
  skillsController: {
    discoverSkills: vi.fn(() => new Promise(() => {})),
  },
  subscribeSkillsChanged: () => vi.fn(),
}))

vi.mock('@/platform', () => ({
  default: mocks.platform,
}))

vi.mock('@/utils/feature-flags', () => ({ featureFlags: mocks.featureFlags }))

vi.mock('@/stores/toastActions', () => ({ add: mocks.toastAddMock }))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { updateSession: vi.fn() },
    sessionHooks: { useSession: () => ({ session: undefined }) },
  },
}))
vi.mock('@/stores/session/session-settings', () => ({
  useSessionSettings: () => ({ sessionSettings: {} }),
}))

vi.mock('@/stores/premiumActions', () => ({
  useAutoValidate: () => false,
}))

vi.mock('@/stores/session/agent-mode', () => ({
  setSessionAgentMode: mocks.setSessionAgentModeMock,
  useSessionAgentMode: () => mocks.agentModeEntry,
}))

vi.mock('@/stores/agentPersonaStore', () => ({
  listMemories: mocks.listMemoriesMock,
  listCopilotMemories: mocks.listCopilotMemoriesMock,
}))

vi.mock('@/stores/settingsStore', () => ({
  useMcpSettings: () => ({ servers: [], enabledBuiltinServers: [] }),
  useSettingsStore: (selector: (state: typeof mocks.settingsState) => unknown) => selector(mocks.settingsState),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: typeof mocks.uiState) => unknown) => selector(mocks.uiState),
}))

import { TestId } from '@shared/automation/testids'
import { recentDirectoriesStore } from '@/stores/recentDirectoriesStore'
import AgentModePanel from './AgentModePanel'

const defaultProps: ComponentProps<typeof AgentModePanel> = {
  sessionId: 'new',
  modelSupportsAgentMode: true,
  webBrowsingMode: false,
  onWebBrowsingChange: vi.fn(),
  onKnowledgeBaseSelect: vi.fn(),
  onSkillSelect: vi.fn(),
  onClose: vi.fn(),
}

function renderPanel(props: Partial<ComponentProps<typeof AgentModePanel>> = {}) {
  return render(
    <MantineProvider>
      <AgentModePanel {...defaultProps} {...props} />
    </MantineProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.agentModeEntry.value = 'on'
  mocks.knowledgeBases.splice(0)
  mocks.settingsState.extension.webSearch.provider = 'build-in'
  mocks.settingsState.extension.webSearch.tavilyApiKey = ''
  mocks.settingsState.licenseKey = ''
  mocks.settingsState.memoryEnabled = true
  mocks.listMemoriesMock.mockImplementation(() => new Promise(() => {}))
  mocks.listCopilotMemoriesMock.mockImplementation(() => new Promise(() => {}))
  mocks.myCopilots.splice(0)
  mocks.copilotMemoryOwners.splice(0)
  mocks.platform.type = 'desktop'
  mocks.platform.isDesktopLike = true
  mocks.featureFlags.knowledgeBase = true
  mocks.featureFlags.skills = true
  mocks.featureFlags.mcp = true
  mocks.featureFlags.agentMode = true
  mocks.uiState.newSessionState = {}
  mocks.uiState.newSessionCommandApprovalModeDefault = undefined
  mocks.uiState.newSessionWorkingDirectoriesDefault = undefined
  recentDirectoriesStore.setState({ directories: [] })
})

describe('AgentModePanel mode buttons', () => {
  test('label the chat and work mode buttons with the same status icons as the composer button', () => {
    const view = renderPanel()

    const chatMode = screen.getByRole('button', { name: 'Chat Mode' })
    const workMode = screen.getByRole('button', { name: 'Work Mode' })

    expect(chatMode.querySelector('[data-agent-mode-status="off"]')).toBeTruthy()
    expect(workMode.querySelector('[data-agent-mode-status="on"]')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-agent-mode-status]')).toHaveLength(2)
  })

  test('keeps global Agent settings out of the per-chat capability menu', () => {
    renderPanel()

    expect(screen.queryByRole('button', { name: 'Soul & Memories' })).toBeNull()
  })

  test('remembers an explicit switch to Chat Mode for future new chats', () => {
    mocks.agentModeEntry.value = 'on'
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Chat Mode' }))

    expect(mocks.uiState.setAgentModeLastSelected).toHaveBeenCalledWith('off')
    expect(mocks.setSessionAgentModeMock).toHaveBeenCalledWith('new', 'off')
  })

  test('remembers an explicit switch to Work Mode for future new chats', () => {
    mocks.agentModeEntry.value = 'off'
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Work Mode' }))

    expect(mocks.uiState.setAgentModeLastSelected).toHaveBeenCalledWith('on')
    expect(mocks.setSessionAgentModeMock).toHaveBeenCalledWith('new', 'on')
  })

  test('shows Chat Mode as the current state on web without a Work Mode switcher', () => {
    mocks.platform.type = 'web'
    mocks.platform.isDesktopLike = false
    mocks.agentModeEntry.value = 'off'
    renderPanel({ modelSupportsAgentMode: false })

    expect(screen.getByText('Chat Mode')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Work Mode' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Chat Mode' })).toBeNull()
    expect(screen.queryByText('Smart Switching')).toBeNull()
    expect(
      screen.getByText('This app currently supports Chat Mode only. Use Work Mode on the desktop app.')
    ).toBeTruthy()
    expect(
      screen.getByText('Skills, MCP, code execution, and Working Directory are available in the desktop app.')
    ).toBeTruthy()
  })

  test('does not query or show Knowledge Base where the platform capability is unavailable', () => {
    mocks.platform.type = 'web'
    mocks.platform.isDesktopLike = false
    mocks.featureFlags.knowledgeBase = false

    renderPanel()

    expect(mocks.useKnowledgeBasesMock).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('button', { name: 'Knowledge Base' })).toBeNull()
  })

  test('keeps the remembered mode untouched when re-selecting the current mode', () => {
    mocks.agentModeEntry.value = 'on'
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Work Mode' }))

    expect(mocks.uiState.setAgentModeLastSelected).not.toHaveBeenCalled()
    expect(mocks.setSessionAgentModeMock).not.toHaveBeenCalled()
  })

  test('keeps the remembered mode untouched when toggling Smart Switching', () => {
    mocks.agentModeEntry.value = 'off'
    renderPanel()

    const smartSwitchingRow = screen.getByText('Smart Switching').closest('.mantine-Flex-root')
    const smartSwitchingToggle = smartSwitchingRow?.querySelector('input[type="checkbox"]')
    expect(smartSwitchingToggle).toBeTruthy()
    fireEvent.click(smartSwitchingToggle as HTMLInputElement)

    expect(mocks.uiState.setAgentModeSmartSwitchingDefault).toHaveBeenCalledWith(true)
    expect(mocks.setSessionAgentModeMock).toHaveBeenCalledWith('new', 'auto')
    expect(mocks.uiState.setAgentModeLastSelected).not.toHaveBeenCalled()
  })
})

describe('AgentModePanel submenu hover behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('cancels a delayed submenu switch when the pointer leaves the target row', () => {
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Skills' }))
    expect(screen.getAllByText('Skills')).toHaveLength(2)

    const mcpRow = screen.getByRole('button', { name: 'MCP' })
    fireEvent.mouseEnter(mcpRow)
    fireEvent.mouseLeave(mcpRow, { relatedTarget: mcpRow.parentElement })

    act(() => vi.advanceTimersByTime(180))

    expect(screen.getAllByText('MCP')).toHaveLength(1)
    expect(screen.getAllByText('Skills')).toHaveLength(2)
  })

  test('opens a submenu by click for touch input', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /^Memory/ }))

    expect(screen.getByText("Shared by chats that don't use Copilot Memory.")).toBeTruthy()
  })

  test('clears a pending switch when Escape closes the submenu', () => {
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Skills' }))
    const mcpRow = screen.getByRole('button', { name: 'MCP' })
    fireEvent.mouseEnter(mcpRow)
    fireEvent.keyDown(mcpRow, { key: 'Escape' })

    act(() => vi.advanceTimersByTime(180))

    expect(screen.getAllByText('Skills')).toHaveLength(1)
    expect(screen.getAllByText('MCP')).toHaveLength(1)
  })

  test('keeps the submenu open while the pointer crosses the gap into it', () => {
    renderPanel()

    const skillsRow = screen.getByRole('button', { name: 'Skills' })
    fireEvent.mouseEnter(skillsRow)
    expect(screen.getAllByText('Skills')).toHaveLength(2)

    const panel = screen.getByRole('button', { name: 'Skills' }).closest('.relative')
    expect(panel).not.toBeNull()
    fireEvent.mouseLeave(panel as Element)

    act(() => vi.advanceTimersByTime(200))
    expect(screen.getAllByText('Skills')).toHaveLength(2)

    const subPanel = (panel as Element).querySelector('.absolute')
    expect(subPanel).not.toBeNull()
    fireEvent.mouseEnter(subPanel as Element)

    act(() => vi.advanceTimersByTime(300))
    expect(screen.getAllByText('Skills')).toHaveLength(2)
  })

  test('closes the submenu after the pointer stays outside the whole panel', () => {
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Skills' }))
    const panel = screen.getByRole('button', { name: 'Skills' }).closest('.relative')
    expect(panel).not.toBeNull()
    fireEvent.mouseLeave(panel as Element)

    act(() => vi.advanceTimersByTime(300))

    expect(screen.getAllByText('Skills')).toHaveLength(1)
  })
})

describe('AgentModePanel capability availability', () => {
  test('keeps Web Search and Knowledge Base enabled in Chat Mode', () => {
    mocks.agentModeEntry.value = 'off'
    renderPanel()

    expect(screen.getByRole('button', { name: 'Web Search' }).getAttribute('aria-disabled')).toBe('false')
    expect(screen.getByRole('button', { name: /^Memory/ }).getAttribute('aria-disabled')).toBe('false')
    expect(screen.getByRole('button', { name: 'Knowledge Base' }).getAttribute('aria-disabled')).toBe('false')
    expect(screen.getByRole('button', { name: /^Code Execution/ }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: 'Skills' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: 'MCP' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: 'Working Directory' }).getAttribute('aria-disabled')).toBe('true')
  })

  test('tracks and updates Web Search from Chat Mode', () => {
    mocks.agentModeEntry.value = 'off'
    const onWebBrowsingChange = vi.fn()
    renderPanel({ onWebBrowsingChange })

    const webSearchRow = screen.getByRole('button', { name: 'Web Search' })
    const webSearchSwitch = webSearchRow.querySelector('input[type="checkbox"]')
    expect(webSearchSwitch).not.toBeNull()
    fireEvent.click(webSearchSwitch as HTMLInputElement)

    expect(onWebBrowsingChange).toHaveBeenCalledWith(true)
    expect(mocks.trackWebSearchClickMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'chat_mode', sessionId: 'new' }),
      true,
      'build-in'
    )
  })

  test('explains that built-in Web Search needs sign-in without changing the enabled switch', () => {
    renderPanel({ webBrowsingMode: true })

    expect(screen.getByText('Sign in required')).toBeTruthy()
    expect(
      screen.getByText('Chatbox AI Search needs sign-in. Web Search will be skipped while this setting is on.')
    ).toBeTruthy()
    expect(screen.getByTestId(TestId.chat.webSearchToggle)).toHaveProperty('checked', true)

    fireEvent.click(screen.getByRole('button', { name: /Sign in to Chatbox AI/ }))
    expect(mocks.navigateToSettingsMock).toHaveBeenCalledWith(undefined)
  })

  test('allows selecting a Knowledge Base from Chat Mode', () => {
    mocks.agentModeEntry.value = 'off'
    mocks.knowledgeBases.push({ id: 1, name: 'Product Docs' })
    const onKnowledgeBaseSelect = vi.fn()
    const onClose = vi.fn()
    renderPanel({ onKnowledgeBaseSelect, onClose })

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Knowledge Base' }))
    fireEvent.click(screen.getByText('Product Docs'))

    expect(onKnowledgeBaseSelect).toHaveBeenCalledWith({ id: 1, name: 'Product Docs' })
    expect(onClose).toHaveBeenCalled()
  })

  test('keeps all capability rows enabled in Work Mode', () => {
    renderPanel()

    for (const name of ['Web Search', /^Memory/, 'Skills', 'MCP', 'Knowledge Base', 'Working Directory']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('false')
    }
    expect(screen.getByRole('button', { name: /^Code Execution/ }).getAttribute('aria-disabled')).toBe('false')
  })
})

describe('AgentModePanel memory', () => {
  test('shows the effective global source and updates it from the Memory panel', () => {
    mocks.agentModeEntry.value = 'off'
    renderPanel()

    const memoryRow = screen.getByRole('button', { name: /^Memory/ })
    expect(memoryRow.textContent).toContain('Global Memory')
    fireEvent.mouseEnter(memoryRow)

    const globalSwitch = screen.getByRole('switch', { name: 'Global Memory' })
    expect(globalSwitch).toHaveProperty('checked', true)
    fireEvent.click(globalSwitch)

    expect(mocks.settingsState.setSettings).toHaveBeenCalledWith({ memoryEnabled: false })
    expect(mocks.trackMemoryClickMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'chat_mode', sessionId: 'new' }),
      false
    )
  })

  test('explains the global store and links to agent settings', async () => {
    mocks.listMemoriesMock.mockResolvedValue([
      { id: 'm1', content: 'Prefers concise answers', createdAt: 1 },
      { id: 'm2', content: 'Works in Beijing', createdAt: 2 },
    ])
    const onClose = vi.fn()
    const { navigateToSettings } = await import('@/modals/settings-navigation')
    renderPanel({ onClose })

    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Memory/ }))

    expect(screen.getByText("Shared by chats that don't use Copilot Memory.")).toBeTruthy()

    await vi.waitFor(() => {
      expect(screen.getByText('2 saved')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Manage memories' }))
    expect(onClose).toHaveBeenCalled()
    expect(navigateToSettings).toHaveBeenCalledWith('/agent')
  })

  test('shows an unambiguous off status while keeping the global switch available', () => {
    mocks.settingsState.memoryEnabled = false
    renderPanel({ sessionId: 's1' })

    const memoryRow = screen.getByRole('button', { name: /^Memory/ })
    expect(memoryRow.textContent).toContain('Off')
    fireEvent.mouseEnter(memoryRow)

    expect(screen.getByRole('switch', { name: 'Global Memory' })).toHaveProperty('checked', false)
    expect(screen.getByText("Shared by chats that don't use Copilot Memory.")).toBeTruthy()
  })

  test('offers both the Copilot and global switches when Copilot Memory is off', () => {
    mocks.myCopilots.push({ id: 'cp1', name: 'Tutor', prompt: 'persona' })
    renderPanel({ draftCopilotId: 'cp1' })

    const memoryRow = screen.getByRole('button', { name: /^Memory/ })
    expect(memoryRow.textContent).toContain('Global Memory')
    fireEvent.mouseEnter(memoryRow)

    const copilotSwitch = screen.getByRole('switch', { name: 'Copilot Memory' })
    const globalSwitch = screen.getByRole('switch', { name: 'Global Memory' })
    expect(copilotSwitch).toHaveProperty('checked', false)
    expect(globalSwitch).toHaveProperty('checked', true)

    fireEvent.click(copilotSwitch)

    expect(mocks.setCopilotMemoryMock).toHaveBeenCalledWith({ id: 'cp1', name: 'Tutor' }, true)
    expect(mocks.settingsState.setSettings).not.toHaveBeenCalled()

    fireEvent.click(globalSwitch)
    expect(mocks.settingsState.setSettings).toHaveBeenCalledWith({ memoryEnabled: false })
  })

  test('shows the Copilot source and manages its memories through Copilot settings', async () => {
    mocks.myCopilots.push({ id: 'cp1', name: 'Tutor', prompt: 'persona' })
    mocks.copilotMemoryOwners.push({ id: 'cp1', name: 'Tutor' })
    mocks.listCopilotMemoriesMock.mockResolvedValue([{ id: 'm1', content: 'Learner level is B1', createdAt: 1 }])
    const onClose = vi.fn()
    renderPanel({ draftCopilotId: 'cp1', onClose })

    const memoryRow = screen.getByRole('button', { name: /^Memory/ })
    expect(memoryRow.textContent).toContain('Copilot Memory')
    fireEvent.mouseEnter(memoryRow)

    expect(
      screen.getByText('All chats with this Copilot use its shared memory when on, or follow Global Memory when off.')
    ).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Copilot Memory' })).toHaveProperty('checked', true)
    expect(screen.queryByRole('switch', { name: 'Global Memory' })).toBeNull()
    await vi.waitFor(() => {
      expect(screen.getByText('1 saved')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Manage memories' }))
    expect(onClose).toHaveBeenCalled()
    expect(mocks.niceModalShowMock).toHaveBeenCalledWith(
      'copilot-settings',
      expect.objectContaining({ mode: 'edit', copilot: expect.objectContaining({ id: 'cp1' }) })
    )
  })

  test('keeps a copilot without its own memory on the global list for counts and management', async () => {
    mocks.myCopilots.push({ id: 'cp1', name: 'Tutor', prompt: 'persona' })
    mocks.listMemoriesMock.mockResolvedValue([{ id: 'gm1', content: 'Global fact', createdAt: 1 }])
    const { navigateToSettings } = await import('@/modals/settings-navigation')
    const onClose = vi.fn()
    renderPanel({ draftCopilotId: 'cp1', onClose })

    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Memory/ }))

    expect(
      screen.getByText('All chats with this Copilot use its shared memory when on, or follow Global Memory when off.')
    ).toBeTruthy()
    expect(screen.getByText("Shared by chats that don't use Copilot Memory.")).toBeTruthy()
    await vi.waitFor(() => {
      expect(screen.getByText('1 saved')).toBeTruthy()
    })
    expect(mocks.listCopilotMemoriesMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Manage memories' }))
    expect(onClose).toHaveBeenCalled()
    expect(navigateToSettings).toHaveBeenCalledWith('/agent')
    expect(mocks.niceModalShowMock).not.toHaveBeenCalled()
  })

  test('gives a copilot that was never saved its own memory, managed from Settings', async () => {
    mocks.copilotMemoryOwners.push({ id: 'chatbox-featured:24', name: 'Translator' })
    mocks.listCopilotMemoriesMock.mockResolvedValue([{ id: 'm1', content: 'Prefers a formal register', createdAt: 1 }])
    const { navigateToSettings } = await import('@/modals/settings-navigation')
    const onClose = vi.fn()
    renderPanel({ draftCopilotId: 'chatbox-featured:24', onClose })

    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Memory/ }))

    expect(screen.getByText('Translator')).toBeTruthy()
    await vi.waitFor(() => {
      expect(screen.getByText('1 saved')).toBeTruthy()
    })
    expect(mocks.listCopilotMemoriesMock).toHaveBeenCalledWith('chatbox-featured:24')

    fireEvent.click(screen.getByRole('button', { name: 'Manage memories' }))
    expect(onClose).toHaveBeenCalled()
    expect(navigateToSettings).toHaveBeenCalledWith('/agent')
    expect(mocks.niceModalShowMock).not.toHaveBeenCalled()
  })

  test('keys memory for an unsaved copilot by its copilot id', () => {
    renderPanel({ draftCopilotId: 'ghost', draftCopilotName: 'Ghost Writer' })

    const memoryRow = screen.getByRole('button', { name: /^Memory/ })
    fireEvent.mouseEnter(memoryRow)
    const memorySwitch = screen.getByRole('switch', { name: 'Copilot Memory' })
    expect(memorySwitch).toHaveProperty('checked', false)

    fireEvent.click(memorySwitch)

    expect(mocks.setCopilotMemoryMock).toHaveBeenCalledWith({ id: 'ghost', name: 'Ghost Writer' }, true)
  })

  test('shows Memory off and both recovery switches when Copilot and global memory are off', () => {
    mocks.settingsState.memoryEnabled = false
    mocks.myCopilots.push({ id: 'cp1', name: 'Tutor', prompt: 'persona' })
    renderPanel({ draftCopilotId: 'cp1' })

    const memoryRow = screen.getByRole('button', { name: /^Memory/ })
    expect(memoryRow.textContent).toContain('Off')
    fireEvent.mouseEnter(memoryRow)

    expect(screen.getByRole('switch', { name: 'Copilot Memory' })).toHaveProperty('checked', false)
    expect(screen.getByRole('switch', { name: 'Global Memory' })).toHaveProperty('checked', false)
  })
})

describe('AgentModePanel remembered defaults', () => {
  test('remembers an approval mode change for future new chats', () => {
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Code Execution/ }))
    fireEvent.click(screen.getByText('Always Ask'))

    expect(mocks.uiState.setNewSessionCommandApprovalModeDefault).toHaveBeenCalledWith('always_ask')
    expect(mocks.uiState.setNewSessionState).toHaveBeenCalledOnce()
    const updater = mocks.uiState.setNewSessionState.mock.calls[0][0]
    expect(updater({})).toEqual({ agentFullAccess: undefined, commandApprovalMode: 'always_ask' })
  })

  test('shows the remembered approval mode in a fresh chat', () => {
    mocks.uiState.newSessionCommandApprovalModeDefault = 'full_access'
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Code Execution/ }))
    // [0] is the row badge in the main panel; [1] is the sub-panel option.
    fireEvent.click(screen.getAllByText('Full Access')[1])

    // Selecting the already-active remembered mode is a no-op.
    expect(mocks.uiState.setNewSessionState).not.toHaveBeenCalled()
  })

  test('remembers working directory changes for future new chats', () => {
    const selectedDirectory = '/Users/themez/workspace/chatbox-pro'
    recentDirectoriesStore.setState({ directories: [selectedDirectory] })
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Working Directory' }))
    fireEvent.click(screen.getByRole('button', { name: selectedDirectory }))

    expect(mocks.uiState.setNewSessionWorkingDirectoriesDefault).toHaveBeenCalledWith([selectedDirectory])
  })

  test('shows remembered working directories in a fresh chat', () => {
    mocks.uiState.newSessionWorkingDirectoriesDefault = ['/Users/themez/workspace/chatbox-pro']
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Working Directory/ }))

    expect(screen.getByText('chatbox-pro')).toBeTruthy()
  })
})

describe('AgentModePanel working directories', () => {
  test('shows unselected recent directories in a new session', () => {
    mocks.uiState.newSessionState = { workingDirectories: ['/Users/themez/workspace/chatbox'] }
    recentDirectoriesStore.setState({
      directories: ['/Users/themez/workspace/chatbox', String.raw`C:\Users\themez\workspace\chatbox-pro`],
    })
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Working Directory/ }))

    expect(screen.getByText('Recent')).toBeTruthy()
    expect(screen.getByRole('button', { name: String.raw`C:\Users\themez\workspace\chatbox-pro` })).toBeTruthy()
    expect(screen.getByText('chatbox-pro')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '/Users/themez/workspace/chatbox' })).toBeNull()
  })

  test('adds a recent directory to the new session and moves it to the front', () => {
    const selectedDirectory = '/Users/themez/workspace/chatbox-pro'
    recentDirectoriesStore.setState({ directories: ['/Users/themez/Downloads', selectedDirectory] })
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Working Directory' }))
    fireEvent.click(screen.getByRole('button', { name: selectedDirectory }))

    expect(mocks.uiState.setNewSessionState).toHaveBeenCalledOnce()
    const updater = mocks.uiState.setNewSessionState.mock.calls[0][0]
    expect(updater({})).toEqual({ workingDirectories: [selectedDirectory] })
    expect(recentDirectoriesStore.getState().directories).toEqual([selectedDirectory, '/Users/themez/Downloads'])
  })

  test('remembers a directory selected from the system picker', async () => {
    const selectedDirectory = '/Users/themez/workspace/chatbox-pro'
    mocks.openDirectoryDialogMock.mockResolvedValue({ canceled: false, path: selectedDirectory })
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Working Directory' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }))

    await vi.waitFor(() => {
      expect(mocks.uiState.setNewSessionState).toHaveBeenCalledOnce()
    })
    expect(recentDirectoriesStore.getState().directories).toEqual([selectedDirectory])
  })

  test('refreshes recency without duplicating a directory already selected in the session', async () => {
    const selectedDirectory = '/Users/themez/workspace/chatbox-pro'
    mocks.uiState.newSessionState = { workingDirectories: [selectedDirectory] }
    recentDirectoriesStore.setState({ directories: ['/Users/themez/Downloads', selectedDirectory] })
    mocks.openDirectoryDialogMock.mockResolvedValue({ canceled: false, path: selectedDirectory })
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Working Directory/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }))

    await vi.waitFor(() => {
      expect(recentDirectoriesStore.getState().directories).toEqual([selectedDirectory, '/Users/themez/Downloads'])
    })
    expect(mocks.uiState.setNewSessionState).not.toHaveBeenCalled()
  })
})

describe('AgentModePanel touch layout', () => {
  test('opens a submenu in-page and returns without closing the menu', () => {
    const onClose = vi.fn()
    renderPanel({ layout: 'touch', onClose })

    fireEvent.click(screen.getByRole('button', { name: /^Memory/ }))

    expect(screen.getByText("Shared by chats that don't use Copilot Memory.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Memory/ })).toBeNull()
    expect(screen.getByTestId(TestId.agent.modePanelBack)).toBeTruthy()

    fireEvent.click(screen.getByTestId(TestId.agent.modePanelBack))

    expect(screen.getByRole('button', { name: /^Memory/ })).toBeTruthy()
    expect(screen.queryByText("Shared by chats that don't use Copilot Memory.")).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  test('toggles Web Search without opening the provider page', () => {
    const onWebBrowsingChange = vi.fn()
    renderPanel({ layout: 'touch', onWebBrowsingChange })

    const webSearchSwitch = screen.getByRole('switch')
    const switchTrack = webSearchSwitch.nextElementSibling
    expect(switchTrack).not.toBeNull()
    fireEvent.click(switchTrack as HTMLElement)

    expect(screen.queryByTestId(TestId.agent.modePanelBack)).toBeNull()
    expect(screen.queryByText('Bing Search')).toBeNull()
    expect(screen.getByRole('button', { name: 'Web Search' })).toBeTruthy()

    fireEvent.click(webSearchSwitch)
    expect(onWebBrowsingChange).toHaveBeenCalledWith(true)
  })

  test('opens the Web Search provider page from the row', () => {
    renderPanel({ layout: 'touch' })

    fireEvent.click(screen.getByRole('button', { name: 'Web Search' }))

    expect(screen.getByTestId(TestId.agent.modePanelBack)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Web Search' })).toBeNull()
  })
})

describe('AgentModePanel platform-unavailable capabilities', () => {
  test('hides desktop-only capability rows and explains they need the desktop app', () => {
    mocks.platform.type = 'mobile'
    mocks.platform.isDesktopLike = false
    mocks.featureFlags.knowledgeBase = false
    mocks.featureFlags.skills = false
    mocks.featureFlags.mcp = false
    mocks.featureFlags.agentMode = false
    renderPanel({ layout: 'touch' })

    expect(screen.queryByRole('button', { name: /^Code Execution/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'MCP' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Working Directory' })).toBeNull()
    expect(screen.queryByText('Extensions')).toBeNull()
    expect(screen.getByRole('button', { name: 'Web Search' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Memory/ })).toBeTruthy()
    expect(screen.getByText('Chat Mode')).toBeTruthy()
    expect(
      screen.getByText('This app currently supports Chat Mode only. Use Work Mode on the desktop app.')
    ).toBeTruthy()
    expect(
      screen.getByText('Skills, MCP, code execution, and Working Directory are available in the desktop app.')
    ).toBeTruthy()
  })
})
