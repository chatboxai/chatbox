/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@/test-utils'

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

const mocks = vi.hoisted(() => {
  const uiState = {
    newSessionState: {} as {
      workingDirectories?: string[]
      agentFullAccess?: boolean
      commandApprovalMode?: string
    },
    newSessionCommandApprovalModeDefault: undefined as string | undefined,
    newSessionWorkingDirectoriesDefault: undefined as string[] | undefined,
    setNewSessionState: vi.fn(),
    setNewSessionCommandApprovalModeDefault: vi.fn(),
    setNewSessionWorkingDirectoriesDefault: vi.fn(),
  }
  const sessionSettings: { workingDirectories?: string[]; commandApprovalMode?: string; agentFullAccess?: boolean } = {}
  const updateSessionMock = vi.fn()
  const openDirectoryDialogMock = vi.fn()
  const trackCodeExecutionClickMock = vi.fn()
  return { uiState, sessionSettings, updateSessionMock, openDirectoryDialogMock, trackCodeExecutionClickMock }
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/analytics/agent-mode', () => ({
  trackCodeExecutionClick: mocks.trackCodeExecutionClickMock,
}))

vi.mock('@/platform', () => ({
  default: { type: 'desktop', isDesktopLike: true, openDirectoryDialog: mocks.openDirectoryDialogMock },
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { updateSession: mocks.updateSessionMock },
  },
}))

vi.mock('@/stores/session/session-settings', () => ({
  useSessionSettings: () => ({ sessionSettings: mocks.sessionSettings }),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: typeof mocks.uiState) => unknown) => selector(mocks.uiState),
}))

import { recentDirectoriesStore } from '@/stores/recentDirectoriesStore'
import { useComposerMenuStore } from './composerMenuStore'
import WorkModeStatusRow from './WorkModeStatusRow'

function renderRow(props: Partial<ComponentProps<typeof WorkModeStatusRow>> = {}) {
  return render(
    <MantineProvider>
      <WorkModeStatusRow sessionId="session-1" {...props} />
    </MantineProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.uiState.newSessionState = {}
  mocks.uiState.newSessionCommandApprovalModeDefault = undefined
  mocks.uiState.newSessionWorkingDirectoriesDefault = undefined
  for (const key of Object.keys(mocks.sessionSettings)) {
    delete mocks.sessionSettings[key as keyof typeof mocks.sessionSettings]
  }
  recentDirectoriesStore.setState({ directories: [] })
  useComposerMenuStore.setState({ activeMenu: null })
})

describe('WorkModeStatusRow chips', () => {
  test('shows the approval mode and the first directory with a +N count', () => {
    mocks.sessionSettings.commandApprovalMode = 'smart'
    mocks.sessionSettings.workingDirectories = ['/code/chatbox-pro', '/code/design-tokens', '/code/release-notes']
    renderRow()

    expect(screen.getByTestId(TestId.agent.approvalStatusTrigger).textContent).toBe('Smart Approval')
    const dirChip = screen.getByTestId(TestId.agent.workingDirStatusTrigger)
    expect(dirChip.textContent).toBe('chatbox-pro+2')
  })

  test('paints the Full Access chip with the error tint', () => {
    mocks.sessionSettings.commandApprovalMode = 'full_access'
    renderRow()

    const trigger = screen.getByTestId(TestId.agent.approvalStatusTrigger)
    expect(trigger.textContent).toBe('Full Access')
    expect(trigger.style.color).toBe('var(--chatbox-tint-error)')
  })

  test('falls back to a generic label when no directory is bound', () => {
    renderRow()

    expect(screen.getByTestId(TestId.agent.workingDirStatusTrigger).textContent).toBe('Working Directory')
  })
})

