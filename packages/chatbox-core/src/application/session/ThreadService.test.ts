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
  let beforeNextMessageUpdate: ((current: Session) => Session) | undefined
  let id = 0
  const sessions: SessionUseCasePort = {
    getSession: () => Promise.resolve(session),
    updateSession(_sessionId, updater: Updater<SessionMetadataUpdate>) {
      const update = typeof updater === 'function' ? updater(session) : updater
      session = { ...session, ...update }
      return Promise.resolve(session)
    },
    updateSessionWithMessages(_sessionId, updater) {
      if (beforeNextMessageUpdate) {
        session = beforeNextMessageUpdate(session)
        beforeNextMessageUpdate = undefined
      }
      session = typeof updater === 'function' ? updater(session) : { ...session, ...updater }
      return Promise.resolve(session)
    },
  }
  const cancelMessages = vi.fn()
  const service = new ThreadService({
    sessions,
    createId: () => `thread-${++id}`,
    now: () => 100 + id,
    getDefaultSystemPrompt: () => 'Default system',
    cancelMessages,
    copySession: (source) => {
      copiedSource = source
      return Promise.resolve({ ...source, id: 'copied-session' })
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
    beforeMessageUpdate(update: (current: Session) => Session) {
      beforeNextMessageUpdate = update
    },
  }
}

describe('ThreadService', () => {
  test('edits the active thread name even before a history list exists', async () => {
    const harness = createHarness({ id: 'session-1', name: 'Session', messages: [] })

    await expect(harness.service.edit('session-1', 'session-1', { name: 'Renamed' })).resolves.toBe(true)

    expect(harness.session.threadName).toBe('Renamed')
  })

  test('applies archived thread edits and removals to the latest queued Session', async () => {
    const original = { id: 'history-1', name: 'History', messages: [], createdAt: 1 }
    const concurrent = { id: 'history-2', name: 'Concurrent', messages: [], createdAt: 2 }
    const harness = createHarness({
      id: 'session-1',
      name: 'Session',
      messages: [],
      threads: [original],
    })

    harness.beforeMessageUpdate((current) => ({
      ...current,
      threads: [...(current.threads ?? []), concurrent],
    }))
    await expect(harness.service.edit('session-1', original.id, { name: 'Edited' })).resolves.toBe(true)
    expect(harness.session.threads?.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: original.id, name: 'Edited' },
      { id: concurrent.id, name: concurrent.name },
    ])

    await expect(harness.service.remove('session-1', original.id)).resolves.toBe(true)
    expect(harness.session.threads).toEqual([concurrent])
  })

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

    expect(harness.cancelMessages).not.toHaveBeenCalled()
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
    const historyPivot = message('history-pivot', 'user')
    const historySummary = message('history-summary', 'assistant')
    const historyMessages = [historyPivot, historySummary]
    const historySnapshot = promptContextSnapshot('History Soul')
    const currentSnapshot = promptContextSnapshot('Current Soul')
    const historyCompactionPoint = {
      summaryMessageId: historySummary.id,
      boundaryMessageId: historyPivot.id,
      createdAt: 2,
    }
    const concurrentThread = {
      id: 'history-2',
      name: 'Concurrent',
      messages: [message('concurrent', 'user')],
      createdAt: 3,
    }
    const harness = createHarness({
      id: 'session-1',
      name: 'Session',
      messages: [message('current', 'user')],
      settings: {
        provider: 'openai',
        temperature: 0.25,
        sessionPromptContextSnapshot: currentSnapshot,
      },
      messageForksHash: {
        [historyPivot.id]: {
          position: 0,
          lists: [{ id: 'history-list', messages: [] }],
          createdAt: 1,
        },
      },
      threads: [
        {
          id: 'history-1',
          name: 'History',
          messages: historyMessages,
          createdAt: 1,
          compactionPoints: [historyCompactionPoint],
          sessionPromptContextSnapshot: historySnapshot,
        },
      ],
    })
    harness.beforeMessageUpdate((current) => ({
      ...current,
      threads: [...(current.threads ?? []), concurrentThread],
    }))

    await expect(harness.service.moveToConversation('session-1', 'history-1')).resolves.toBe('copied-session')

    expect(harness.copiedSource).toMatchObject({
      name: 'History',
      messages: historyMessages,
      threads: [],
      threadName: 'History',
      compactionPoints: [historyCompactionPoint],
      settings: {
        provider: 'openai',
        temperature: 0.25,
        sessionPromptContextSnapshot: historySnapshot,
      },
    })
    expect(harness.copiedSource?.messageForksHash?.[historyPivot.id]).toBeDefined()
    expect(harness.session.threads).toEqual([concurrentThread])
    expect(harness.session.settings?.sessionPromptContextSnapshot).toBe(currentSnapshot)
    expect(harness.cancelMessages).not.toHaveBeenCalled()
  })

  test('cancels the messages discarded when removing the current thread', async () => {
    const currentMessages = [message('current', 'user'), { ...message('reply', 'assistant'), generating: true }]
    const harness = createHarness({
      id: 'session-1',
      name: 'Session',
      messages: currentMessages,
      threads: [],
    })

    await expect(harness.service.removeCurrent('session-1')).resolves.toBe(true)

    expect(harness.cancelMessages).toHaveBeenCalledWith('session-1', [currentMessages[1]])
    expect(harness.session.threadName).toBe('')
  })

  test('cancels inactive fork replies when replacing the current conversation', async () => {
    const pivot = message('pivot', 'user')
    const inactiveReply = { ...message('inactive-reply', 'assistant'), generating: true }
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

    expect(harness.cancelMessages).toHaveBeenCalledWith('session-1', [inactiveReply])
  })
})
