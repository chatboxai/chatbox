import { describe, expect, test, vi } from 'vitest'
import type { Message, Session, SessionPromptContextSnapshot, Updater } from '../../types'
import { buildSessionExportThreads } from '../../utils/chat-export'
import type { SessionMetadataUpdate } from './session-metadata'
import type { SessionUseCasePort } from './session-use-case-port'
import { ThreadService } from './ThreadService'

function message(id: string, role: Message['role'], text = id): Message {
  return { id, role, contentParts: [{ type: 'text', text }] }
}

function promptContextSnapshot(soul: string): SessionPromptContextSnapshot {
  return {
    version: 1,
    soul,
    memories: [],
    workspaceInstructions: '',
    workspaceDirectories: [],
    capturedAt: 1,
    scope: 'agent',
  }
}

function createHarness(initial: Session) {
  let session = initial
  let copiedSource: Session | undefined
  let id = 0
  const sessions: SessionUseCasePort = {
    getSession: () => Promise.resolve(session),
    async updateSession(_sessionId, updater: Updater<SessionMetadataUpdate>) {
      const update = typeof updater === 'function' ? updater(session) : updater
      session = { ...session, ...update }
      return session
    },
    async updateSessionWithMessages(_sessionId, updater) {
      session = typeof updater === 'function' ? updater(session) : { ...session, ...updater }
      return session
    },
  }
  const cancelMessages = vi.fn()
  const service = new ThreadService({
    sessions,
    createId: () => `thread-${++id}`,
    now: () => 100 + id,
    getDefaultSystemPrompt: () => 'Default system',
    cancelMessages,
    copySession: async (source) => {
      copiedSource = source
      return { ...source, id: 'copied-session' }
    },
  })
  return {
    service,
    cancelMessages,
    get session() {
      return session
    },
    get copiedSource() {
      return copiedSource
    },
  }
}

