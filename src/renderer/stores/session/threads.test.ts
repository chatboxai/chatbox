import { buildSessionExportThreads } from '@chatbox/core/utils/chat-export'
import type { AgentModeEntry, CompactionPoint, Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, updateSessionWithMessagesMock, uiStoreState } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  updateSessionWithMessagesMock: vi.fn(),
  uiStoreState: {
    sessionAgentModeMap: {} as Record<string, AgentModeEntry>,
    agentModeSmartSwitchingDefault: false,
    agentModeLastSelected: 'off',
  },
}))

// The create-thread backstop resolves the session's agent mode, whose module
// pulls uiStore → platform → the real i18n init; stub the store like
// agent-mode.test.ts does to keep this suite off that graph.
vi.mock('../uiStore', () => ({
  uiStore: { getState: () => uiStoreState, setState: vi.fn() },
  useUIStore: vi.fn(),
}))

vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  return {
    rendererApplication: {
      generationRuntime: new GenerationRuntimeStore(),
      sessions: {
        updateSession: vi.fn(),
        updateSessionWithMessages: updateSessionWithMessagesMock,
      },
      sessionQueryBridge: { getSession: getSessionMock },
    },
  }
})
vi.mock('../scrollActions', () => ({ scrollToBottom: vi.fn() }))
vi.mock('@/hooks/dom', () => ({ focusMessageInput: vi.fn() }))
vi.mock('./crud', () => ({ _copySession: vi.fn(), switchCurrentSession: vi.fn() }))
vi.mock('uuid', () => ({ v4: () => 'new-thread-id' }))

import { rendererApplication } from '@/app/renderer-application'
import { compressAndCreateThread, refreshContextAndCreateNewThread, removeCurrentThread, switchThread } from './threads'

const generationRuntimeStore = rendererApplication.generationRuntime

function message(id: string, overrides: Partial<Message> = {}): Message {
  return { id, role: 'assistant', contentParts: [], ...overrides }
}

function point(summaryMessageId: string, boundaryMessageId: string): CompactionPoint {
  return { summaryMessageId, boundaryMessageId, createdAt: 1000 }
}

const activePoint = point('summary-active', 'a1')
const threadPoint = point('summary-thread', 'a0')

function testSession(): Session {
  return {
    id: 'session-1',
    name: 'Test',
    messages: [message('u1', { role: 'user' }), message('a1'), message('summary-active', { isSummary: true })],
    compactionPoints: [activePoint],
    threads: [
      {
        id: 'thread-1',
        name: 'archived',
        createdAt: 500,
        messages: [message('u0', { role: 'user' }), message('a0'), message('summary-thread', { isSummary: true })],
        compactionPoints: [threadPoint],
      },
    ],
  }
}

function updatedSession(): Session {
  expect(updateSessionWithMessagesMock).toHaveBeenCalledTimes(1)
  const arg = updateSessionWithMessagesMock.mock.calls[0][1] as Session | ((s: Session) => Session)
  // Thread transfers must use functional updaters so they read the update
  // queue's current session, not a possibly stale getSession() snapshot.
  expect(typeof arg).toBe('function')
  return (arg as (s: Session) => Session)(testSession())
}

