import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Message, Session, SessionMetaRecord, SessionThread } from '../../shared/types'
import { rendererApplication } from '@/app/renderer-application'
import * as sessionActions from './session'
import { sessionActivityStore } from './sessionActivityStore'

const generationRuntimeStore = rendererApplication.generationRuntime

const { uuidQueue, uuidv4Mock } = vi.hoisted(() => {
  const queue: string[] = []
  const mock = vi.fn(() => {
    if (queue.length === 0) {
      throw new Error('Mock uuid queue exhausted')
    }
    return queue.shift()!
  })
  return { uuidQueue: queue, uuidv4Mock: mock }
})

const {
  updateSessionWithMessages,
  updateSessionMock,
  updateMessageMock,
  insertMessageMock,
  createSessionMock,
  useSessionMock,
  getSessionMock,
  listAllSessionsMetaMock,
  archiveSessionsMock,
  deleteSessionsMock,
  routerNavigateMock,
  sessionAgentModeMapMock,
  setSessionAgentModeMock,
  lockSessionAgentModeMock,
  toastMock,
} = vi.hoisted(() => ({
  updateSessionWithMessages: vi.fn(),
  updateSessionMock: vi.fn(),
  updateMessageMock: vi.fn(),
  insertMessageMock: vi.fn(),
  createSessionMock: vi.fn(),
  useSessionMock: vi.fn(),
  getSessionMock: vi.fn(),
  listAllSessionsMetaMock: vi.fn(),
  archiveSessionsMock: vi.fn(),
  deleteSessionsMock: vi.fn(),
  routerNavigateMock: vi.fn(),
  sessionAgentModeMapMock: {} as Record<
    string,
    { value: 'auto' | 'on' | 'off'; locked: boolean; lockReason: string | null }
  >,
  setSessionAgentModeMock: vi.fn(),
  lockSessionAgentModeMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.hoisted(() => {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  }
  const windowMock: Record<string, unknown> = {
    electronAPI: undefined,
    localStorage: storage,
  }
  ;(globalThis as unknown as { window: Record<string, unknown>; localStorage: typeof storage }).window = windowMock
  ;(globalThis as unknown as { window: Record<string, unknown>; localStorage: typeof storage }).localStorage = storage
  const fakeRequire = Object.assign(
    () => {
      throw new Error('require is not implemented in tests')
    },
    {
      context: () => {
        const loader = () => ''
        loader.keys = () => [] as string[]
        return loader
      },
    }
  )
  ;(globalThis as unknown as { require: typeof fakeRequire }).require = fakeRequire
  return {}
})

vi.mock('uuid', () => ({
  v4: uuidv4Mock,
}))

vi.mock('i18next', () => ({ t: (key: string) => key }))

vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  const { QueryClient } = await import('@tanstack/react-query')
  return {
    rendererApplication: {
      generationRuntime: new GenerationRuntimeStore(),
      queryClient: new QueryClient(),
      sessions: {
        updateSessionWithMessages,
        updateSession: updateSessionMock,
        updateMessage: updateMessageMock,
        insertMessage: insertMessageMock,
        createSession: createSessionMock,
        listAllSessionsMeta: listAllSessionsMetaMock,
        archiveSessions: archiveSessionsMock,
        deleteSessions: deleteSessionsMock,
      },
      sessionQueryBridge: {
        getSession: getSessionMock,
        listSessionsMeta: vi.fn().mockResolvedValue([]),
        updateSessionListData: vi.fn(),
      },
      sessionHooks: { useSession: useSessionMock },
    },
  }
})

vi.mock('./toastActions', () => ({ add: toastMock }))

vi.mock('../platform', () => ({
  default: {
    type: 'web',
    getConfig: async () => ({}),
  },
}))

vi.mock('@/adapters', () => ({
  createModelDependencies: async () => ({}),
}))

vi.mock('@/packages/model-calls', () => ({
  generateText: vi.fn(),
}))

vi.mock('@/packages/model-setting-utils', () => ({
  getModelDisplayName: async () => 'mock-model',
}))

vi.mock('@/packages/token', () => ({
  estimateTokensFromMessages: () => 0,
}))

vi.mock('@/router', () => ({
  router: {
    navigate: routerNavigateMock,
  },
  navigateToDynamicPath: routerNavigateMock,
}))

vi.mock('@/utils/session-utils', () => ({
  sortSessions: (sessions: unknown) => sessions,
}))

