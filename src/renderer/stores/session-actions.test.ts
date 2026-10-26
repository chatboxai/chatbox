import { resetSessionGenerationLocksForTests } from '@chatbox/core/generation'
import type { InMemorySessionRepository } from '@chatbox/core/testing'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { rendererApplication } from '@/app/renderer-application'
import type {
  Message,
  Session,
  SessionMetaRecord,
  SessionPromptContextSnapshot,
  SessionThread,
} from '../../shared/types'
import * as sessionActions from './session'
import { sessionActivityStore } from './sessionActivityStore'

const {
  fixtureState,
  uuidQueue,
  uuidv4Mock,
  routerNavigateMock,
  sessionAgentModeMapMock,
  setSessionAgentModeMock,
  lockSessionAgentModeMock,
  toastMock,
  orchestrateMock,
} = vi.hoisted(() => {
  const queue: string[] = []
  let nextId = 0
  return {
    fixtureState: { repository: null as InMemorySessionRepository | null },
    uuidQueue: queue,
    uuidv4Mock: vi.fn(() => queue.shift() ?? `generated-${++nextId}`),
    routerNavigateMock: vi.fn(),
    sessionAgentModeMapMock: {} as Record<
      string,
      { value: 'auto' | 'on' | 'off'; locked: boolean; lockReason: string | null }
    >,
    setSessionAgentModeMock: vi.fn(),
    lockSessionAgentModeMock: vi.fn(),
    toastMock: vi.fn(),
    orchestrateMock: vi.fn(async () => {}),
  }
})
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

vi.mock('uuid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('uuid')>()),
  v4: uuidv4Mock,
}))

vi.mock('i18next', () => ({ t: (key: string) => key }))
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key, language: 'en' } }))

vi.mock('@/app/renderer-application', async () => {
  const { SessionService, SessionWriteCoordinator, SessionEventBus } = await import('@chatbox/core/application/session')
  const { InMemorySessionRepository } = await import('@chatbox/core/testing')
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  const { QueryClient } = await import('@tanstack/react-query')
  const repository = new InMemorySessionRepository()
  fixtureState.repository = repository
  const events = new SessionEventBus()
  const sessions = new SessionService(repository, new SessionWriteCoordinator(repository), events, {
    createId: () => 'copied-session',
    now: () => 100,
  })
  return {
    rendererApplication: {
      generationRuntime: new GenerationRuntimeStore(),
      queryClient: new QueryClient(),
      sessions,
      sessionEvents: events,
      sessionQueryBridge: {
        listSessionsMeta: vi.fn().mockResolvedValue([]),
        updateSessionListData: vi.fn(),
        updateMessageCache: vi.fn(),
      },
      sessionHooks: { useSessionHeader: () => ({ session: null }) },
    },
  }
})
vi.mock('@/adapters/CurrentGenerationService', () => ({ currentGenerationService: { orchestrate: orchestrateMock } }))

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
      transcriptNavigation: null,
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

const sessions = rendererApplication.sessions
const generationRuntimeStore = rendererApplication.generationRuntime
const repository = () => fixtureState.repository!
const inspect = (id: string) => repository().inspectSession(id)!
async function seed(value: Session) {
  await repository().seedSession(value)
  repository().records.set(value.id, { id: value.id, name: value.name, sortOrder: 1, createdAt: 1 })
}
function makeMessage(id: string, role: Message['role'] = 'user'): Message {
  return { id, role, contentParts: [] }
}
function cloneSession(session: Session): Session {
  return JSON.parse(JSON.stringify(session)) as Session
}
function makePromptContextSnapshot(soul: string): SessionPromptContextSnapshot {
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
function makeSessionMeta(id: string, sortOrder: number): SessionMetaRecord {
  return { id, name: id, sortOrder, createdAt: sortOrder }
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  uuidQueue.length = 0
  repository().rowStore.clear()
  repository().recordStore.clear()
  repository().records.clear()
  rendererApplication.queryClient.clear()
  generationRuntimeStore.dispose()
  resetSessionGenerationLocksForTests()
  for (const key of Object.keys(sessionAgentModeMapMock)) delete sessionAgentModeMapMock[key]
  sessionActivityStore.setState({ unreadSessionIds: {} }, true)
})