describe('WorkModeStatusRow approval menu', () => {
  test('changes the mode in place for a persisted session and remembers it for new chats', async () => {
    mocks.sessionSettings.commandApprovalMode = 'smart'
    renderRow()

    fireEvent.click(screen.getByTestId(TestId.agent.approvalStatusTrigger))
    await screen.findByTestId(TestId.agent.approvalStatusMenu)
    expect(screen.getByText('New chats will keep this choice')).toBeTruthy()

    fireEvent.click(screen.getByText('Always Ask'))

    expect(mocks.trackCodeExecutionClickMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', mode: 'work_mode' }),
      'approval'
    )
    expect(mocks.updateSessionMock).toHaveBeenCalledWith('session-1', expect.any(Function))
    // The new-chat default is recorded only after the session write settles.
    await vi.waitFor(() => {
      expect(mocks.uiState.setNewSessionCommandApprovalModeDefault).toHaveBeenCalledWith('always_ask')
    })
    const updater = mocks.updateSessionMock.mock.calls[0][1]
    expect(updater({ settings: {} })).toEqual({
      settings: { agentFullAccess: undefined, commandApprovalMode: 'always_ask' },
    })
  })

  test('writes the transient new-chat state instead of a session for a fresh chat', async () => {
    renderRow({ sessionId: 'new' })

    fireEvent.click(screen.getByTestId(TestId.agent.approvalStatusTrigger))
    await screen.findByTestId(TestId.agent.approvalStatusMenu)
    fireEvent.click(screen.getByText('Full Access'))

    expect(mocks.updateSessionMock).not.toHaveBeenCalled()
    expect(mocks.uiState.setNewSessionCommandApprovalModeDefault).toHaveBeenCalledWith('full_access')
    const updater = mocks.uiState.setNewSessionState.mock.calls[0][0]
    expect(updater({})).toEqual({ agentFullAccess: true, commandApprovalMode: 'full_access' })
  })

  test('re-selecting the active mode still records it as the new-chat default', async () => {
    mocks.sessionSettings.commandApprovalMode = 'smart'
    mocks.uiState.newSessionCommandApprovalModeDefault = 'full_access'
    renderRow()

    fireEvent.click(screen.getByTestId(TestId.agent.approvalStatusTrigger))
    const menu = await screen.findByTestId(TestId.agent.approvalStatusMenu)
    fireEvent.click(within(menu).getByText('Smart Approval'))

    expect(mocks.uiState.setNewSessionCommandApprovalModeDefault).toHaveBeenCalledWith('smart')
    // No mode change: nothing to track, nothing to write back to the session.
    expect(mocks.trackCodeExecutionClickMock).not.toHaveBeenCalled()
    expect(mocks.updateSessionMock).not.toHaveBeenCalled()
  })

  test('does not record the default when the persisted-session write fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.sessionSettings.commandApprovalMode = 'smart'
    mocks.updateSessionMock.mockRejectedValueOnce(new Error('storage unavailable'))
    renderRow()

    fireEvent.click(screen.getByTestId(TestId.agent.approvalStatusTrigger))
    await screen.findByTestId(TestId.agent.approvalStatusMenu)
    fireEvent.click(screen.getByText('Full Access'))

    await act(async () => {})
    expect(mocks.updateSessionMock).toHaveBeenCalled()
    // This chat visibly kept its old policy — new chats must not inherit full access.
    expect(mocks.uiState.setNewSessionCommandApprovalModeDefault).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  test('a stale pending write cannot overwrite a newer explicit default', async () => {
    mocks.sessionSettings.commandApprovalMode = 'smart'
    let resolveWrite: (() => void) | undefined
    mocks.updateSessionMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        })
    )
    renderRow()

    // Older choice: switch to Full Access; its session write stays pending.
    fireEvent.click(screen.getByTestId(TestId.agent.approvalStatusTrigger))
    let menu = await screen.findByTestId(TestId.agent.approvalStatusMenu)
    fireEvent.click(within(menu).getByText('Full Access'))
    expect(mocks.uiState.setNewSessionCommandApprovalModeDefault).not.toHaveBeenCalled()

    // A newer explicit choice lands first (reaffirming the still-active mode).
    fireEvent.click(screen.getByTestId(TestId.agent.approvalStatusTrigger))
    menu = await screen.findByTestId(TestId.agent.approvalStatusMenu)
    fireEvent.click(within(menu).getByText('Smart Approval'))
    expect(mocks.uiState.setNewSessionCommandApprovalModeDefault).toHaveBeenCalledWith('smart')

    // The stale write completing must not resurrect full_access as the default.
    await act(async () => {
      resolveWrite?.()
    })
    expect(mocks.uiState.setNewSessionCommandApprovalModeDefault).toHaveBeenCalledTimes(1)
  })

  test('closes when another composer menu claims the shared slot', async () => {
    const { unmount } = renderRow()

    fireEvent.click(screen.getByTestId(TestId.agent.approvalStatusTrigger))
    await screen.findByTestId(TestId.agent.approvalStatusMenu)

    act(() => {
      useComposerMenuStore.getState().openMenu('work-mode-panel')
    })

    await waitFor(() => {
      expect(screen.queryByTestId(TestId.agent.approvalStatusMenu)).toBeNull()
    })

    // Unmount cleanup only releases this row's own menus, never another owner's slot.
    unmount()
    expect(useComposerMenuStore.getState().activeMenu).toBe('work-mode-panel')
  })

  test('releases the shared slot when the row unmounts with its menu open', async () => {
    const { unmount } = renderRow()

    fireEvent.click(screen.getByTestId(TestId.agent.approvalStatusTrigger))
    await screen.findByTestId(TestId.agent.approvalStatusMenu)
    expect(useComposerMenuStore.getState().activeMenu).toBe('approval-status')

    unmount()
    expect(useComposerMenuStore.getState().activeMenu).toBeNull()
  })
})