vi.mock('@/utils/track', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/hooks/dom', () => ({
  focusMessageInput: vi.fn(),
}))

vi.mock('@/i18n/locales', () => ({
  languageNameMap: {},
}))

vi.mock('@/packages/apple_app_store', () => ({}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({}),
    }),
  },
  useLanguage: () => 'en',
}))

vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => ({
      widthFull: false,
      messageScrolling: null,
      sessionAgentModeMap: sessionAgentModeMapMock,
      setSessionAgentMode: setSessionAgentModeMock,
      lockSessionAgentMode: lockSessionAgentModeMock,
      setMessageListElement: vi.fn(),
    }),
  },
  useUIStore: vi.fn(),
}))

vi.mock('@/components/settings/mcp/registries', () => ({
  MCP_ENTRIES_OFFICIAL: [],
}))

vi.mock('../components/settings/mcp/registries', () => ({
  MCP_ENTRIES_OFFICIAL: [],
}))

function makeMessage(id: string, role: Message['role'] = 'user'): Message {
  return {
    id,
    role,
    contentParts: [],
  }
}

function cloneSession(session: Session): Session {
  return JSON.parse(JSON.stringify(session)) as Session
}

function makeSessionMeta(id: string, sortOrder: number): SessionMetaRecord {
  return {
    id,
    name: id,
    sortOrder,
    createdAt: sortOrder,
  }
}

beforeEach(() => {
  uuidQueue.length = 0
  uuidv4Mock.mockClear()
  updateSessionWithMessages.mockReset()
  updateSessionMock.mockReset()
  createSessionMock.mockReset()
  useSessionMock.mockReset()
  getSessionMock.mockReset()
  listAllSessionsMetaMock.mockReset()
  archiveSessionsMock.mockReset()
  deleteSessionsMock.mockReset()
  routerNavigateMock.mockReset()
  for (const key of Object.keys(sessionAgentModeMapMock)) {
    delete sessionAgentModeMapMock[key]
  }
  setSessionAgentModeMock.mockReset()
  lockSessionAgentModeMock.mockReset()
  toastMock.mockReset()
  generationRuntimeStore.clear('session-clear')
  sessionActivityStore.setState({ unreadCompletedSessionIds: {} }, true)
})

describe('conversation list cleanup', () => {
  test('archives sessions outside the kept range instead of deleting them', async () => {
    listAllSessionsMetaMock.mockResolvedValue([
      makeSessionMeta('keep-1', 300),
      makeSessionMeta('keep-2', 200),
      makeSessionMeta('archive-1', 100),
      makeSessionMeta('archive-2', 0),
    ])

    await sessionActions.clearConversationList(2)

    expect(archiveSessionsMock).toHaveBeenCalledTimes(1)
    expect(archiveSessionsMock).toHaveBeenCalledWith(['archive-1', 'archive-2'])
    expect(deleteSessionsMock).not.toHaveBeenCalled()
  })
})

describe('session message cleanup', () => {
  test('aborts fork generation and clears persisted fork and unread state', async () => {
    const pivot = makeMessage('pivot')
    const forkReply = { ...makeMessage('fork-reply', 'assistant'), generating: true }
    const session: Session = {
      id: 'session-clear',
      name: 'Session',
      messages: [pivot],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'inactive', messages: [forkReply] },
          ],
          createdAt: 1,
        },
      },
    }
    getSessionMock.mockResolvedValue(session)
    updateSessionWithMessages.mockResolvedValue({ ...session, messages: [], messageForksHash: undefined })
    generationRuntimeStore.start(session.id, forkReply.id)
    sessionActivityStore.setState({ unreadCompletedSessionIds: { [session.id]: true } })

    await sessionActions.clear(session.id)

    expect(generationRuntimeStore.get(session.id, forkReply.id)).toBeUndefined()
    expect(updateSessionWithMessages).toHaveBeenCalledWith(session.id, {
      messages: [],
      threads: undefined,
      messageForksHash: undefined,
      threadName: '',
    })
    expect(sessionActivityStore.getState().unreadCompletedSessionIds[session.id]).toBeUndefined()
  })
})