describe('row session actions', () => {
  test('archives sessions outside the kept range instead of deleting them', async () => {
    vi.spyOn(sessions, 'listAllSessionsMeta').mockResolvedValue([
      makeSessionMeta('keep-1', 300),
      makeSessionMeta('keep-2', 200),
      makeSessionMeta('archive-1', 100),
      makeSessionMeta('archive-2', 0),
    ])
    const archive = vi.spyOn(sessions, 'archiveSessions').mockResolvedValue()
    const remove = vi.spyOn(sessions, 'deleteSessions')
    await sessionActions.clearConversationList(2)
    expect(archive).toHaveBeenCalledOnce()
    expect(archive).toHaveBeenCalledWith(['archive-1', 'archive-2'])
    expect(remove).not.toHaveBeenCalled()
  })
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
    await seed(session)
    generationRuntimeStore.start(session.id, forkReply.id)
    sessionActivityStore.setState({ unreadSessionIds: { [session.id]: 'completed' } })
    await sessionActions.clear(session.id)
    expect(generationRuntimeStore.get(session.id, forkReply.id)).toBeUndefined()
    expect(inspect(session.id).messages).toEqual([])
    expect(inspect(session.id).messageForksHash ?? {}).toEqual({})
    expect(sessionActivityStore.getState().unreadSessionIds[session.id]).toBeUndefined()
  })
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

    await seed(session)

    await sessionActions.createNewFork(session.id, pivot.id)
    const updated = inspect(session.id)

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
  test('createNewFork keeps a lone pivot unchanged', async () => {
    uuidQueue.push('seed-list', 'stored-list', 'active-list')
    const pivot = makeMessage('pivot', 'user')
    const session: Session = {
      id: 'session-2',
      name: 'Test',
      messages: [pivot],
    }
    const snapshot = cloneSession(session)
    await seed(session)

    await sessionActions.createNewFork(session.id, pivot.id)
    const updated = inspect(session.id)

    expect(session).toEqual(snapshot)
    expect(updated.messages).toEqual(session.messages)
    expect(updated.messageForksHash ?? {}).toEqual({})
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
    await seed(session)

    await sessionActions.switchFork(session.id, pivot.id, 'next')
    const updated = inspect(session.id)

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
    await seed(session)

    await sessionActions.switchFork(session.id, pivot.id, 'next')
    const updated = inspect(session.id)

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
    await seed(session)

    await sessionActions.deleteFork(session.id, pivot.id)
    const updated = inspect(session.id)

    expect(session).toEqual(snapshot)
    expect(updated!.messages).toEqual([pivot, nextBranch])
    expect(updated.messageForksHash?.[pivot.id]).toBeUndefined()
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
    await seed(session)

    await sessionActions.deleteFork(session.id, pivot.id)
    const updated = inspect(session.id)

    expect(session).toEqual(snapshot)
    expect(updated!.messages).toEqual([pivot])
    expect(updated!.messageForksHash ?? {}).toEqual({})
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
    await seed(session)

    await sessionActions.expandFork(session.id, pivot.id)
    const updated = inspect(session.id)

    expect(session).toEqual(snapshot)
    expect(updated!.messages).toEqual([pivot, current, altA, altB])
    expect(updated!.messageForksHash ?? {}).toEqual({})
  })
  test('regenerateInNewFork creates a new fork for thread messages', async () => {
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

    await seed(session)
    await sessionActions.regenerateInNewFork(session.id, target)
    const updated = inspect(session.id)
    const fork = updated.messageForksHash?.[pivot.id]
    expect(fork?.lists).toHaveLength(2)
    expect(fork?.lists[0].messages).toEqual([target])
    expect(orchestrateMock).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ role: 'assistant', generating: true }),
      { operationType: 'regenerate' }
    )
    expect(session).toEqual(snapshot)
    expect(updated.threads?.[0].messages.map((message) => message.id).slice(0, 1)).toEqual([pivot.id])
    expect(updated.threads?.[0].messages.at(-1)?.generating).toBe(true)
  })
  test('regenerateInNewFork skips an anchored summary when picking the fork pivot', async () => {
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

    await seed(session)
    await sessionActions.regenerateInNewFork(session.id, target)
    const updated = inspect(session.id)
    const fork = updated.messageForksHash?.[pivot.id]
    expect(fork?.lists).toHaveLength(2)
    expect(fork?.lists[0].messages).toEqual([target])
    expect(orchestrateMock).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ role: 'assistant', generating: true }),
      { operationType: 'regenerate' }
    )
    expect(updated.messageForksHash?.[anchoredSummary.id]).toBeUndefined()
    expect(updated.messages.slice(0, 2)).toEqual([pivot, anchoredSummary])
    expect(updated.messages.at(-1)?.generating).toBe(true)
  })
  test('saveAndResendMessage versions the prompt under its predecessor', async () => {
    const before = [makeMessage('u1', 'user'), makeMessage('a1', 'assistant')]
    const original = makeMessage('u2', 'user')
    const oldReply = makeMessage('a2', 'assistant')
    const session: Session = {
      id: 'session-save-resend',
      name: 'Test',
      messages: [...before, original, oldReply],
    }

    await seed(session)
    uuidQueue.push('replacement-id', 'seed-list', 'stored-list', 'new-active-list')
    const update = vi.spyOn(sessions, 'updateMessage')
    const runGenerateMore = vi.fn().mockResolvedValue(undefined)
    const edited = { ...original, contentParts: [{ type: 'text' as const, text: 'edited prompt' }] }
    await sessionActions.saveAndResendMessage(session.id, edited, { runGenerateMore })
    const updated = inspect(session.id)
    expect(updated.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'replacement-id'])
    expect(updated.messages.at(-1)?.contentParts).toEqual(edited.contentParts)
    expect(updated.messageForksHash?.a1.lists.map((list) => list.messages.map((message) => message.id))).toEqual([
      ['u2', 'a2'],
      [],
    ])
    expect(update).not.toHaveBeenCalled()
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

    await seed(session)
    const structure = vi.spyOn(sessions, 'executeStructureCommand')
    const update = vi.spyOn(sessions, 'updateMessage')
    await sessionActions.saveAndResendMessage(session.id, target)
    expect(structure).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(session.id, target.id, expect.objectContaining({ id: target.id }))
    expect(toastMock).toHaveBeenCalledWith('Wait for the current replies to finish', 2500)
  })
  test('saveAndResendMessage stops when the target no longer exists', async () => {
    const session: Session = {
      id: 'session-save-resend-missing',
      name: 'Test',
      messages: [makeMessage('other', 'user')],
    }

    await seed(session)
    const structure = vi.spyOn(sessions, 'executeStructureCommand')
    const update = vi.spyOn(sessions, 'updateMessage')
    await sessionActions.saveAndResendMessage(session.id, makeMessage('deleted-target'))
    expect(structure).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })
  test('saveAndResendMessage still saves the edit when the header read fails', async () => {
    const session: Session = {
      id: 'read-error',
      name: 'Test',
      messages: [makeMessage('target'), makeMessage('reply', 'assistant')],
    }
    await seed(session)
    vi.spyOn(sessions, 'getSessionHeader').mockRejectedValueOnce(new Error('header read failed'))
    const structure = vi.spyOn(sessions, 'executeStructureCommand')
    const edited = { ...makeMessage('target'), contentParts: [{ type: 'text' as const, text: 'edited' }] }
    await expect(sessionActions.saveAndResendMessage(session.id, edited)).resolves.toBeUndefined()
    expect(inspect(session.id).messages[0].contentParts).toEqual(edited.contentParts)
    expect(structure).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })
  test('saveAndResendMessage stays rejection-free when every read fails', async () => {
    vi.spyOn(sessions, 'getSessionHeader').mockRejectedValue(new Error('header read failed'))
    vi.spyOn(sessions, 'readSessionMessages').mockRejectedValue(new Error('message read failed'))
    const structure = vi.spyOn(sessions, 'executeStructureCommand')
    await expect(sessionActions.saveAndResendMessage('read-error', makeMessage('target'))).resolves.toBeUndefined()
    expect(structure).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })
  test('moveThreadToConversations preserves thread forks and drops unrelated ones', async () => {
    const currentPivot = makeMessage('current-pivot', 'user')
    const currentReply = makeMessage('current-reply', 'assistant')
    const threadPivot = makeMessage('thread-pivot', 'user')
    const threadReply = makeMessage('thread-reply', 'assistant')
    const threadAlternative = { ...makeMessage('thread-alt', 'assistant'), isSummary: true }
    const currentPromptContext = makePromptContextSnapshot('Current Soul')
    const threadPromptContext = makePromptContextSnapshot('Moved Thread Soul')
    const threadCompactionPoint = {
      summaryMessageId: threadAlternative.id,
      boundaryMessageId: threadPivot.id,
      createdAt: 3,
    }
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Moved Thread',
      createdAt: 1,
      messages: [threadPivot, threadReply],
      compactionPoints: [threadCompactionPoint],
      sessionPromptContextSnapshot: threadPromptContext,
    }
    const session: Session = {
      id: 'session-move-thread',
      name: 'Source Session',
      messages: [currentPivot, currentReply],
      settings: {
        provider: 'openai',
        temperature: 0.25,
        sessionPromptContextSnapshot: currentPromptContext,
      },
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
    await seed(session)
    await sessionActions.moveThreadToConversations(session.id, thread.id)
    const newSession = inspect('copied-session')
    const updatedSource = inspect(session.id)
    expect(newSession.name).toBe(thread.name)
    expect(newSession.threads).toBeUndefined()
    expect(newSession.messages).toHaveLength(2)
    expect(newSession.messages[0].id).not.toBe(threadPivot.id)
    expect(Object.keys(newSession.messageForksHash ?? {})).toHaveLength(1)
    const copiedPivotId = newSession.messages[0].id
    const copiedFork = newSession.messageForksHash?.[copiedPivotId]
    const copiedAlternativeId = copiedFork?.lists[1].messages[0].id
    expect(copiedAlternativeId).not.toBe(threadAlternative.id)
    expect(newSession.compactionPoints).toEqual([
      { ...threadCompactionPoint, boundaryMessageId: copiedPivotId, summaryMessageId: copiedAlternativeId },
    ])
    expect(newSession.settings).toEqual({
      provider: 'openai',
      temperature: 0.25,
      sessionPromptContextSnapshot: threadPromptContext,
    })
    expect(updatedSource.threads).toBeUndefined()
    expect(updatedSource.settings).toEqual(session.settings)
    expect(updatedSource.messageForksHash?.[currentPivot.id]).toBeDefined()
    expect(routerNavigateMock).toHaveBeenCalledWith({ to: '/session/copied-session' })
  })
  test('retains the published copy and concurrent source edits when removal loses its revision fence', async () => {
    const moved: SessionThread = { id: 'moved', name: 'Moved', createdAt: 1, messages: [makeMessage('old')] }
    const concurrent: SessionThread = {
      id: 'concurrent',
      name: 'Concurrent',
      createdAt: 2,
      messages: [makeMessage('new')],
    }
    const original: Session = { id: 'source', name: 'Source', messages: [makeMessage('current')], threads: [moved] }
    await seed(original)
    const copy = sessions.copySessionThread.bind(sessions)
    vi.spyOn(sessions, 'copySessionThread').mockImplementationOnce(async (request) => {
      const result = await copy(request)
      await repository().seedSession({ ...original, threads: [moved, concurrent] })
      return result
    })
    await expect(sessionActions.moveThreadToConversations(original.id, moved.id)).rejects.toThrow()
    expect(inspect(original.id).threads).toEqual([moved, concurrent])
    expect(inspect('copied-session').messages).toHaveLength(1)
    expect(routerNavigateMock).not.toHaveBeenCalled()
  })
  test('moveCurrentThreadToConversations preserves current thread forks', async () => {
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

    await seed(session)
    await sessionActions.moveCurrentThreadToConversations(session.id)
    const newSession = inspect('copied-session')
    expect(newSession.name).toBe('Current Topic')
    expect(newSession.threads).toBeUndefined()
    const copiedFork = newSession.messageForksHash?.[newSession.messages[0].id]
    expect(copiedFork?.lists[1].messages[0].id).not.toBe(alternative.id)
    const restored = inspect(session.id)
    expect(restored.messages).toEqual([historyPivot, historyReply])
    expect(restored.threadName).toBe('History')
    expect(routerNavigateMock).toHaveBeenCalledWith({ to: '/session/copied-session' })
  })
  test('copyAndSwitchSession preserves current and historical thread forks', async () => {
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

    await seed(session)
    await sessionActions.copyAndSwitchSession(session.id)
    const newSession = inspect('copied-session')
    expect(newSession.messageForksHash).toBeDefined()
    expect(Object.keys(newSession.messageForksHash ?? {})).toHaveLength(2)

    const copiedRootPivotId = newSession.messages[0].id
    expect(newSession.messageForksHash?.[copiedRootPivotId]).toBeDefined()

    const copiedThreadPivotId = newSession.threads?.[0].messages[0].id
    expect(copiedThreadPivotId).toBeDefined()
    expect(newSession.messageForksHash?.[copiedThreadPivotId!]).toBeDefined()
    expect(newSession.messages.filter((message) => message.isForkMarker)).toHaveLength(1)
    expect(newSession.messages.at(-1)?.id).not.toBe(existingForkMarker.id)
    expect(newSession.messages.at(-1)?.isForkMarker).toBe(true)
    expect(newSession.messages.at(-1)?.forkedFromSessionId).toBe(session.id)
    expect(newSession.settings?.agentMode).toEqual({ value: 'on', locked: true, lockReason: 'message_sent' })
    expect(setSessionAgentModeMock).not.toHaveBeenCalled()
    expect(lockSessionAgentModeMock).not.toHaveBeenCalled()
    expect(routerNavigateMock).toHaveBeenCalledWith({ to: '/session/copied-session' })
  })
  test('copyAndSwitchSession remaps compaction points anchored in inactive fork branches', async () => {
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

    await seed(session)
    await sessionActions.copyAndSwitchSession(session.id)
    const newSession = inspect('copied-session')
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

    await seed(session)
    await sessionActions.copyAndSwitchSession(session.id)
    const newSession = inspect('copied-session')
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