describe('WorkModeStatusRow directory menu', () => {
  test('removes a bound directory and re-binds a recent one in place', async () => {
    mocks.sessionSettings.workingDirectories = ['/code/chatbox-pro', '/code/design-tokens']
    recentDirectoriesStore.setState({ directories: ['/code/chatbox-web'] })
    renderRow()

    fireEvent.click(screen.getByTestId(TestId.agent.workingDirStatusTrigger))
    await screen.findByTestId(TestId.agent.workingDirStatusMenu)

    expect(screen.getByText('Recent')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(mocks.updateSessionMock).toHaveBeenCalledWith('session-1', expect.any(Function))
    let updater = mocks.updateSessionMock.mock.calls[0][1]
    expect(updater({ settings: {} })).toEqual({ settings: { workingDirectories: ['/code/design-tokens'] } })
    await vi.waitFor(() => {
      expect(mocks.uiState.setNewSessionWorkingDirectoriesDefault).toHaveBeenCalledWith(['/code/design-tokens'])
    })

    fireEvent.click(screen.getByRole('button', { name: '/code/chatbox-web' }))
    updater = mocks.updateSessionMock.mock.calls[1][1]
    expect(updater({ settings: {} })).toEqual({
      settings: { workingDirectories: ['/code/chatbox-pro', '/code/design-tokens', '/code/chatbox-web'] },
    })
  })

  test('does not record the default when the directory write fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.sessionSettings.workingDirectories = ['/code/chatbox-pro']
    mocks.updateSessionMock.mockRejectedValueOnce(new Error('storage unavailable'))
    renderRow()

    fireEvent.click(screen.getByTestId(TestId.agent.workingDirStatusTrigger))
    await screen.findByTestId(TestId.agent.workingDirStatusMenu)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await act(async () => {})
    expect(mocks.updateSessionMock).toHaveBeenCalled()
    expect(mocks.uiState.setNewSessionWorkingDirectoriesDefault).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  test('adds a folder through the system picker', async () => {
    mocks.openDirectoryDialogMock.mockResolvedValue({ canceled: false, path: '/code/chatbox-web' })
    renderRow()

    fireEvent.click(screen.getByTestId(TestId.agent.workingDirStatusTrigger))
    await screen.findByTestId(TestId.agent.workingDirStatusMenu)
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }))

    await vi.waitFor(() => {
      expect(mocks.updateSessionMock).toHaveBeenCalledWith('session-1', expect.any(Function))
    })
    expect(recentDirectoriesStore.getState().directories).toEqual(['/code/chatbox-web'])
  })
})

describe('WorkModeStatusRow inherited defaults', () => {
  test('shows remembered defaults with a hint on a fresh chat', () => {
    mocks.uiState.newSessionCommandApprovalModeDefault = 'full_access'
    mocks.uiState.newSessionWorkingDirectoriesDefault = ['/code/chatbox-pro', '/code/design-tokens']
    renderRow({ sessionId: 'new' })

    expect(screen.getByTestId(TestId.agent.approvalStatusTrigger).textContent).toBe('Full Access')
    expect(screen.getByTestId(TestId.agent.workingDirStatusTrigger).textContent).toBe('chatbox-pro+1')
    expect(screen.getByText('Same as last time')).toBeTruthy()
  })

  test('hides the hint once the fresh chat makes its own choice', () => {
    mocks.uiState.newSessionCommandApprovalModeDefault = 'full_access'
    mocks.uiState.newSessionState = { commandApprovalMode: 'smart' }
    renderRow({ sessionId: 'new' })

    expect(screen.getByTestId(TestId.agent.approvalStatusTrigger).textContent).toBe('Smart Approval')
    expect(screen.queryByText('Same as last time')).toBeNull()
  })

  test('keeps the hint off for persisted sessions', () => {
    mocks.uiState.newSessionCommandApprovalModeDefault = 'smart'
    renderRow()

    expect(screen.queryByText('Same as last time')).toBeNull()
  })
})