describe('fork actions', () => {
  test('createNewFork moves trailing messages into a new branch', async () => {
    uuidQueue.push('id-1', 'id-2', 'id-3')
    const pivot = makeMessage('pivot', 'user')
    const trailing = makeMessage('trailing', 'assistant')
    const session: Session = {
      id: 'session-1',
      name: 'Test',
      messages: [pivot, trailing],
    }
    const snapshot = cloneSession(session)

    let updated: Session | undefined
    updateSessionWithMessages.mockImplementation(async (sessionId, updater) => {
      expect(sessionId).toBe(session.id)
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.createNewFork(session.id, pivot.id)

    expect(updateSessionWithMessages).toHaveBeenCalledTimes(1)
    expect(session).toEqual(snapshot)
    expect(updated).toBeDefined()
    expect(updated!.messages).toEqual([pivot])

    const fork = updated!.messageForksHash?.[pivot.id]
    expect(fork).toBeDefined()
    expect(fork!.position).toBe(1)
    expect(fork!.lists).toHaveLength(2)
    expect(fork!.lists[0].messages).toEqual([trailing])
    expect(fork!.lists[1].messages).toEqual([])
  })

  test('createNewFork skips update when no trailing messages', async () => {
    uuidQueue.push('id-1')
    const pivot = makeMessage('pivot', 'user')
    const session: Session = {
      id: 'session-2',
      name: 'Test',
      messages: [pivot],
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (sessionId, updater) => {
      expect(sessionId).toBe(session.id)
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.createNewFork(session.id, pivot.id)

    expect(updateSessionWithMessages).toHaveBeenCalledTimes(1)
    expect(session).toEqual(snapshot)
    expect(updated).toBe(session)
    expect(updated?.messageForksHash).toBeUndefined()
  })

  test('switchFork rotates branch contents for root messages', async () => {
    const pivot = makeMessage('pivot', 'user')
    const current = makeMessage('current', 'assistant')
    const alt = makeMessage('alt', 'assistant')
    const session: Session = {
      id: 'session-3',
      name: 'Test',
      messages: [pivot, current],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'list-0', messages: [] },
            { id: 'list-1', messages: [alt] },
          ],
          createdAt: 1,
        },
      },
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.switchFork(session.id, pivot.id, 'next')

    expect(session).toEqual(snapshot)
    expect(updated).toBeDefined()
    expect(updated!.messages).toEqual([pivot, alt])

    const fork = updated!.messageForksHash?.[pivot.id]
    expect(fork).toBeDefined()
    expect(fork!.position).toBe(1)
    expect(fork!.lists[0].messages).toEqual([current])
    expect(fork!.lists[1].messages).toEqual([])
    expect(snapshot.messageForksHash?.[pivot.id].lists[0].messages).toEqual([])
  })

  test('switchFork updates forked thread messages', async () => {
    const pivot = makeMessage('pivot', 'user')
    const current = makeMessage('current', 'assistant')
    const alternative = makeMessage('alt', 'assistant')
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Thread',
      createdAt: 1,
      messages: [pivot, current],
    }
    const session: Session = {
      id: 'session-4',
      name: 'Test',
      messages: [],
      threads: [thread],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'list-0', messages: [] },
            { id: 'list-1', messages: [alternative] },
          ],
          createdAt: 1,
        },
      },
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.switchFork(session.id, pivot.id, 'next')

    expect(session).toEqual(snapshot)
    expect(updated?.threads?.[0].messages).toEqual([pivot, alternative])
    const fork = updated?.messageForksHash?.[pivot.id]
    expect(fork?.position).toBe(1)
    expect(fork?.lists[0].messages).toEqual([current])
  })

  test('deleteFork promotes the next saved branch', async () => {
    const pivot = makeMessage('pivot', 'user')
    const current = makeMessage('current', 'assistant')
    const nextBranch = makeMessage('next', 'assistant')
    const session: Session = {
      id: 'session-5',
      name: 'Test',
      messages: [pivot, current],
      messageForksHash: {
        [pivot.id]: {
          position: 1,
          lists: [
            { id: 'list-0', messages: [nextBranch] },
            { id: 'list-1', messages: [] },
          ],
          createdAt: 1,
        },
      },
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.deleteFork(session.id, pivot.id)

    expect(session).toEqual(snapshot)
    expect(updated!.messages).toEqual([pivot, nextBranch])
    const fork = updated!.messageForksHash?.[pivot.id]
    expect(fork).toBeDefined()
    expect(fork!.position).toBe(0)
    expect(fork!.lists).toHaveLength(1)
    expect(fork!.lists[0].messages).toEqual([])
  })

  test('deleteFork removes entry when no branches remain', async () => {
    const pivot = makeMessage('pivot', 'user')
    const session: Session = {
      id: 'session-6',
      name: 'Test',
      messages: [pivot],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [{ id: 'list-0', messages: [] }],
          createdAt: 1,
        },
      },
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.deleteFork(session.id, pivot.id)

    expect(session).toEqual(snapshot)
    expect(updated!.messages).toEqual([pivot])
    expect(updated!.messageForksHash).toBeUndefined()
  })

  test('expandFork appends all stored branches and clears fork data', async () => {
    const pivot = makeMessage('pivot', 'user')
    const current = makeMessage('current', 'assistant')
    const altA = makeMessage('alt-a', 'assistant')
    const altB = makeMessage('alt-b', 'assistant')
    const session: Session = {
      id: 'session-7',
      name: 'Test',
      messages: [pivot, current],
      messageForksHash: {
        [pivot.id]: {
          position: 1,
          lists: [
            { id: 'list-0', messages: [altA] },
            { id: 'list-1', messages: [] },
            { id: 'list-2', messages: [altB] },
          ],
          createdAt: 1,
        },
      },
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.expandFork(session.id, pivot.id)

    expect(session).toEqual(snapshot)
    expect(updated!.messages).toEqual([pivot, current, altA, altB])
    expect(updated!.messageForksHash).toBeUndefined()
  })

  test('regenerateInNewFork creates a new fork for thread messages', async () => {
    uuidQueue.push('fork-1', 'fork-2', 'fork-3', 'fork-4')
    const pivot = makeMessage('pivot', 'user')
    const target = makeMessage('target', 'assistant')
    const thread: SessionThread = {
      id: 'thread-2',
      name: 'Thread',
      createdAt: 1,
      messages: [pivot, target],
    }
    const session: Session = {
      id: 'session-8',
      name: 'Test',
      messages: [],
      threads: [thread],
    }
    const snapshot = cloneSession(session)

    getSessionMock.mockResolvedValue(session)

    let updated: Session | undefined
    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    const runGenerateMore = vi.fn().mockResolvedValue(undefined)

    await sessionActions.regenerateInNewFork(session.id, target, { runGenerateMore })

    expect(getSessionMock).toHaveBeenCalledWith(session.id)
    expect(updateSessionWithMessages).toHaveBeenCalledTimes(1)
    expect(session).toEqual(snapshot)

    expect(updated).toBeDefined()
    const fork = updated!.messageForksHash?.[pivot.id]
    expect(fork).toBeDefined()
    expect(fork!.lists).toHaveLength(2)
    expect(fork!.lists[0].messages).toEqual([target])
    expect(runGenerateMore).toHaveBeenCalledWith(session.id, pivot.id)
  })

  test('regenerateInNewFork skips an anchored summary when picking the fork pivot', async () => {
    uuidQueue.push('fork-1', 'fork-2', 'fork-3', 'fork-4')
    const pivot = makeMessage('pivot', 'user')
    // Manual compaction during generation anchors the summary right after the
    // boundary (pivot), before the reply.
    const anchoredSummary = { ...makeMessage('anchored-summary', 'assistant'), isSummary: true }
    const target = makeMessage('target', 'assistant')
    const session: Session = {
      id: 'session-8b',
      name: 'Test',
      messages: [pivot, anchoredSummary, target],
    }

    getSessionMock.mockResolvedValue(session)

    let updated: Session | undefined
    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    const runGenerateMore = vi.fn().mockResolvedValue(undefined)

    await sessionActions.regenerateInNewFork(session.id, target, { runGenerateMore })

    // The fork must be keyed on the real conversation message, not the
    // summary (fork UI attaches to the pivot; summaries are deletable).
    expect(updated?.messageForksHash?.[pivot.id]).toBeDefined()
    expect(updated?.messageForksHash?.[anchoredSummary.id]).toBeUndefined()
    // The anchored summary stays in the shared prefix, not in the fork tail.
    expect(updated?.messages.map((m) => m.id)).toEqual([pivot.id, anchoredSummary.id])
    expect(runGenerateMore).toHaveBeenCalledWith(session.id, pivot.id)
  })

  test('saveAndResendMessage versions the prompt under its predecessor', async () => {
    // replacement id + seed/stored/new-active fork list ids.
    uuidQueue.push('replacement-id', 'seed-list', 'stored-list', 'new-active-list')
    const before = [makeMessage('u1', 'user'), makeMessage('a1', 'assistant')]
    const original = makeMessage('u2', 'user')
    const oldReply = makeMessage('a2', 'assistant')
    const session: Session = {
      id: 'session-save-resend',
      name: 'Test',
      messages: [...before, original, oldReply],
    }

    getSessionMock.mockResolvedValue(session)
    let updated: Session | undefined
    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      updated = updater(session) as Session
      return updated
    })
    const runGenerateMore = vi.fn().mockResolvedValue(undefined)

    const edited = { ...original, contentParts: [{ type: 'text' as const, text: 'edited prompt' }] }
    await sessionActions.saveAndResendMessage(session.id, edited, { runGenerateMore })

    // The edited copy replaces the tail under a new id; the original prompt
    // and its replies survive as a branch keyed on the predecessor.
    expect(updated?.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'replacement-id'])
    expect(updated?.messages.at(-1)?.contentParts).toEqual(edited.contentParts)
    const fork = updated?.messageForksHash?.['a1']
    expect(fork?.position).toBe(1)
    expect(fork?.lists.map((list) => list.messages.map((m) => m.id))).toEqual([['u2', 'a2'], []])
    expect(updateMessageMock).not.toHaveBeenCalled()
    expect(runGenerateMore).toHaveBeenCalledWith(session.id, 'replacement-id')
  })

  test('saveAndResendMessage blocks the resend when the target is in the pre-controller streaming window', async () => {
    const pivot = makeMessage('pivot', 'user')
    const target = { ...makeMessage('target', 'assistant'), generating: true }
    const session: Session = {
      id: 'session-save-resend-streaming',
      name: 'Test',
      messages: [pivot, target],
    }

    getSessionMock.mockResolvedValue(session)

    await sessionActions.saveAndResendMessage(session.id, target)

    // The edit is still saved in place (user text survives); only the fork
    // and the resend are blocked. The extra session read belongs to that
    // in-place save.
    expect(getSessionMock).toHaveBeenCalledTimes(2)
    expect(updateSessionWithMessages).not.toHaveBeenCalled()
    expect(updateMessageMock).toHaveBeenCalledWith(session.id, target.id, expect.objectContaining({ id: target.id }))
    expect(toastMock).toHaveBeenCalledWith('Wait for the current replies to finish', 2500)
  })

  test('saveAndResendMessage stops when the target no longer exists', async () => {
    const session: Session = {
      id: 'session-save-resend-missing',
      name: 'Test',
      messages: [makeMessage('other', 'user')],
    }

    getSessionMock.mockResolvedValue(session)

    await sessionActions.saveAndResendMessage(session.id, makeMessage('deleted-target', 'user'))

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(updateSessionWithMessages).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })

  test('saveAndResendMessage still saves the edit when the session read fails', async () => {
    const session: Session = {
      id: 'session-save-resend-read-error',
      name: 'Test',
      messages: [makeMessage('target', 'user'), makeMessage('reply', 'assistant')],
    }
    getSessionMock.mockRejectedValueOnce(new Error('session read failed'))
    getSessionMock.mockResolvedValue(session)
    const edited = { ...makeMessage('target', 'user'), contentParts: [{ type: 'text' as const, text: 'edited' }] }

    await expect(sessionActions.saveAndResendMessage(session.id, edited)).resolves.toBeUndefined()

    // The failed guarded read falls back to a plain in-place save of the edit.
    expect(updateMessageMock).toHaveBeenCalledWith(
      session.id,
      'target',
      expect.objectContaining({ id: 'target', contentParts: [{ type: 'text', text: 'edited' }] })
    )
    expect(updateSessionWithMessages).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })

  test('saveAndResendMessage stays rejection-free when every session read fails', async () => {
    getSessionMock.mockRejectedValue(new Error('session read failed'))

    await expect(
      sessionActions.saveAndResendMessage('session-save-resend-read-error', makeMessage('target', 'user'))
    ).resolves.toBeUndefined()

    expect(updateSessionWithMessages).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })

  test('moveThreadToConversations preserves thread forks and drops unrelated ones', async () => {
    uuidQueue.push('copied-thread-pivot', 'copied-thread-reply', 'copied-list-0', 'copied-thread-alt', 'copied-list-1')
    const currentPivot = makeMessage('current-pivot', 'user')
    const currentReply = makeMessage('current-reply', 'assistant')
    const threadPivot = makeMessage('thread-pivot', 'user')
    const threadReply = makeMessage('thread-reply', 'assistant')
    const threadAlternative = makeMessage('thread-alt', 'assistant')
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Moved Thread',
      createdAt: 1,
      messages: [threadPivot, threadReply],
    }
    const session: Session = {
      id: 'session-move-thread',
      name: 'Source Session',
      messages: [currentPivot, currentReply],
      threads: [thread],
      messageForksHash: {
        [currentPivot.id]: {
          position: 0,
          lists: [
            { id: 'current-list-0', messages: [] },
            { id: 'current-list-1', messages: [makeMessage('current-alt', 'assistant')] },
          ],
          createdAt: 1,
        },
        [threadPivot.id]: {
          position: 0,
          lists: [
            { id: 'thread-list-0', messages: [] },
            { id: 'thread-list-1', messages: [threadAlternative] },
          ],
          createdAt: 2,
        },
      },
    }

    getSessionMock.mockResolvedValue(session)
    createSessionMock.mockImplementation(async (newSession: Omit<Session, 'id'>) => ({
      ...newSession,
      id: 'new-session-thread',
    }))

    await sessionActions.moveThreadToConversations(session.id, thread.id)

    expect(createSessionMock).toHaveBeenCalledTimes(1)
    const newSession = createSessionMock.mock.calls[0][0] as Omit<Session, 'id'>
    expect(newSession.name).toBe(thread.name)
    expect(newSession.threads).toEqual([])
    expect(newSession.messages).toHaveLength(2)
    expect(newSession.messages[0].id).not.toBe(threadPivot.id)
    expect(newSession.messageForksHash).toBeDefined()
    expect(Object.keys(newSession.messageForksHash ?? {})).toHaveLength(1)

    const copiedPivotId = newSession.messages[0].id
    const copiedFork = newSession.messageForksHash?.[copiedPivotId]
    expect(copiedFork).toBeDefined()
    expect(copiedFork?.lists[1].messages[0].id).not.toBe(threadAlternative.id)
    expect(updateSessionWithMessages).toHaveBeenCalledWith(session.id, { threads: [] })
    expect(routerNavigateMock).toHaveBeenCalledWith({ to: '/session/new-session-thread' })
  })

  test('moveCurrentThreadToConversations preserves current thread forks', async () => {
    uuidQueue.push('copied-pivot', 'copied-reply', 'copied-current-list-0', 'copied-alt', 'copied-current-list-1')
    const pivot = makeMessage('pivot', 'user')
    const reply = makeMessage('reply', 'assistant')
    const alternative = makeMessage('alt', 'assistant')
    const historyPivot = makeMessage('history-pivot', 'user')
    const historyReply = makeMessage('history-reply', 'assistant')
    const session: Session = {
      id: 'session-move-current',
      name: 'Source Session',
      threadName: 'Current Topic',
      messages: [pivot, reply],
      threads: [
        {
          id: 'history-1',
          name: 'History',
          createdAt: 1,
          messages: [historyPivot, historyReply],
        },
      ],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'list-0', messages: [] },
            { id: 'list-1', messages: [alternative] },
          ],
          createdAt: 1,
        },
      },
    }

    getSessionMock.mockResolvedValue(session)
    createSessionMock.mockImplementation(async (newSession: Omit<Session, 'id'>) => ({
      ...newSession,
      id: 'new-session-current',
    }))

    await sessionActions.moveCurrentThreadToConversations(session.id)

    expect(createSessionMock).toHaveBeenCalledTimes(1)
    const newSession = createSessionMock.mock.calls[0][0] as Omit<Session, 'id'>
    expect(newSession.name).toBe('Current Topic')
    expect(newSession.threads).toEqual([])
    expect(newSession.messageForksHash).toBeDefined()

    const copiedPivotId = newSession.messages[0].id
    const copiedFork = newSession.messageForksHash?.[copiedPivotId]
    expect(copiedFork).toBeDefined()
    expect(copiedFork?.lists[1].messages[0].id).not.toBe(alternative.id)

    expect(updateSessionWithMessages).toHaveBeenCalledTimes(1)
    // removeCurrentThread uses a functional updater to read the queue's
    // current session; apply it to verify the restored thread state.
    const [updatedSessionId, updater] = updateSessionWithMessages.mock.calls[0] as [string, (s: Session) => Session]
    expect(updatedSessionId).toBe(session.id)
    expect(typeof updater).toBe('function')
    const restored = updater(session)
    expect(restored.messages).toEqual([historyPivot, historyReply])
    expect(restored.threadName).toBe('History')
    expect(routerNavigateMock).toHaveBeenCalledWith({ to: '/session/new-session-current' })
  })

  test('copyAndSwitchSession preserves current and historical thread forks', async () => {
    uuidQueue.push(
      'copied-root-pivot',
      'copied-root-reply',
      'copied-thread-pivot',
      'copied-thread-reply',
      'copied-root-list-0',
      'copied-root-alt',
      'copied-root-list-1',
      'copied-thread-list-0',
      'copied-thread-alt',
      'copied-thread-list-1',
      'copied-thread-id',
      'copied-fork-marker'
    )
    const rootPivot = makeMessage('root-pivot', 'user')
    const rootReply = makeMessage('root-reply', 'assistant')
    const existingForkMarker = {
      ...makeMessage('existing-fork-marker', 'assistant'),
      isForkMarker: true,
      forkedFromSessionId: 'original-session',
    }
    const rootAlternative = makeMessage('root-alt', 'assistant')
    const threadPivot = makeMessage('thread-pivot', 'user')
    const threadReply = makeMessage('thread-reply', 'assistant')
    const threadAlternative = makeMessage('thread-alt', 'assistant')
    const session: Session = {
      id: 'session-copy',
      name: 'Source Session',
      messages: [rootPivot, rootReply, existingForkMarker],
      threads: [
        {
          id: 'thread-1',
          name: 'History',
          createdAt: 1,
          messages: [threadPivot, threadReply],
        },
      ],
      messageForksHash: {
        [rootPivot.id]: {
          position: 0,
          lists: [
            { id: 'root-list-0', messages: [] },
            { id: 'root-list-1', messages: [rootAlternative] },
          ],
          createdAt: 1,
        },
        [threadPivot.id]: {
          position: 0,
          lists: [
            { id: 'thread-list-0', messages: [] },
            { id: 'thread-list-1', messages: [threadAlternative] },
          ],
          createdAt: 2,
        },
      },
      settings: {
        agentMode: { value: 'on', locked: true, lockReason: 'message_sent' },
      },
    }

    getSessionMock.mockResolvedValue(session)
    createSessionMock.mockImplementation(async (newSession: Omit<Session, 'id'>) => ({
      ...newSession,
      id: 'new-session-copy',
    }))

    await sessionActions.copyAndSwitchSession({
      id: session.id,
      name: session.name,
    })

    expect(createSessionMock).toHaveBeenCalledTimes(1)
    const newSession = createSessionMock.mock.calls[0][0] as Omit<Session, 'id'>
    expect(newSession.messageForksHash).toBeDefined()
    expect(Object.keys(newSession.messageForksHash ?? {})).toHaveLength(2)

    const copiedRootPivotId = newSession.messages[0].id
    expect(newSession.messageForksHash?.[copiedRootPivotId]).toBeDefined()

    const copiedThreadPivotId = newSession.threads?.[0].messages[0].id
    expect(copiedThreadPivotId).toBeDefined()
    expect(newSession.messageForksHash?.[copiedThreadPivotId!]).toBeDefined()
    expect(newSession.messages.filter((message) => message.isForkMarker)).toHaveLength(1)
    expect(newSession.messages.at(-1)?.id).toBe('copied-fork-marker')
    expect(newSession.messages.at(-1)?.isForkMarker).toBe(true)
    expect(newSession.messages.at(-1)?.forkedFromSessionId).toBe(session.id)
    expect(newSession.settings?.agentMode).toEqual({ value: 'on', locked: true, lockReason: 'message_sent' })
    expect(setSessionAgentModeMock).not.toHaveBeenCalled()
    expect(lockSessionAgentModeMock).not.toHaveBeenCalled()
    expect(routerNavigateMock).toHaveBeenCalledWith({ to: '/session/new-session-copy' })
  })

  test('copyAndSwitchSession remaps compaction points anchored in inactive fork branches', async () => {
    uuidQueue.push(
      'copied-pivot',
      'copied-active-reply',
      'copied-list-0',
      'copied-inactive-boundary',
      'copied-inactive-summary',
      'copied-list-1',
      'copied-fork-marker'
    )
    const pivot = makeMessage('pivot', 'user')
    const activeReply = makeMessage('active-reply', 'assistant')
    const inactiveBoundary = makeMessage('inactive-boundary', 'assistant')
    const inactiveSummary = { ...makeMessage('inactive-summary', 'assistant'), isSummary: true }
    // The compacted branch was switched inactive: its boundary and summary
    // live in a saved fork list while the point stays at session level.
    const session: Session = {
      id: 'session-copy-compacted-fork',
      name: 'Source Session',
      messages: [pivot, activeReply],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'list-0', messages: [] },
            { id: 'list-1', messages: [inactiveBoundary, inactiveSummary] },
          ],
          createdAt: 1,
        },
      },
      compactionPoints: [
        { summaryMessageId: inactiveSummary.id, boundaryMessageId: inactiveBoundary.id, createdAt: 100 },
      ],
    }

    getSessionMock.mockResolvedValue(session)
    createSessionMock.mockImplementation(async (newSession: Omit<Session, 'id'>) => ({
      ...newSession,
      id: 'new-session-compacted-fork',
    }))

    await sessionActions.copyAndSwitchSession({ id: session.id, name: session.name })

    const newSession = createSessionMock.mock.calls[0][0] as Omit<Session, 'id'>
    const copiedPivotId = newSession.messages[0].id
    const copiedBranch = newSession.messageForksHash?.[copiedPivotId]?.lists[1].messages
    expect(copiedBranch).toBeDefined()
    // The point survives the copy, remapped to the copied fork-list messages,
    // so switching to that branch in the copy still applies the compaction.
    expect(newSession.compactionPoints).toEqual([
      {
        summaryMessageId: copiedBranch?.[1].id,
        boundaryMessageId: copiedBranch?.[0].id,
        createdAt: 100,
      },
    ])
  })

  test('copyAndSwitchSession remaps archived-thread points anchored in inactive fork branches', async () => {
    uuidQueue.push(
      'copied-active', // active message
      'copied-thread-pivot', // thread messages
      'copied-thread-reply',
      'copied-thread-id',
      'copied-list-0', // fork lists (reachable from the thread pivot)
      'copied-fork-boundary',
      'copied-fork-summary',
      'copied-list-1',
      'copied-fork-marker'
    )
    const active = makeMessage('active', 'user')
    const threadPivot = makeMessage('thread-pivot', 'user')
    const threadReply = makeMessage('thread-reply', 'assistant')
    const forkBoundary = makeMessage('fork-boundary', 'assistant')
    const forkSummary = { ...makeMessage('fork-summary', 'assistant'), isSummary: true }
    // The compacted fork branch is inactive inside an archived thread: its
    // boundary/summary are only reachable via the fork list, which is copied
    // after the threads.
    const session: Session = {
      id: 'session-copy-thread-fork',
      name: 'Source Session',
      messages: [active],
      threads: [
        {
          id: 'thread-1',
          name: 'History',
          createdAt: 1,
          messages: [threadPivot, threadReply],
          compactionPoints: [{ summaryMessageId: forkSummary.id, boundaryMessageId: forkBoundary.id, createdAt: 100 }],
        },
      ],
      messageForksHash: {
        [threadPivot.id]: {
          position: 0,
          lists: [
            { id: 'list-0', messages: [] },
            { id: 'list-1', messages: [forkBoundary, forkSummary] },
          ],
          createdAt: 1,
        },
      },
    }

    getSessionMock.mockResolvedValue(session)
    createSessionMock.mockImplementation(async (newSession: Omit<Session, 'id'>) => ({
      ...newSession,
      id: 'new-session-thread-fork',
    }))

    await sessionActions.copyAndSwitchSession({ id: session.id, name: session.name })

    const newSession = createSessionMock.mock.calls[0][0] as Omit<Session, 'id'>
    const copiedThreadPivotId = newSession.threads?.[0].messages[0].id
    const copiedBranch = newSession.messageForksHash?.[copiedThreadPivotId!]?.lists[1].messages
    expect(copiedBranch).toBeDefined()
    // The thread's point survives the copy, remapped to the fork-list copies
    // even though fork lists are copied after the threads.
    expect(newSession.threads?.[0].compactionPoints).toEqual([
      {
        summaryMessageId: copiedBranch?.[1].id,
        boundaryMessageId: copiedBranch?.[0].id,
        createdAt: 100,
      },
    ])
  })
})