describe('ThreadService', () => {
  test('switches thread data while returning UI effects to the host', async () => {
    const current = [message('system', 'system'), message('current', 'user')]
    const history = [message('history', 'user')]
    const currentSnapshot = promptContextSnapshot('Current Soul')
    const historySnapshot = promptContextSnapshot('History Soul')
    const harness = createHarness({
      id: 'session-1',
      name: 'Session',
      threadName: 'Current thread',
      messages: current,
      settings: { sessionPromptContextSnapshot: currentSnapshot },
      threads: [
        {
          id: 'history-1',
          name: 'History',
          messages: history,
          createdAt: 1,
          sessionPromptContextSnapshot: historySnapshot,
        },
      ],
    })

    await expect(harness.service.switch('session-1', 'history-1')).resolves.toBe(true)

    expect(harness.cancelMessages).toHaveBeenCalledWith('session-1', current)
    expect(harness.session.messages).toBe(history)
    expect(harness.session.threadName).toBe('History')
    expect(harness.session.settings?.sessionPromptContextSnapshot).toBe(historySnapshot)
    expect(harness.session.threads).toEqual([
      {
        id: 'thread-1',
        name: 'Current thread',
        messages: current,
        createdAt: 101,
        sessionPromptContextSnapshot: currentSnapshot,
      },
    ])
  })

  test('creates a new thread with a clean system prompt and keeps existing history', async () => {
    const snapshot = promptContextSnapshot('Current Soul')
    const harness = createHarness({
      id: 'session-1',
      name: 'Session',
      messages: [message('system', 'system', 'Custom system'), message('user', 'user')],
      settings: { sessionPromptContextSnapshot: snapshot },
      threads: [{ id: 'old', name: 'Old', messages: [], createdAt: 1 }],
    })

    await harness.service.refreshContextAndCreateNew('session-1')

    expect(harness.session.threads).toHaveLength(2)
    expect(harness.session.messages).toHaveLength(1)
    expect(harness.session.messages[0]).toMatchObject({
      role: 'system',
      contentParts: [{ type: 'text', text: 'Custom system' }],
    })
    expect(harness.session.threadName).toBe('')
    expect(harness.session.settings?.sessionPromptContextSnapshot).toBeUndefined()
    expect(harness.session.threads?.at(-1)?.sessionPromptContextSnapshot).toBe(snapshot)
  })

  test('compresses into a continuation prompt and preserves archived fork branches', async () => {
    const snapshot = promptContextSnapshot('Current Soul')
    const pivot = message('user', 'user')
    const activeReply = message('active-reply', 'assistant')
    const savedReply = message('saved-reply', 'assistant')
    const harness = createHarness({
      id: 'session-1',
      name: 'Session',
      messages: [message('system', 'system', 'System'), pivot, activeReply],
      settings: { sessionPromptContextSnapshot: snapshot },
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
    })

    await harness.service.compressAndCreate('session-1', 'Summary')

    expect(harness.session.messages.map(({ role }) => role)).toEqual(['system', 'user'])
    expect(harness.session.messages[1].contentParts).toEqual([
      { type: 'text', text: 'Previous conversation summary:\n\nSummary' },
    ])
    expect(harness.session.messageForksHash?.[pivot.id]).toBeDefined()
    expect(harness.session.threads).toHaveLength(1)
    expect(harness.session.settings?.sessionPromptContextSnapshot).toBeUndefined()
    expect(harness.session.threads?.[0].sessionPromptContextSnapshot).toBe(snapshot)
    expect(
      buildSessionExportThreads(harness.session, true, true).map(
        (thread) => thread.messages.at(-1)?.contentParts.find((part) => part.type === 'text')?.text
      )
    ).toEqual(['saved-reply', 'active-reply', 'Previous conversation summary:\n\nSummary'])
  })

  test('moves a history thread into a copied conversation before removing it', async () => {
    const historyMessages = [message('history', 'user')]
    const historySnapshot = promptContextSnapshot('History Soul')
    const harness = createHarness({
      id: 'session-1',
      name: 'Session',
      messages: [message('current', 'user')],
      settings: { sessionPromptContextSnapshot: promptContextSnapshot('Current Soul') },
      threads: [
        {
          id: 'history-1',
          name: 'History',
          messages: historyMessages,
          createdAt: 1,
          sessionPromptContextSnapshot: historySnapshot,
        },
      ],
    })

    await expect(harness.service.moveToConversation('session-1', 'history-1')).resolves.toBe('copied-session')

    expect(harness.copiedSource).toMatchObject({
      name: 'History',
      messages: historyMessages,
      threads: [],
      threadName: 'History',
      settings: { sessionPromptContextSnapshot: historySnapshot },
    })
    expect(harness.session.threads).toEqual([])
    expect(harness.cancelMessages).toHaveBeenCalledWith('session-1', historyMessages)
  })

  test('cancels the messages discarded when removing the current thread', async () => {
    const currentMessages = [message('current', 'user'), message('reply', 'assistant')]
    const harness = createHarness({
      id: 'session-1',
      name: 'Session',
      messages: currentMessages,
      threads: [],
    })

    await expect(harness.service.removeCurrent('session-1')).resolves.toBe(true)

    expect(harness.cancelMessages).toHaveBeenCalledWith('session-1', currentMessages)
    expect(harness.session.threadName).toBe('')
  })

  test('cancels inactive fork replies when replacing the current conversation', async () => {
    const pivot = message('pivot', 'user')
    const inactiveReply = message('inactive-reply', 'assistant')
    const harness = createHarness({
      id: 'session-1',
      name: 'Session',
      messages: [pivot],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'inactive', messages: [inactiveReply] },
          ],
          createdAt: 1,
        },
      },
    })

    await harness.service.refreshContextAndCreateNew('session-1')

    expect(harness.cancelMessages).toHaveBeenCalledWith('session-1', [pivot, inactiveReply])
  })
})