// Compaction points must travel with their message list across every
// archive/restore flow, or the send path (which reads only
// session.compactionPoints) loses the compaction after a thread restore.
describe('thread flows carry compaction points with their messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uiStoreState.sessionAgentModeMap = {}
    generationRuntimeStore.abort('session-1')
    getSessionMock.mockResolvedValue(testSession())
    updateSessionWithMessagesMock.mockResolvedValue(undefined)
  })

  it('switchThread swaps session and thread compaction points', async () => {
    await switchThread('session-1', 'thread-1')

    const updated = updatedSession()
    expect(updated.compactionPoints).toEqual([threadPoint])
    const archived = updated.threads?.find((t) => t.id === 'new-thread-id')
    expect(archived?.compactionPoints).toEqual([activePoint])
  })

  it('refreshContextAndCreateNewThread archives the points and clears the session ones', async () => {
    await refreshContextAndCreateNewThread('session-1')

    const updated = updatedSession()
    expect(updated.compactionPoints).toBeUndefined()
    const archived = updated.threads?.find((t) => t.id === 'new-thread-id')
    expect(archived?.compactionPoints).toEqual([activePoint])
  })

  it('removeCurrentThread restores the last thread with its compaction points', async () => {
    await removeCurrentThread('session-1')

    const updated = updatedSession()
    expect(updated.messages.map((m) => m.id)).toEqual(['u0', 'a0', 'summary-thread'])
    expect(updated.compactionPoints).toEqual([threadPoint])
  })

  it('removeCurrentThread aborts the discarded message runtime', async () => {
    const runtime = generationRuntimeStore.start('session-1', 'a1')

    await removeCurrentThread('session-1')
    updatedSession()

    expect(runtime.abortController.signal.aborted).toBe(true)
    expect(runtime.abortController.signal.reason).toBe('thread-changed')
  })

  it('removeCurrentThread clears compaction points when no thread remains', async () => {
    getSessionMock.mockResolvedValue({ ...testSession(), threads: [] })

    await removeCurrentThread('session-1')

    expect(updateSessionWithMessagesMock).toHaveBeenCalledTimes(1)
    const updater = updateSessionWithMessagesMock.mock.calls[0][1] as (s: Session) => Session
    expect(updater({ ...testSession(), threads: [] }).compactionPoints).toBeUndefined()
  })

  it('does not create a thread in work mode', async () => {
    getSessionMock.mockResolvedValue({
      ...testSession(),
      settings: { agentMode: { value: 'on', locked: true, lockReason: null } },
    })

    await refreshContextAndCreateNewThread('session-1')

    expect(updateSessionWithMessagesMock).not.toHaveBeenCalled()
  })

  it('does not create a thread when work mode lives in the legacy uiStore map', async () => {
    // Upgraded sessions may carry no settings.agentMode; the mode then comes
    // from uiStore.sessionAgentModeMap, and the backstop must honor it too.
    uiStoreState.sessionAgentModeMap['session-1'] = { value: 'on', locked: true, lockReason: null }

    await refreshContextAndCreateNewThread('session-1')

    expect(updateSessionWithMessagesMock).not.toHaveBeenCalled()
  })

  it('archives a compaction that committed after the snapshot was taken', async () => {
    // getSession returned a stale snapshot (no compaction yet); by the time
    // the queued updater runs, the compaction commit has landed. The transfer
    // must archive the queue's newer state, not the snapshot.
    getSessionMock.mockResolvedValue({ ...testSession(), messages: [message('u1', { role: 'user' })] })

    await refreshContextAndCreateNewThread('session-1')

    const updater = updateSessionWithMessagesMock.mock.calls[0][1] as (s: Session) => Session
    const updated = updater(testSession())
    const archived = updated.threads?.find((t) => t.id === 'new-thread-id')
    expect(archived?.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'summary-active'])
    expect(archived?.compactionPoints).toEqual([activePoint])
    expect(updated.compactionPoints).toBeUndefined()
  })

  it('preserves archived fork branches when compressing the current thread', async () => {
    const pivot = message('pivot', { role: 'user', contentParts: [{ type: 'text', text: 'user' }] })
    const activeReply = message('active-reply', { contentParts: [{ type: 'text', text: 'active-reply' }] })
    const savedReply = message('saved-reply', { contentParts: [{ type: 'text', text: 'saved-reply' }] })
    const session: Session = {
      id: 'session-1',
      name: 'Test',
      messages: [pivot, activeReply],
      messageForksHash: {
        [pivot.id]: {
          position: 1,
          lists: [
            { id: 'saved', messages: [savedReply] },
            { id: 'active', messages: [] },
          ],
          createdAt: 1,
        },
      },
    }
    getSessionMock.mockResolvedValue(session)

    await compressAndCreateThread('session-1', 'Summary')

    const updater = updateSessionWithMessagesMock.mock.calls[0][1] as (current: Session) => Session
    const updated = updater(session)
    expect(updated.messageForksHash?.[pivot.id]).toBeDefined()
    expect(
      buildSessionExportThreads(updated, true, true).map(
        (thread) => thread.messages.at(-1)?.contentParts.find((part) => part.type === 'text')?.text
      )
    ).toEqual(['saved-reply', 'active-reply', 'Previous conversation summary:\n\nSummary'])
  })
})
