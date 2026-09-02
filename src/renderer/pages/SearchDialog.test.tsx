// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { TestId } from '@shared/automation/testids'
import type { AgentModeEntry, Message, Session } from '@shared/types'
import { MessageRoleEnum } from '@shared/types'
import type React from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from '@/test-utils'

const searchDialogMocks = vi.hoisted(() => ({
  open: false,
  globalOnly: false,
  sessionAgentModeMap: {} as Record<string, AgentModeEntry>,
  searchSessions: vi.fn(),
  renderedMessage: vi.fn(),
}))

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('jotai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jotai')>()),
  useAtomValue: () => undefined,
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => ({
      sessionAgentModeMap: searchDialogMocks.sessionAgentModeMap,
      agentModeSmartSwitchingDefault: true,
      agentModeLastSelected: 'off',
    }),
  },
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      openSearchDialog: searchDialogMocks.open,
      searchDialogGlobalOnly: searchDialogMocks.globalOnly,
      setOpenSearchDialog: vi.fn(),
    }),
}))

vi.mock('@/stores/sessionHelpers', () => ({
  searchSessions: searchDialogMocks.searchSessions,
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { hideSystemPromptMessage: boolean }) => unknown) =>
    selector({ hideSystemPromptMessage: false }),
}))

vi.mock('../stores/scrollActions', () => ({
  scrollToMessage: vi.fn(),
}))

vi.mock('../stores/session/crud', () => ({
  switchCurrentSession: vi.fn(),
}))

vi.mock('@/components/chat/Message', () => ({
  default: (props: { sessionId: string; sessionMode?: 'chat' | 'work' }) => {
    searchDialogMocks.renderedMessage(props)
    return null
  },
}))

vi.mock('@/components/Markdown', () => ({
  BlockCodeCollapsedStateProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/components/common/Mark', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))

import SearchDialog, { filterHiddenSystemPromptHits } from './SearchDialog'

function message(id: string, role: Message['role']): Message {
  return {
    id,
    role,
    contentParts: [{ type: 'text', text: `${id} text` }],
    timestamp: 1,
  }
}

function session(id: string, messages: Message[]): Session {
  return { id, type: 'chat', name: id, messages }
}

beforeEach(() => {
  searchDialogMocks.open = false
  searchDialogMocks.globalOnly = false
  searchDialogMocks.sessionAgentModeMap = {}
  searchDialogMocks.searchSessions.mockReset()
  searchDialogMocks.renderedMessage.mockReset()
})

describe('SearchDialog', () => {
  test('does not hide the application from assistive technology while closed', () => {
    const appRoot = document.createElement('div')
    document.body.appendChild(appRoot)

    const { unmount } = render(<SearchDialog />, { container: appRoot })

    expect(appRoot.getAttribute('aria-hidden')).toBeNull()

    unmount()
    appRoot.remove()
  })

  test('passes legacy Work Mode to messages rendered in global search results', async () => {
    const workSession = session('work', [message('assistant', MessageRoleEnum.Assistant)])
    searchDialogMocks.open = true
    searchDialogMocks.globalOnly = true
    searchDialogMocks.sessionAgentModeMap[workSession.id] = { value: 'on', locked: false, lockReason: null }
    searchDialogMocks.searchSessions.mockImplementation(
      (_query: string, _sessionId: string | undefined, onBatch: (sessions: Session[]) => void) => {
        onBatch([workSession])
      }
    )

    render(<SearchDialog />)
    const input = screen.getByTestId(TestId.session.searchInput)
    fireEvent.input(input, { target: { value: 'assistant' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(searchDialogMocks.renderedMessage).toHaveBeenCalled())
    expect(searchDialogMocks.renderedMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      sessionId: 'work',
      sessionMode: 'work',
    })
  })
})

describe('filterHiddenSystemPromptHits', () => {
  const results = [
    session('only-system', [message('s1', MessageRoleEnum.System)]),
    session('mixed', [message('s2', MessageRoleEnum.System), message('u1', MessageRoleEnum.User)]),
  ]

  test('returns results untouched while the setting is off', () => {
    expect(filterHiddenSystemPromptHits(results, false)).toBe(results)
    expect(filterHiddenSystemPromptHits(results, undefined)).toBe(results)
  })

  test('drops system-prompt hits and sessions whose only hit was the system prompt', () => {
    const filtered = filterHiddenSystemPromptHits(results, true)
    expect(filtered.map((s) => s.id)).toEqual(['mixed'])
    expect(filtered[0].messages.map((m) => m.id)).toEqual(['u1'])
  })

  test('drops system-prompt hits from work mode sessions while the setting is off', () => {
    const workSession: Session = {
      ...session('work', [message('s3', MessageRoleEnum.System), message('u2', MessageRoleEnum.User)]),
      settings: { agentMode: { value: 'on', locked: false, lockReason: null } },
    }

    const filtered = filterHiddenSystemPromptHits([...results, workSession], false)
    expect(filtered.map((s) => s.id)).toEqual(['only-system', 'mixed', 'work'])
    expect(filtered[0].messages.map((m) => m.id)).toEqual(['s1'])
    expect(filtered[2].messages.map((m) => m.id)).toEqual(['u2'])
  })
})
