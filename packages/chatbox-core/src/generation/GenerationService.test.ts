import type { ChatStreamOptions, ModelInterface, ModelStreamPart } from '@shared/models/types'
import type { Config, Message, Session, SessionSettings, Settings } from '@shared/types'
import { jsonSchema, type ModelMessage, type ToolSet } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompactionService } from '../application/context/CompactionService'
import { createGenerationSegmentSplitWriter } from '../application/session/generation-segment-split'
import { getSessionMessageTokenizationDigest } from '../application/session/message-derived-data'
import { RowBackedSessionRepository } from '../application/session/RowBackedSessionRepository'
import { contextSourceFromRows } from '../application/session/session-context-source'
import { StreamingWriteCoordinator } from '../application/session/streaming-write-coordinator'
import { selectTokenEstimationContext } from '../application/token-estimation/TokenEstimationService'
import { contextPathFacts } from '../persistence/session-context-read'
import { contextSession, contextSnapshot } from '../persistence/session-context-read.test-support'
import { generationStreamFixture } from '../testing/generation-stream'
import { InMemorySessionRecordStore } from '../testing/InMemorySessionRecordStore'
import { InMemorySessionRowStore } from '../testing/InMemorySessionRowStore'
import {
  type GenerationCompactionPort,
  type GenerationHostPort,
  type GenerationPreparationRequest,
  GenerationService,
  type GenerationServiceDependencies,
  type GenerationSessionPort,
  type GenerationSteeringPort,
} from './GenerationService'
import { GenerationRuntimeStore } from './runtime-store'

type ModelContext = { host: 'test' }

function targetMessage(): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    generating: true,
    contentParts: [],
  }
}

function createSession(): Session {
  return {
    id: 'session-1',
    name: 'Session',
    type: 'chat',
    messages: [{ id: 'user-1', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] }, targetMessage()],
  }
}

async function* stream(chunks: ModelStreamPart<ToolSet>[], terminalError?: unknown) {
  await Promise.resolve()
  for (const chunk of chunks) {
    yield chunk
  }
  if (terminalError) throw terminalError
}

interface Harness {
  service: GenerationService<ModelContext>
  runtime: GenerationRuntimeStore
  persisted: Array<{ message: Message; refreshCounting: boolean }>
  cached: Message[]
  coordinationEvents: string[]
  storedBlobs: Map<string, string>
  storeBlob: ReturnType<typeof vi.fn>
  session: Session
  sessions: GenerationSessionPort
  preparedRequests: GenerationPreparationRequest<ModelContext>[]
  /** The object `getSessionSettings` resolves to; mutate it to drive per-chat settings. */
  sessionSettings: SessionSettings
  globalSettings: Settings
  trackPauseAction: ReturnType<typeof vi.fn>
  afterMessageGenerated: ReturnType<typeof vi.fn>
  afterMessageFailed: ReturnType<typeof vi.fn>
  steeringInject: ReturnType<typeof vi.fn>
  steeringAdmitAnchor: ReturnType<typeof vi.fn>
  steeringRegister: ReturnType<typeof vi.fn>
  steeringRelease: ReturnType<typeof vi.fn>
  steeringWake: ReturnType<typeof vi.fn>
  model: ModelInterface
  preparedTargetMessageIndexes: number[]
  preparedWebBrowsing: boolean[]
  inserted: Array<{ message: Message; afterMessageId: string }>
  setStreamFactory(factory: () => AsyncGenerator<ModelStreamPart<ToolSet>>): void
  setChatStreamFactory(
    factory: (messages: ModelMessage[], options: ChatStreamOptions) => AsyncGenerator<ModelStreamPart<ToolSet>>
  ): void
  setPrepareStep(prepareStep: ChatStreamOptions['prepareStep']): void
  setPreparedTools(tools: ToolSet): void
  setWebBrowsingResolver(resolver: GenerationHostPort['getWebBrowsing']): void
  setSteeredMessageIds(messageIds: string[]): void
  setTools(tools: ToolSet): void
  failSessionSettingsUpdate(error: Error): void
  failPersistenceFromCall(call: number, error: Error): void
  /** `commit: true` emulates a write that landed but still rejected (metadata failure). */
  failInsertion(error: Error, options?: { commit?: boolean }): void
  enableAgentModeSuggestion(result: Message['contentParts']): void
  setNow(value: number): void
  setCompaction(port: GenerationCompactionPort): void
}

function createHarness(): Harness {
  const session = createSession()
  const sessionSettings = {
    provider: 'openai',
    modelId: 'test-model',
    stream: false,
  } satisfies SessionSettings
  const globalSettings = {} as Settings
  const persisted: Harness['persisted'] = []
  const cached: Message[] = []
  const coordinationEvents: string[] = []
  const runtime = new GenerationRuntimeStore()
  let now = 1_000
  let streamFactory = () => stream([])
  let chatStreamFactory = (_messages: ModelMessage[], _options: ChatStreamOptions) => streamFactory()
  let prepareStep: ChatStreamOptions['prepareStep']
  let preparedTools: ToolSet = {}
  let pausedTools: ToolSet = {}
  const storedBlobs = new Map<string, string>()
  const storeBlob = vi.fn((storageKey: string, value: string) => {
    storedBlobs.set(storageKey, value)
    return Promise.resolve()
  })
  let agentModeSuggestionEnabled = false
  let suggestionResult: Message['contentParts'] = []
  let sessionSettingsUpdateError: Error | undefined
  let persistenceFailure: { call: number; error: Error; missing?: boolean } | undefined
  let insertionFailure: { error: Error; commit?: boolean } | undefined
  let persistenceCallCount = 0
  const preparedTargetMessageIndexes: number[] = []
  const preparedWebBrowsing: boolean[] = []
  const preparedRequests: GenerationPreparationRequest<ModelContext>[] = []
  const inserted: Array<{ message: Message; afterMessageId: string }> = []
  const trackPauseAction = vi.fn()
  const afterMessageGenerated = vi.fn()
  const afterMessageFailed = vi.fn()
  const steeringInject = vi.fn((_messages: ModelMessage[], _anchorMessageId: string) =>
    Promise.resolve({ messages: undefined as ModelMessage[] | undefined, consumed: [] as Message[] })
  )
  let steeredMessageIds: string[] = []
  const steeringRelease = vi.fn()
  const steeringAdmitAnchor = vi.fn()
  const steeringRegister = vi.fn<GenerationSteeringPort['register']>(() => ({
    inject: steeringInject,
    admitAnchor: steeringAdmitAnchor,
    getInjectedMessageIds: () => steeredMessageIds,
    release: steeringRelease,
  }))
  const steeringWake = vi.fn()
  let webBrowsingResolver: GenerationHostPort['getWebBrowsing'] = () => false

  const model = {
    name: 'Test',
    modelId: 'test-model',
    isSupportVision: () => true,
    isSupportToolUse: (scope?: Parameters<ModelInterface['isSupportToolUse']>[0]) =>
      scope === 'agent' && agentModeSuggestionEnabled,
    isSupportSystemMessage: () => true,
    normalizeCompletedResponse: (parts: Message['contentParts']) => parts,
    chat: () => Promise.resolve({ contentParts: suggestionResult }),
    chatStream: async function* (messages: ModelMessage[], options: ChatStreamOptions) {
      const preparedStep = await options.prepareStep?.({
        steps: [],
        stepNumber: 0,
        model: {} as never,
        messages,
        experimental_context: undefined,
      })
      const activeToolNames = preparedStep?.activeTools ? new Set(preparedStep.activeTools.map(String)) : undefined
      const effectiveTools = activeToolNames
        ? Object.fromEntries(Object.entries(options.tools ?? {}).filter(([name]) => activeToolNames.has(name)))
        : (options.tools ?? {})
      await options.onRequestResolved?.({
        callSettings: {
          temperature: 0.25,
          maxOutputTokens: 8_192,
          providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1_024 } } },
        },
        modelMessages: preparedStep?.messages ?? messages,
        tools: effectiveTools,
        stream: true,
      })
      if (options.signal?.aborted) return
      let firstPreparedStepPending = options.prepareStep !== undefined
      const streamOptions: ChatStreamOptions = firstPreparedStepPending
        ? {
            ...options,
            prepareStep: (stepOptions) => {
              if (firstPreparedStepPending && stepOptions.stepNumber === 0) {
                firstPreparedStepPending = false
                return preparedStep
              }
              return options.prepareStep?.(stepOptions)
            },
          }
        : options
      const providerStream = chatStreamFactory(messages, streamOptions)
      const providerIterator = providerStream[Symbol.asyncIterator]()
      let current = await providerIterator.next()
      while (!current.done) {
        const next = providerIterator.next()
        yield current.value
        current = await next
      }
    },
  } as unknown as ModelInterface

  const sessions: GenerationSessionPort = {
    getSession: () => Promise.resolve(session),
    isSessionMissingError: (error) => persistenceFailure?.missing === true && error === persistenceFailure.error,
    getSessionSettings: () => Promise.resolve(sessionSettings),
    updateSessionSettings: (_sessionId, update) => {
      if (sessionSettingsUpdateError) return Promise.reject(sessionSettingsUpdateError)
      session.settings = update(session.settings)
      return Promise.resolve()
    },
    initializeTargetMessage: (message) =>
      Promise.resolve({
        ...message,
        generating: true,
        status: [],
      }),
    persistStreamingMessage: (_sessionId, message, options) => {
      persistenceCallCount += 1
      if (persistenceFailure && persistenceCallCount >= persistenceFailure.call) {
        return Promise.reject(persistenceFailure.error)
      }
      const index = session.messages.findIndex((candidate) => candidate.id === message.id)
      if (index >= 0) {
        session.messages[index] = message
      }
      persisted.push({
        message: { ...message, contentParts: [...message.contentParts] },
        refreshCounting: options?.refreshCounting === true,
      })
      return Promise.resolve()
    },
    updateStreamingCache: (_sessionId, message) => {
      cached.push({ ...message, contentParts: [...message.contentParts] })
    },
    splitStreamingMessage: createGenerationSegmentSplitWriter({
      streamingWrites: new StreamingWriteCoordinator(),
      sessions: {
        async updateSessionWithMessages(_sessionId, updater, options) {
          if (insertionFailure && !insertionFailure.commit) throw insertionFailure.error
          persistenceCallCount += 1
          if (persistenceFailure && persistenceCallCount >= persistenceFailure.call) throw persistenceFailure.error
          const previousIds = new Set(session.messages.map((message) => message.id))
          const previous = session.messages
          const next = typeof updater === 'function' ? updater(session) : updater
          Object.assign(session, next)
          for (const [index, message] of session.messages.entries()) {
            if (!previousIds.has(message.id)) {
              inserted.push({
                message: { ...message, contentParts: [...message.contentParts] },
                afterMessageId: session.messages[index - 1].id,
              })
            } else if (previous.find((old) => old.id === message.id) !== message) {
              persisted.push({
                message: { ...message, contentParts: [...message.contentParts] },
                refreshCounting: true,
              })
            }
          }
          options?.onFullSessionPersisted?.(session)
          if (insertionFailure) throw insertionFailure.error
          return session
        },
      },
    }),
    insertMessageAfter: (_sessionId, message, afterMessageId) => {
      if (insertionFailure && !insertionFailure.commit) return Promise.reject(insertionFailure.error)
      const copy = { ...message, contentParts: [...message.contentParts] }
      const index = session.messages.findIndex((candidate) => candidate.id === afterMessageId)
      // The port fails closed on an unreachable anchor rather than appending
      // elsewhere; mirror that so tests cannot rely on a silent tail insert.
      if (index < 0) return Promise.reject(new Error(`anchor ${afterMessageId} not found`))
      session.messages.splice(index + 1, 0, copy)
      inserted.push({ message: copy, afterMessageId })
      // A committed write can still reject when the session's list metadata
      // update fails afterwards (SessionMetadataUpdateError).
      return insertionFailure ? Promise.reject(insertionFailure.error) : Promise.resolve()
    },
    findMessage: (current, messageId) => current.messages.find((message) => message.id === messageId),
    modifyMessage: (_sessionId, message) => {
      const index = session.messages.findIndex((candidate) => candidate.id === message.id)
      if (index >= 0) {
        session.messages[index] = message
      }
      persisted.push({
        message: { ...message, contentParts: [...message.contentParts] },
        refreshCounting: true,
      })
      return Promise.resolve()
    },
    handleGenerationError: (error, message) => ({
      ...message,
      generating: false,
      status: [],
      error: error instanceof Error ? error.message : String(error),
      errorExtra: { source: 'test-error-mapper' },
    }),
  }

  const dependencies: GenerationServiceDependencies<ModelContext> = {
    sessions,
    settings: {
      getSettings: () => globalSettings,
      updateSettings: (update) => {
        Object.assign(globalSettings, typeof update === 'function' ? update(globalSettings) : update)
      },
    },
    models: {
      createModel: () => Promise.resolve(model),
      createContext: () => Promise.resolve({ model, context: { host: 'test' } }),
      createWithContext: () => Promise.resolve(model),
    },
    preparation: {
      prepare: (request) => {
        preparedRequests.push(request)
        preparedTargetMessageIndexes.push(request.targetMessageIndex)
        preparedWebBrowsing.push(request.webBrowsing)
        return Promise.resolve({
          promptMessages: request.messages.slice(0, request.targetMessageIndex),
          coreMessages: [{ role: 'user', content: 'Hello' }],
          tools: preparedTools,
          chatOptions: { signal: request.signal, prepareStep },
          infoParts: [],
          fallbackToolCallPart: undefined,
        })
      },
    },
    tools: {
      buildToolsForPausedToolCall: () => Promise.resolve(pausedTools),
    },
    coordination: {
      runExclusive: (sessionId, operation) => {
        coordinationEvents.push(`lock:${sessionId}`)
        return operation()
      },
      wakeBackgroundTaskFollowUps: (sessionId) => {
        coordinationEvents.push(`wake:${sessionId}`)
      },
    },
    steering: {
      register: steeringRegister,
      wake: steeringWake,
    },
    runtime,
    blobs: {
      get: (storageKey) => Promise.resolve(storedBlobs.get(storageKey) ?? null),
      set: storeBlob,
    },
    attachments: {
      read: () => Promise.resolve(null),
    },
    capabilities: {
      supports: (capability) => capability === 'agent-mode' && agentModeSuggestionEnabled,
    },
    host: {
      getConfig: () => Promise.resolve({} as Config),
      getKnowledgeBase: () => undefined,
      getWebBrowsing: (sessionId, provider, settings) => webBrowsingResolver(sessionId, provider, settings),
      getAgentModeEntry: () => ({ value: agentModeSuggestionEnabled ? 'auto' : 'off' }),
      setAgentMode: () => undefined,
      lockAgentMode: () => undefined,
      createPictureStorageKey: (sessionId, messageId) => `picture:${sessionId}:${messageId}`,
      markFirstSuccessfulChatCompleted: vi.fn(),
      afterMessageGenerated,
      afterMessageFailed,
      now: () => now,
    },
    analytics: {
      init: vi.fn(),
      event: vi.fn(),
      trackGenerate: vi.fn(),
      trackSuggestionDecision: vi.fn(),
      trackAgentModeSuggested: vi.fn(),
      trackPauseAction,
      captureException: vi.fn(),
    },
    logger: {
      log: vi.fn(),
    },
  }

  return {
    service: new GenerationService(dependencies),
    runtime,
    persisted,
    cached,
    coordinationEvents,
    storedBlobs,
    storeBlob,
    session,
    sessions,
    preparedRequests,
    sessionSettings,
    globalSettings,
    trackPauseAction,
    afterMessageGenerated,
    afterMessageFailed,
    steeringInject,
    steeringAdmitAnchor,
    steeringRegister,
    steeringRelease,
    steeringWake,
    model,
    preparedTargetMessageIndexes,
    preparedWebBrowsing,
    inserted,
    setStreamFactory(factory) {
      streamFactory = factory
    },
    setChatStreamFactory(factory) {
      chatStreamFactory = factory
    },
    setPrepareStep(nextPrepareStep) {
      prepareStep = nextPrepareStep
    },
    setPreparedTools(tools) {
      preparedTools = tools
    },
    setWebBrowsingResolver(resolver) {
      webBrowsingResolver = resolver
    },
    setSteeredMessageIds(messageIds) {
      steeredMessageIds = messageIds
    },
    setTools(tools) {
      pausedTools = tools
    },
    failSessionSettingsUpdate(error) {
      sessionSettingsUpdateError = error
    },
    failPersistenceFromCall(call, error) {
      persistenceFailure = { call, error, missing: true }
    },
    failInsertion(error, options) {
      insertionFailure = { error, commit: options?.commit === true }
    },
    enableAgentModeSuggestion(result) {
      agentModeSuggestionEnabled = true
      suggestionResult = result
    },
    setNow(value) {
      now = value
    },
    setCompaction(port) {
      dependencies.compaction = port
    },
  }
}

async function boundedHarness() {
  const harness = createHarness()
  const complete = contextSession(100)
  complete.id = 'session-1'
  const target = complete.messages.at(-1)
  if (!target) throw new Error('Missing target')
  target.id = 'assistant-1'
  Object.assign(harness.session, complete)
  const rows = new InMemorySessionRowStore()
  await rows.writeRows(contextSnapshot(complete))
  harness.sessions.getSessionContextSource = async (request) => {
    const source = await rows.readContext(request)
    return source ? contextSourceFromRows(source) : null
  }
  harness.sessions.readSessionMessages = async (request) => {
    const selected = await rows.readMessages(request)
    if (!selected) return null
    const { messages: _messages, threads: _threads, compactionPoints: _points, ...header } = complete
    return { header, revision: selected.revision, messages: selected.messages.map((row) => row.message) }
  }
  const getSession = vi.fn(() => Promise.resolve(harness.session))
  harness.sessions.getSession = getSession
  return { ...harness, getSession }
}

describe('generation context sources', () => {
  it.each([
    ['approve', 'token-cache'],
    ['retry', 'token-cache'],
    ['approve', 'approval-binding'],
    ['retry', 'approval-binding'],
  ] as const)('revalidates %s across a concurrent %s update', async (operation, change) => {
    const harness = createHarness()
    const execute = vi.fn(async () => ({ stdout: '/workspace' }))
    harness.setTools({ user_exec: { execute } } as unknown as ToolSet)
    harness.session.messages[1] = {
      ...targetMessage(),
      generating: false,
      finishReason: operation === 'approve' ? 'tool-call-paused' : undefined,
      error: operation === 'retry' ? 'provider disconnected' : undefined,
      contentParts: [
        {
          type: 'tool-call',
          toolCallId: 'tool-1',
          toolName: 'user_exec',
          state: operation === 'approve' ? 'paused' : 'call',
          args: { command: 'pwd' },
          pauseReason: { type: 'user_exec_approval', command: 'pwd', workdir: '/workspace' },
        },
      ],
    }
    const repo = new RowBackedSessionRepository({
      records: new InMemorySessionRecordStore(),
      rows: new InMemorySessionRowStore(),
    })
    await repo.setSession(harness.session)
    harness.sessions.getSessionContextSource = repo.getSessionContextSource.bind(repo)
    harness.sessions.readSessionMessages = repo.readSessionMessages.bind(repo)
    harness.sessions.getSession = repo.getSession.bind(repo)
    const saveTarget = async (message: Message) => {
      const current = await repo.getSession('session-1')
      if (!current) throw new Error('Missing session')
      await repo.setSession(
        { ...current, messages: current.messages.map((m) => (m.id === message.id ? message : m)) },
        { changedMessageId: message.id }
      )
    }
    const modify = harness.sessions.modifyMessage
    harness.sessions.modifyMessage = async (...args) => {
      await modify(...args)
      await saveTarget(args[1])
    }
    const persist = harness.sessions.persistStreamingMessage
    harness.sessions.persistStreamingMessage = async (...args) => {
      await persist(...args)
      await saveTarget(args[1])
    }
    let concurrentUpdateCommitted = false
    harness.sessions.getSessionSettings = async () => {
      if (!concurrentUpdateCommitted) {
        concurrentUpdateCommitted = true
        if (change === 'token-cache') {
          await repo.patchSessionMessageDerivedData('session-1', [
            {
              messageId: 'user-1',
              text: [
                {
                  tokenizerType: 'default',
                  sourceDigest: getSessionMessageTokenizationDigest(harness.session.messages[0]),
                  tokens: 42,
                  calculatedAt: 100,
                },
              ],
            },
          ])
        } else {
          const target = harness.session.messages[1]
          await saveTarget({
            ...target,
            contentParts: target.contentParts.map((part) =>
              part.type === 'tool-call'
                ? {
                    ...part,
                    args: { command: 'whoami' },
                    pauseReason: { type: 'user_exec_approval', command: 'whoami', workdir: '/workspace' },
                  }
                : part
            ),
          })
        }
      }
      return harness.sessionSettings
    }

    if (operation === 'approve') await harness.service.continuePausedToolCall('session-1', 'assistant-1', 'tool-1')
    else await harness.service.retryFromLastToolCallAfterApiError('session-1', 'assistant-1', 'tool-1')

    const saved = await repo.getSession('session-1')
    if (change === 'approval-binding') {
      expect(execute).not.toHaveBeenCalled()
      expect(harness.persisted).toHaveLength(0)
      expect(saved?.messages[1].contentParts).toEqual([expect.objectContaining({ args: { command: 'whoami' } })])
      return
    }
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(
      { command: 'pwd' },
      expect.objectContaining({ approved: true, approvalWorkdir: '/workspace', toolCallId: 'tool-1' })
    )
    expect(saved?.messages[0].tokenCountMap?.default).toBe(42)
    expect(saved?.messages[1].contentParts).toEqual([
      expect.objectContaining({ state: 'result', result: { stdout: '/workspace' } }),
    ])
  })

  it.each(['approve', 'retry'] as const)(
    'keeps %s for a removed target a no-op on compatibility hosts',
    async (operation) => {
      const harness = createHarness()
      if (operation === 'approve') await harness.service.continuePausedToolCall('session-1', 'removed-target', 'tool-1')
      else await harness.service.retryFromLastToolCallAfterApiError('session-1', 'removed-target', 'tool-1')
      expect(harness.persisted).toHaveLength(0)
    }
  )

  it.each(['present', 'read-failed'] as const)(
    'preserves the original context failure when target verification is %s',
    async (verification) => {
      const harness = createHarness()
      const contextError = new Error('Context storage failed')
      harness.sessions.getSessionContextSource = () => Promise.reject(contextError)
      if (verification === 'read-failed')
        harness.sessions.readSessionMessages = () => Promise.reject(new Error('ID storage failed'))
      await expect(harness.service.continuePausedToolCall('session-1', 'assistant-1', 'tool-1')).rejects.toBe(
        contextError
      )
      expect(harness.persisted).toHaveLength(0)
    }
  )

  it('prepares a bounded source and original history before initializing the target', async () => {
    const harness = await boundedHarness()
    const expectedHistory = contextPathFacts(harness.session.messages.slice(0, -1))
    const originalTarget = { ...harness.session.messages.at(-1), timestamp: 42 } as Message
    await harness.service.orchestrate('session-1', originalTarget)

    expect(harness.getSession).not.toHaveBeenCalled()
    expect(harness.preparedRequests[0].session).not.toHaveProperty('messages')
    expect(harness.preparedRequests[0].messages.map((message) => message.id)).toEqual([
      'system',
      'boundary',
      'summary',
      'question',
      'assistant-1',
    ])
    expect(harness.preparedRequests[0].history).toEqual(expectedHistory)
    expect(harness.preparedRequests[0].messages.at(-1)?.timestamp).toBeUndefined()
    expect(harness.persisted[0].message.timestamp).toBe(42)
  })

  it('includes the real append target in prompt facts', async () => {
    const harness = await boundedHarness()
    const expectedHistory = contextPathFacts(harness.session.messages)
    await harness.service.orchestrate('session-1', targetMessage(), { appendToMessage: true })

    expect(harness.getSession).not.toHaveBeenCalled()
    expect(harness.preparedRequests[0].targetMessageIndex).toBe(5)
    expect(harness.preparedRequests[0].history).toEqual(expectedHistory)
  })

  it.each(['assistant-1', 'new-target'])(
    'honors explicit context messages and their frozen scope for %s',
    async (targetId) => {
      const harness = await boundedHarness()
      const contextMessages: Message[] = [
        { id: 'override-user', role: 'user', timestamp: 99, contentParts: [] },
        { ...targetMessage(), id: targetId },
      ]
      await harness.service.orchestrate('session-1', { ...targetMessage(), id: targetId }, { contextMessages })

      expect(harness.getSession).not.toHaveBeenCalled()
      expect(harness.preparedRequests[0].messages).toBe(contextMessages)
      expect(harness.preparedRequests[0].history).toEqual(contextPathFacts(contextMessages.slice(0, 1)))
      expect(harness.steeringRegister.mock.calls[0][1]).toEqual(new Set(['override-user', targetId]))
    }
  )

  it.each([false, true])('loads target scope lazily and fails closed on tree change: %s', async (changed) => {
    const harness = await boundedHarness()
    await harness.service.orchestrate('session-1', targetMessage())
    const loader = harness.steeringRegister.mock.calls[0][1] as Parameters<GenerationSteeringPort['register']>[1]
    if (typeof loader !== 'function') throw new Error('Expected lazy scope')
    if (changed) harness.session.messages.splice(2, 1)
    const scope = await loader()

    expect(harness.getSession).toHaveBeenCalledTimes(1)
    if (changed) expect(scope).toBeNull()
    else expect(scope).toEqual(new Set(harness.session.messages.map((message) => message.id)))
  })

  it('preloads the original complete scope for a legacy source without a fingerprint', async () => {
    const harness = await boundedHarness()
    const read = harness.sessions.getSessionContextSource
    harness.sessions.getSessionContextSource = async (request) => {
      const source = await read?.(request)
      return source ? { ...source, topologyFingerprint: undefined } : null
    }
    const initialIds = harness.session.messages.map((message) => message.id)
    await harness.service.orchestrate('session-1', targetMessage())
    harness.session.messages.splice(2, 1)

    expect(harness.getSession).toHaveBeenCalledTimes(1)
    expect(harness.steeringRegister.mock.calls[0][1]).toEqual(new Set(initialIds))
  })
})

function lastPersisted(harness: Harness): Message {
  const entry = harness.persisted.at(-1)
  if (!entry) throw new Error('Expected a persisted message')
  return entry.message
}

const probeExecute = () => Promise.resolve('ok')

/**
 * Route one executable tool through preparation and report the `execute` the model
 * actually received: `probeExecute` itself when the step-limit pause left the tool
 * alone, a wrapper when the pause was installed.
 */
function captureToolsOnStream(harness: Harness): () => unknown {
  harness.setPreparedTools({
    probe: { description: 'probe', inputSchema: jsonSchema({ type: 'object' }), execute: probeExecute },
  } as unknown as ToolSet)
  let receivedExecute: unknown
  harness.setChatStreamFactory((_messages, options) =>
    (async function* captureStream() {
      await Promise.resolve()
      receivedExecute = (options.tools?.probe as { execute?: unknown } | undefined)?.execute
      yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
    })()
  )
  return () => receivedExecute
}

describe('GenerationService', () => {
  let harness: Harness

  beforeEach(() => {
    harness = createHarness()
  })

  it('passes the current SessionSettings to the host Web Search resolver', async () => {
    harness.sessionSettings.webBrowsing = true
    let receivedSettings: SessionSettings | undefined
    harness.setWebBrowsingResolver((_sessionId, _provider, settings) => {
      receivedSettings = settings
      return settings?.webBrowsing ?? false
    })

    await harness.service.orchestrate('session-1', targetMessage(), { operationType: 'send_message' })

    expect(receivedSettings).toBe(harness.sessionSettings)
    expect(harness.preparedWebBrowsing.at(-1)).toBe(true)
  })

  it('keeps the host result authoritative so the existing Web preference map remains compatible', async () => {
    harness.sessionSettings.webBrowsing = true
    harness.setWebBrowsingResolver(() => false)

    await harness.service.orchestrate('session-1', targetMessage(), { operationType: 'send_message' })

    expect(harness.preparedWebBrowsing.at(-1)).toBe(false)
  })

  it('replays the shared stream fixture and persists the current terminal projection', async () => {
    harness.setStreamFactory(() => stream(generationStreamFixture.chunks))

    await harness.service.orchestrate('session-1', targetMessage(), { operationType: 'send_message' })

    const finalMessage = lastPersisted(harness)
    const portableParts = finalMessage.contentParts.map((part) => {
      if (part.type !== 'tool-call') return part
      const { duration: _duration, startTime: _startTime, ...portablePart } = part
      return portablePart
    })
    expect(portableParts).toEqual(generationStreamFixture.expectedContentParts)
    expect(finalMessage).toMatchObject({
      generating: false,
      status: [],
      finishReason: generationStreamFixture.expectedFinishReason,
      usage: generationStreamFixture.expectedUsage,
    })
    expect(finalMessage.tokensUsed).toBeUndefined()
    expect(harness.persisted.filter(({ refreshCounting }) => refreshCounting)).toHaveLength(1)
    expect(harness.runtime.get('session-1')).toBeUndefined()
    expect(harness.afterMessageGenerated).toHaveBeenCalledWith('session-1', finalMessage)
  })

  it('anchors steering at the continued assistant message when it already has output', async () => {
    const continuedMessage: Message = {
      ...targetMessage(),
      contentParts: [
        { type: 'text', text: 'first step' },
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'tool-1',
          toolName: 'search',
          stepIndex: 2,
        },
      ],
    }

    await harness.service.orchestrate('session-1', continuedMessage, {
      operationType: 'regenerate',
      appendToMessage: true,
    })

    expect(harness.steeringInject).toHaveBeenCalledWith(expect.any(Array), 'assistant-1')
  })

  it('includes prior segments and steered users when continuing a continuation message', async () => {
    const finalizedSegment: Message = {
      ...targetMessage(),
      generating: false,
      finishReason: 'steered',
      contentParts: [{ type: 'text', text: 'before steer' }],
    }
    const steeredMessage: Message = {
      id: 'steered-user',
      role: 'user',
      steered: true,
      contentParts: [{ type: 'text', text: 'change direction' }],
    }
    const continuation: Message = {
      ...targetMessage(),
      id: 'assistant-2',
      contentParts: [{ type: 'text', text: 'after steer' }],
    }
    harness.session.messages = [harness.session.messages[0], finalizedSegment, steeredMessage, continuation]

    await harness.service.orchestrate('session-1', continuation, {
      operationType: 'regenerate',
      appendToMessage: true,
    })

    // The resumed context slices at the continuation and therefore keeps the
    // finalized segment and the steered user as ordinary history messages.
    expect(harness.preparedTargetMessageIndexes.at(-1)).toBe(4)
  })

  it('finalizes the interrupted segment and continues the run in a new message after a steer', async () => {
    const steeredUser: Message = {
      id: 'steered-user',
      role: 'user',
      steered: true,
      contentParts: [{ type: 'text', text: 'change direction' }],
    }
    harness.steeringInject
      .mockResolvedValueOnce({ messages: undefined, consumed: [] })
      .mockImplementationOnce((messages: ModelMessage[], anchorMessageId: string) => {
        // Emulate the renderer consumer persisting the steered user after the anchor.
        const anchorIndex = harness.session.messages.findIndex((candidate) => candidate.id === anchorMessageId)
        harness.session.messages.splice(anchorIndex + 1, 0, steeredUser)
        return Promise.resolve({
          messages: [...messages, { role: 'user', content: [{ type: 'text', text: 'change direction' }] }],
          consumed: [steeredUser],
        })
      })
    harness.setChatStreamFactory((_messages, options) =>
      (async function* twoStepStream() {
        harness.setNow(1_500)
        yield { type: 'text-delta', text: 'step one output' } as ModelStreamPart<ToolSet>
        yield { type: 'finish-step' } as ModelStreamPart<ToolSet>
        harness.setNow(2_000)
        await options.prepareStep?.({
          steps: [],
          stepNumber: 1,
          model: {},
          messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        harness.setNow(2_250)
        yield { type: 'text-delta', text: 'step two output' } as ModelStreamPart<ToolSet>
        harness.setNow(2_600)
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate(
      'session-1',
      { ...targetMessage(), isStreamingMode: true, aiProvider: 'claude', modelId: 'claude-sonnet-5' },
      { operationType: 'send_message' }
    )

    // The steer arrived at the second boundary: it anchors after the segment output.
    expect(harness.steeringInject).toHaveBeenLastCalledWith(expect.any(Array), 'assistant-1')

    // The interrupted segment is finalized in place with a steering finish.
    const finalizedSegment = harness.persisted.find(
      ({ message }) => message.id === 'assistant-1' && message.finishReason === 'steered'
    )?.message
    expect(finalizedSegment).toMatchObject({
      generating: false,
      status: [],
      firstTokenLatency: 500,
      generationDuration: 1_000,
    })
    expect(finalizedSegment?.contentParts).toEqual([{ type: 'text', text: 'step one output', stepIndex: 0 }])

    // The continuation is a fresh message inserted after the steered user.
    expect(harness.inserted).toHaveLength(1)
    const continuation = harness.inserted[0]
    expect(continuation.afterMessageId).toBe('steered-user')
    expect(continuation.message.role).toBe('assistant')
    expect(continuation.message.id).not.toBe('assistant-1')
    expect(continuation.message.isStreamingMode).toBe(true)
    // Raw model identity travels with the continuation so a later model switch
    // is detectable by the reasoning replay provenance check.
    expect(continuation.message.aiProvider).toBe('claude')
    expect(continuation.message.modelId).toBe('claude-sonnet-5')
    expect(harness.steeringAdmitAnchor).toHaveBeenCalledWith(continuation.message.id)

    // The rest of the run streams into the continuation and finishes there.
    const finalMessage = lastPersisted(harness)
    expect(finalMessage.id).toBe(continuation.message.id)
    expect(finalMessage).toMatchObject({
      generating: false,
      finishReason: 'stop',
      firstTokenLatency: 600,
      generationDuration: 600,
    })
    expect(finalMessage.contentParts).toEqual([{ type: 'text', text: 'step two output', stepIndex: 0 }])

    // Durable storage keeps true causal order with no read-time reordering.
    expect(harness.session.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'steered-user',
      continuation.message.id,
    ])
    expect(harness.afterMessageGenerated).toHaveBeenCalledWith('session-1', finalMessage)
    expect(harness.runtime.get('session-1')).toBeUndefined()
  })

  it('abandons the split and keeps streaming in place when the continuation cannot be inserted', async () => {
    const steeredUser: Message = {
      id: 'steered-user',
      role: 'user',
      steered: true,
      contentParts: [{ type: 'text', text: 'change direction' }],
    }
    harness.steeringInject
      .mockResolvedValueOnce({ messages: undefined, consumed: [] })
      .mockImplementationOnce((messages: ModelMessage[], anchorMessageId: string) => {
        const anchorIndex = harness.session.messages.findIndex((candidate) => candidate.id === anchorMessageId)
        harness.session.messages.splice(anchorIndex + 1, 0, steeredUser)
        return Promise.resolve({
          messages: [...messages, { role: 'user', content: [{ type: 'text', text: 'change direction' }] }],
          consumed: [steeredUser],
        })
      })
    harness.failInsertion(new Error('continuation insert failed'))
    harness.setChatStreamFactory((_messages, options) =>
      (async function* twoStepStream() {
        yield { type: 'text-delta', text: 'step one output' } as ModelStreamPart<ToolSet>
        yield { type: 'finish-step' } as ModelStreamPart<ToolSet>
        await options.prepareStep?.({
          steps: [],
          stepNumber: 1,
          model: {},
          messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        yield { type: 'text-delta', text: ' step two output' } as ModelStreamPart<ToolSet>
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    // No half-applied split: the segment is never finalized as 'steered', the
    // run completes normally in place, and the transcript degrades to the legacy
    // shape (steered user trailing its assistant) that the read-time shim covers.
    expect(harness.inserted).toHaveLength(0)
    expect(harness.session.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'steered-user'])
    expect(harness.persisted.some(({ message }) => message.finishReason === 'steered')).toBe(false)
    const finalMessage = lastPersisted(harness)
    expect(finalMessage).toMatchObject({ id: 'assistant-1', generating: false, finishReason: 'stop' })
    expect(finalMessage.error).toBeUndefined()
    expect(finalMessage.contentParts).toEqual([
      { type: 'text', text: 'step one output', stepIndex: 0 },
      { type: 'text', text: ' step two output', stepIndex: 1 },
    ])
    expect(harness.steeringAdmitAnchor).not.toHaveBeenCalled()
    expect(harness.runtime.get('session-1')).toBeUndefined()
  })

  it('anchors a later steer after the previous one when a split was abandoned', async () => {
    const firstSteer: Message = {
      id: 'steer-1',
      role: 'user',
      steered: true,
      contentParts: [{ type: 'text', text: 'first steer' }],
    }
    const secondSteer: Message = {
      id: 'steer-2',
      role: 'user',
      steered: true,
      contentParts: [{ type: 'text', text: 'second steer' }],
    }
    const persistSteer = (steer: Message, anchorMessageId: string) => {
      const anchorIndex = harness.session.messages.findIndex((candidate) => candidate.id === anchorMessageId)
      harness.session.messages.splice(anchorIndex + 1, 0, steer)
    }
    harness.steeringInject
      .mockResolvedValueOnce({ messages: undefined, consumed: [] })
      .mockImplementationOnce((messages: ModelMessage[], anchorMessageId: string) => {
        persistSteer(firstSteer, anchorMessageId)
        return Promise.resolve({ messages, consumed: [firstSteer] })
      })
      .mockImplementationOnce((messages: ModelMessage[], anchorMessageId: string) => {
        persistSteer(secondSteer, anchorMessageId)
        return Promise.resolve({ messages, consumed: [secondSteer] })
      })
    harness.failInsertion(new Error('continuation insert failed'))
    harness.setChatStreamFactory((_messages, options) =>
      (async function* threeStepStream() {
        const boundary = (stepNumber: number) =>
          options.prepareStep?.({
            steps: [],
            stepNumber,
            model: {},
            messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
            experimental_context: undefined,
          } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        yield { type: 'text-delta', text: 'step one' } as ModelStreamPart<ToolSet>
        yield { type: 'finish-step' } as ModelStreamPart<ToolSet>
        await boundary(1)
        yield { type: 'text-delta', text: ' step two' } as ModelStreamPart<ToolSet>
        yield { type: 'finish-step' } as ModelStreamPart<ToolSet>
        await boundary(2)
        yield { type: 'text-delta', text: ' step three' } as ModelStreamPart<ToolSet>
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    // The second steer must not anchor back at the assistant both interrupted:
    // it lands after the first stored steer, keeping the steers' arrival order.
    expect(harness.steeringInject).toHaveBeenNthCalledWith(2, expect.any(Array), 'assistant-1')
    expect(harness.steeringInject).toHaveBeenNthCalledWith(3, expect.any(Array), 'steer-1')
    expect(harness.session.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'steer-1',
      'steer-2',
    ])
    expect(lastPersisted(harness)).toMatchObject({ id: 'assistant-1', finishReason: 'stop' })
  })

  it('adopts a confirmed atomic split when its metadata projection rejects', async () => {
    const steeredUser: Message = {
      id: 'steered-user',
      role: 'user',
      steered: true,
      contentParts: [{ type: 'text', text: 'change direction' }],
    }
    harness.steeringInject
      .mockResolvedValueOnce({ messages: undefined, consumed: [] })
      .mockImplementationOnce((messages: ModelMessage[], anchorMessageId: string) => {
        const anchorIndex = harness.session.messages.findIndex((candidate) => candidate.id === anchorMessageId)
        harness.session.messages.splice(anchorIndex + 1, 0, steeredUser)
        return Promise.resolve({
          messages: [...messages, { role: 'user', content: [{ type: 'text', text: 'change direction' }] }],
          consumed: [steeredUser],
        })
      })
    // A session whose messages persisted can still reject on its list-metadata
    // write; treating that as "not inserted" would strand a durable orphan.
    harness.failInsertion(new Error('session metadata update failed'), { commit: true })
    harness.setChatStreamFactory((_messages, options) =>
      (async function* twoStepStream() {
        yield { type: 'text-delta', text: 'step one output' } as ModelStreamPart<ToolSet>
        yield { type: 'finish-step' } as ModelStreamPart<ToolSet>
        await options.prepareStep?.({
          steps: [],
          stepNumber: 1,
          model: {},
          messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        yield { type: 'text-delta', text: 'step two output' } as ModelStreamPart<ToolSet>
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    const continuation = harness.inserted[0]
    expect(continuation.afterMessageId).toBe('steered-user')
    expect(harness.session.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'steered-user',
      continuation.message.id,
    ])
    const finalMessage = lastPersisted(harness)
    expect(finalMessage).toMatchObject({ id: continuation.message.id, generating: false, finishReason: 'stop' })
    expect(finalMessage.contentParts).toEqual([{ type: 'text', text: 'step two output', stepIndex: 0 }])
  })

  it('leaves Stop in control of its message instead of splitting mid-stop', async () => {
    const steeredUser: Message = {
      id: 'steered-user',
      role: 'user',
      steered: true,
      contentParts: [{ type: 'text', text: 'change direction' }],
    }
    harness.steeringInject
      .mockResolvedValueOnce({ messages: undefined, consumed: [] })
      .mockImplementationOnce((messages: ModelMessage[], anchorMessageId: string) => {
        const anchorIndex = harness.session.messages.findIndex((candidate) => candidate.id === anchorMessageId)
        harness.session.messages.splice(anchorIndex + 1, 0, steeredUser)
        return Promise.resolve({
          messages: [...messages, { role: 'user', content: [{ type: 'text', text: 'change direction' }] }],
          consumed: [steeredUser],
        })
      })
    harness.setChatStreamFactory((_messages, options) =>
      (async function* twoStepStream() {
        yield { type: 'text-delta', text: 'step one output' } as ModelStreamPart<ToolSet>
        yield { type: 'finish-step' } as ModelStreamPart<ToolSet>
        // Stop lands before the boundary: it owns cleanup of 'assistant-1' and
        // must not have the runtime moved out from under it.
        harness.runtime.beginStop('session-1', 'assistant-1', 42)
        await options.prepareStep?.({
          steps: [],
          stepNumber: 1,
          model: {},
          messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(harness.inserted).toHaveLength(0)
    expect(harness.steeringAdmitAnchor).not.toHaveBeenCalled()
    // The stopping runtime stays on its original id for stopMessageGeneration to clear.
    expect(harness.runtime.get('session-1', 'assistant-1')?.phase).toBe('stopping')
  })

  it('persists a pre-output steer before the segment without splitting', async () => {
    const steeredUser: Message = {
      id: 'steered-user',
      role: 'user',
      steered: true,
      contentParts: [{ type: 'text', text: 'also do X' }],
    }
    harness.steeringInject.mockImplementationOnce((messages: ModelMessage[], _anchorMessageId: string) =>
      Promise.resolve({
        messages: [...messages, { role: 'user', content: [{ type: 'text', text: 'also do X' }] }],
        consumed: [steeredUser],
      })
    )

    await harness.service.orchestrate('session-1', targetMessage())

    // No output yet: the steered user anchors before the segment, which keeps
    // generating in place — no finalization, no continuation message.
    expect(harness.steeringInject).toHaveBeenCalledWith(expect.any(Array), 'user-1')
    expect(harness.inserted).toHaveLength(0)
    const finalMessage = lastPersisted(harness)
    expect(finalMessage.id).toBe('assistant-1')
    expect(finalMessage.finishReason).not.toBe('steered')
  })

  it('consumes a stop requested before runtime registration without starting the provider stream', async () => {
    harness.runtime.requestAbort('session-1', 'assistant-1', 900)
    harness.setChatStreamFactory(() => {
      throw new Error('provider stream must not start')
    })

    await harness.service.orchestrate('session-1', targetMessage(), { operationType: 'send_message' })

    expect(lastPersisted(harness)).toMatchObject({
      id: 'assistant-1',
      generating: false,
      finishReason: 'canceled',
    })
    expect(harness.runtime.get('session-1')).toBeUndefined()
  })

  it('registers preparing runtime before the first setup await and stops without starting the provider stream', async () => {
    harness.setChatStreamFactory(() => {
      throw new Error('provider stream must not start')
    })

    const generation = harness.service.orchestrate('session-1', targetMessage(), { operationType: 'send_message' })

    expect(harness.runtime.get('session-1', 'assistant-1')?.phase).toBe('preparing')
    harness.runtime.requestAbort('session-1', 'assistant-1', 900)
    await generation

    expect(lastPersisted(harness)).toMatchObject({
      id: 'assistant-1',
      generating: false,
      finishReason: 'canceled',
    })
    expect(harness.afterMessageGenerated).not.toHaveBeenCalled()
    expect(harness.afterMessageFailed).not.toHaveBeenCalled()
    expect(harness.runtime.get('session-1')).toBeUndefined()
  })

  it('does not publish a generating checkpoint when Stop lands during async chunk processing', async () => {
    let releaseBlob!: () => void
    let chunkProcessingStarted!: () => void
    const blobGate = new Promise<void>((resolve) => {
      releaseBlob = resolve
    })
    const processingStarted = new Promise<void>((resolve) => {
      chunkProcessingStarted = resolve
    })
    harness.storeBlob.mockImplementationOnce(async () => {
      chunkProcessingStarted()
      await blobGate
    })
    harness.setStreamFactory(() =>
      stream([
        { type: 'file', file: { mediaType: 'image/png', base64: 'encoded-image' } },
        { type: 'finish', finishReason: 'stop' },
      ] as ModelStreamPart<ToolSet>[])
    )

    const generation = harness.service.orchestrate('session-1', targetMessage())
    await processingStarted
    const persistedBeforeStop = harness.persisted.length
    const activeRuntime = harness.runtime.get('session-1', 'assistant-1')
    expect(activeRuntime).toBeDefined()
    harness.runtime.beginStop('session-1', 'assistant-1', 900, activeRuntime)
    releaseBlob()
    await generation

    expect(harness.cached).toEqual([])
    expect(harness.persisted.slice(persistedBeforeStop).every((entry) => entry.message.generating === false)).toBe(true)
    expect(lastPersisted(harness)).toMatchObject({ generating: false, finishReason: 'canceled' })
  })

  it('wires steering into prepareStep and releases it when generation settles', async () => {
    const basePrepareStep = vi.fn(() => Promise.resolve({ activeTools: ['tool_a'] }))
    harness.setPrepareStep(basePrepareStep)
    harness.steeringInject
      .mockResolvedValueOnce({ messages: undefined, consumed: [] })
      .mockResolvedValueOnce({ messages: [{ role: 'user', content: 'steered' }], consumed: [] })

    const stepResults: unknown[] = []
    harness.setChatStreamFactory((_messages, options) =>
      (async function* streamWithSteering() {
        const prepareStep = options.prepareStep
        if (!prepareStep) throw new Error('Expected prepareStep to be wired')
        const prepareOptions = {
          steps: [],
          stepNumber: 0,
          model: {},
          messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0]
        stepResults.push(await prepareStep(prepareOptions))
        stepResults.push(await prepareStep({ ...prepareOptions, stepNumber: 1 }))
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    // The conversation gate covers every message of this generation's own
    // conversation; mid-run continuations are admitted separately.
    expect(harness.steeringRegister).toHaveBeenCalledWith('session-1', new Set(['user-1', 'assistant-1']))
    expect(stepResults).toEqual([
      { activeTools: ['tool_a'], messages: [{ role: 'user', content: 'Hello' }] },
      { activeTools: ['tool_a'], messages: [{ role: 'user', content: 'steered' }] },
    ])
    // No segment output was streamed before either boundary, so both anchor at
    // the target's predecessor.
    expect(harness.steeringInject.mock.calls.map(([, anchorMessageId]) => anchorMessageId)).toEqual([
      'user-1',
      'user-1',
    ])
    expect(harness.persisted.every(({ message }) => message.id === 'assistant-1')).toBe(true)
    expect(harness.steeringRelease).toHaveBeenCalledOnce()
    expect(harness.steeringWake).toHaveBeenCalledWith('session-1')
  })

  it('applies steering after an inner prepareStep message rewrite', async () => {
    const rewrittenMessages = [{ role: 'user', content: 'with injected image' }] as ModelMessage[]
    harness.setPrepareStep(() => Promise.resolve({ activeTools: ['tool_a'], messages: rewrittenMessages }))
    harness.steeringInject.mockImplementationOnce((messages: ModelMessage[], _anchorMessageId: string) =>
      Promise.resolve({ messages: [...messages, { role: 'user', content: 'steered' }], consumed: [] })
    )

    let stepResult: unknown
    harness.setChatStreamFactory((_messages, options) =>
      (async function* streamWithComposedPrepareStep() {
        const prepareStep = options.prepareStep
        if (!prepareStep) throw new Error('Expected prepareStep to be wired')
        stepResult = await prepareStep({
          steps: [],
          stepNumber: 0,
          model: {},
          messages: [{ role: 'user', content: 'original' }],
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(harness.steeringInject).toHaveBeenCalledWith(rewrittenMessages, 'user-1')
    expect(stepResult).toEqual({
      activeTools: ['tool_a'],
      messages: [
        { role: 'user', content: 'with injected image' },
        { role: 'user', content: 'steered' },
      ],
    })
  })

  it('compacts between tool steps when the payload exceeds the threshold', async () => {
    const compact = vi.fn<GenerationCompactionPort['compact']>().mockImplementation(async (_id, request) => ({
      status: 'compacted',
      summaryMessageId: 'summary',
      summary: 'Earlier work done.',
      coverage: { ...request, boundaryMessageId: 'assistant-1' },
    }))
    harness.setCompaction({
      getThresholdTokens: () => 50,
      compact,
    })
    harness.setPreparedTools({
      search: { description: 'search', inputSchema: jsonSchema({ type: 'object' }) },
    } as unknown as ToolSet)

    const bulky: ModelMessage[] = [
      { role: 'user', content: 'task '.repeat(80) },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'search', input: { q: 1 } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'search',
            output: { type: 'text', value: 'old '.repeat(80) },
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't2', toolName: 'search', input: { q: 2 } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't2',
            toolName: 'search',
            output: { type: 'text', value: 'recent' },
          },
        ],
      },
    ]

    let stepResult: unknown
    harness.setChatStreamFactory((_messages, options) =>
      (async function* streamWithMidRunCompact() {
        const prepareStep = options.prepareStep
        if (!prepareStep) throw new Error('Expected prepareStep to be wired')
        yield {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'search',
          input: { q: 1 },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'search',
          output: { type: 'text', value: 'old' },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-call',
          toolCallId: 't2',
          toolName: 'search',
          input: { q: 2 },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-result',
          toolCallId: 't2',
          toolName: 'search',
          output: { type: 'text', value: 'recent' },
        } as ModelStreamPart<ToolSet>
        stepResult = await prepareStep({
          steps: [],
          stepNumber: 1,
          model: {},
          messages: bulky,
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(compact).toHaveBeenCalledWith(
      'session-1',
      {
        kind: 'generation',
        targetMessageId: harness.inserted[0].message.id,
        retainedToolCallId: 't2',
      },
      expect.any(AbortSignal)
    )
    expect(harness.inserted).toHaveLength(1)
    expect(
      harness.persisted.some(
        (entry) => entry.message.id === 'assistant-1' && entry.message.finishReason === 'compacted'
      )
    ).toBe(true)
    expect(stepResult).toEqual({
      messages: [{ role: 'assistant', content: 'Earlier work done.' }, bulky[3], bulky[4]],
    })
  })

  it.each(['before-summary', 'during-summary', 'delayed-checkpoint'])(
    'compacts the generating branch after switching selection %s',
    async (switchAt) => {
      const aHistory: Message = {
        id: 'a-history',
        role: 'user',
        contentParts: [{ type: 'text', text: 'A history '.repeat(100) }],
      }
      const bHistory: Message = {
        id: 'b-history',
        role: 'user',
        contentParts: [{ type: 'text', text: 'B private history' }],
      }
      harness.session.messages.splice(1, 0, aHistory)
      harness.session.settings = harness.sessionSettings
      let releaseCheckpoints!: () => void
      const checkpointsReady = new Promise<void>((resolve) => {
        releaseCheckpoints = resolve
      })
      if (switchAt === 'delayed-checkpoint') {
        const persist = harness.sessions.persistStreamingMessage
        harness.sessions.persistStreamingMessage = async (...args) => {
          if (args[2]?.checkpoint) await checkpointsReady
          return persist(...args)
        }
      }
      const switchToB = () => {
        const aTail = harness.session.messages.slice(1)
        harness.session.messages = [harness.session.messages[0], bHistory]
        harness.session.messageForksHash = {
          'user-1': {
            createdAt: 1,
            position: 1,
            lists: [
              { id: 'branch-a', messages: aTail },
              { id: 'branch-b', messages: [] },
            ],
          },
        }
      }
      const generate = vi.fn(async ({ messages }: { messages: Message[] }) => {
        expect(JSON.stringify(messages)).toContain('A history')
        expect(JSON.stringify(messages)).not.toContain('B private history')
        if (switchAt !== 'before-summary') switchToB()
        return { success: true, summary: 'A summary' }
      })
      const service = new CompactionService({
        sessions: {
          getSession: async () => harness.session,
          getSessionSettings: async () => harness.sessionSettings,
          updateSessionWithMessages: async (_id, updater) => {
            Object.assign(harness.session, updater(harness.session))
            return harness.session
          },
        },
        settings: { getSettings: () => harness.globalSettings },
        policy: {
          shouldCompact: async () => true,
          getCompactionContext: (session, settings, pending) =>
            selectTokenEstimationContext(session, settings.maxContextMessageCount, pending),
        },
        summaries: { generate },
        createId: () => 'a-summary',
      })
      harness.setCompaction({
        getThresholdTokens: () => 200,
        compact: (id, request, abortSignal) => service.run(id, request, { abortSignal }),
      })
      harness.setPreparedTools({ search: { inputSchema: jsonSchema({ type: 'object' }) } } as unknown as ToolSet)
      const payload: ModelMessage[] = [
        { role: 'user', content: 'A history '.repeat(100) },
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a-tool', toolName: 'search', input: {} }] },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'a-tool',
              toolName: 'search',
              output: { type: 'text', value: 'recent' },
            },
          ],
        },
      ]
      let nextStep: unknown
      harness.setChatStreamFactory((_messages, options) =>
        (async function* () {
          yield { type: 'tool-call', toolCallId: 'a-tool', toolName: 'search', input: {} } as ModelStreamPart<ToolSet>
          yield {
            type: 'tool-result',
            toolCallId: 'a-tool',
            toolName: 'search',
            output: { type: 'text', value: 'recent' },
          } as ModelStreamPart<ToolSet>
          if (switchAt === 'before-summary') switchToB()
          const pendingStep = options.prepareStep?.({
            steps: [],
            stepNumber: 1,
            model: {},
            messages: payload,
            experimental_context: undefined,
          } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
          if (switchAt === 'delayed-checkpoint') {
            await new Promise<void>((resolve) => setTimeout(resolve, 10))
            expect(generate).not.toHaveBeenCalled()
            releaseCheckpoints()
          }
          nextStep = await pendingStep
          yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
        })()
      )
      await harness.service.orchestrate('session-1', targetMessage())
      expect(generate).toHaveBeenCalledOnce()
      expect(harness.inserted).toHaveLength(0)
      expect(nextStep).toEqual({ messages: [{ role: 'assistant', content: 'A summary' }, ...payload.slice(1)] })
      expect(harness.session.messages.map((message) => message.id)).toEqual(['user-1', 'b-history'])
      expect(harness.session.messageForksHash?.['user-1'].lists[0].messages.map((message) => message.id)).toEqual([
        'a-history',
        'a-summary',
        'assistant-1',
      ])
      expect(harness.session.compactionPoints).toEqual([expect.objectContaining({ boundaryMessageId: 'a-history' })])
    }
  )

  it('compacts through the steered user when the continuation keeps all its tool calls', async () => {
    harness.session.settings = harness.sessionSettings
    const steeredUser: Message = {
      id: 'steered-user',
      role: 'user',
      steered: true,
      contentParts: [{ type: 'text', text: 'change direction' }],
    }
    harness.steeringInject
      .mockResolvedValueOnce({ messages: undefined, consumed: [] })
      .mockImplementationOnce((messages, anchorId) => {
        const anchorIndex = harness.session.messages.findIndex((message) => message.id === anchorId)
        harness.session.messages.splice(anchorIndex + 1, 0, steeredUser)
        return Promise.resolve({
          messages: [...messages, { role: 'user' as const, content: 'change direction' }],
          consumed: [steeredUser],
        })
      })
    const generate = vi.fn(async ({ messages }: { messages: Message[] }) => {
      expect(messages.at(-1)?.id).toBe('steered-user')
      return { success: true, summary: 'Work and updated direction' }
    })
    const service = new CompactionService({
      sessions: {
        getSession: async () => harness.session,
        getSessionSettings: async () => harness.sessionSettings,
        updateSessionWithMessages: async (_id, updater) => {
          Object.assign(harness.session, updater(harness.session))
          return harness.session
        },
      },
      settings: { getSettings: () => harness.globalSettings },
      policy: {
        shouldCompact: async () => true,
        getCompactionContext: (session, settings, pending) =>
          selectTokenEstimationContext(session, settings.maxContextMessageCount, pending),
      },
      summaries: { generate },
      createId: () => 'steer-summary',
    })
    harness.setCompaction({
      getThresholdTokens: () => 200,
      compact: (id, request, abortSignal) => service.run(id, request, { abortSignal }),
    })
    harness.setPreparedTools({ search: { inputSchema: jsonSchema({ type: 'object' }) } } as unknown as ToolSet)
    const history: ModelMessage[] = [
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'previous work '.repeat(100) },
    ]
    const tail: ModelMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'current-tool', toolName: 'search', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'current-tool',
            toolName: 'search',
            output: { type: 'text', value: 'recent' },
          },
        ],
      },
    ]
    let nextStep: unknown
    harness.setChatStreamFactory((_messages, options) =>
      (async function* () {
        yield { type: 'text-delta', text: 'previous work '.repeat(100) } as ModelStreamPart<ToolSet>
        yield { type: 'finish-step' } as ModelStreamPart<ToolSet>
        await options.prepareStep?.({
          steps: [],
          stepNumber: 1,
          model: {},
          messages: history,
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        yield {
          type: 'tool-call',
          toolCallId: 'current-tool',
          toolName: 'search',
          input: {},
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-result',
          toolCallId: 'current-tool',
          toolName: 'search',
          output: { type: 'text', value: 'recent' },
        } as ModelStreamPart<ToolSet>
        yield { type: 'finish-step' } as ModelStreamPart<ToolSet>
        nextStep = await options.prepareStep?.({
          steps: [],
          stepNumber: 2,
          model: {},
          messages: [...history, { role: 'user', content: 'change direction' }, ...tail],
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )
    await harness.service.orchestrate('session-1', targetMessage())
    expect(generate).toHaveBeenCalledOnce()
    expect(harness.inserted).toHaveLength(1)
    expect(nextStep).toEqual({ messages: [{ role: 'assistant', content: 'Work and updated direction' }, ...tail] })
    expect(harness.session.compactionPoints).toEqual([expect.objectContaining({ boundaryMessageId: 'steered-user' })])
  })

  it('keeps the full payload when mid-run compaction throws', async () => {
    const compact = vi.fn().mockRejectedValue(new Error('compact failed'))
    harness.setCompaction({
      getThresholdTokens: () => 50,
      compact,
    })
    harness.setPreparedTools({
      search: { description: 'search', inputSchema: jsonSchema({ type: 'object' }) },
    } as unknown as ToolSet)

    const bulky: ModelMessage[] = [
      { role: 'user', content: 'task '.repeat(80) },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'search', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'search',
            output: { type: 'text', value: 'old '.repeat(80) },
          },
        ],
      },
    ]
    const stepResults: unknown[] = []
    harness.setChatStreamFactory((_messages, options) =>
      (async function* streamWithFailedCompact() {
        const prepareStep = options.prepareStep
        if (!prepareStep) throw new Error('Expected prepareStep to be wired')
        for (const toolCallId of ['t1']) {
          yield { type: 'tool-call', toolCallId, toolName: 'search', input: {} } as ModelStreamPart<ToolSet>
          yield {
            type: 'tool-result',
            toolCallId,
            toolName: 'search',
            output: { type: 'text', value: 'result' },
          } as ModelStreamPart<ToolSet>
        }
        const prepareOptions = {
          steps: [],
          stepNumber: 1,
          model: {},
          messages: bulky,
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0]
        stepResults.push(await prepareStep(prepareOptions))
        stepResults.push(await prepareStep({ ...prepareOptions, stepNumber: 2 }))
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(compact).toHaveBeenCalledOnce()
    expect(stepResults).toEqual([{ messages: bulky }, { messages: bulky }])
  })

  it('reuses a successful mid-run rewrite on later steps', async () => {
    const compact = vi.fn<GenerationCompactionPort['compact']>().mockImplementation(async (_id, request) => ({
      status: 'compacted',
      summaryMessageId: 'summary',
      summary: 'Earlier work done.',
      coverage: { ...request, boundaryMessageId: 'assistant-1' },
    }))
    harness.setCompaction({
      getThresholdTokens: () => 80,
      compact,
    })
    harness.setPreparedTools({
      search: { description: 'search', inputSchema: jsonSchema({ type: 'object' }) },
    } as unknown as ToolSet)

    const bulky: ModelMessage[] = [
      { role: 'user', content: 'task '.repeat(80) },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'search', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'search',
            output: { type: 'text', value: 'old '.repeat(80) },
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't2', toolName: 'search', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't2',
            toolName: 'search',
            output: { type: 'text', value: 'recent' },
          },
        ],
      },
    ]
    const stepResults: unknown[] = []
    harness.setChatStreamFactory((_messages, options) =>
      (async function* streamWithCachedRewrite() {
        const prepareStep = options.prepareStep
        if (!prepareStep) throw new Error('Expected prepareStep to be wired')
        for (const toolCallId of ['t1', 't2']) {
          yield { type: 'tool-call', toolCallId, toolName: 'search', input: {} } as ModelStreamPart<ToolSet>
          yield {
            type: 'tool-result',
            toolCallId,
            toolName: 'search',
            output: { type: 'text', value: 'result' },
          } as ModelStreamPart<ToolSet>
        }
        const prepareOptions = {
          steps: [],
          stepNumber: 1,
          model: {},
          messages: bulky,
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0]
        stepResults.push(await prepareStep(prepareOptions))
        stepResults.push(await prepareStep({ ...prepareOptions, stepNumber: 2 }))
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(compact).toHaveBeenCalledOnce()
    expect(stepResults).toEqual([
      { messages: [{ role: 'assistant', content: 'Earlier work done.' }, bulky[3], bulky[4]] },
      { messages: [{ role: 'assistant', content: 'Earlier work done.' }, bulky[3], bulky[4]] },
    ])
  })

  it('keeps the full payload when a generating split cannot be established', async () => {
    const compact = vi.fn<GenerationCompactionPort['compact']>().mockImplementation(async (_id, request) => ({
      status: 'compacted',
      summaryMessageId: 'summary',
      summary: 'Earlier work done.',
      coverage: { ...request, boundaryMessageId: 'assistant-1' },
    }))
    harness.setCompaction({
      getThresholdTokens: () => 50,
      compact,
    })
    harness.setPreparedTools({
      search: { description: 'search', inputSchema: jsonSchema({ type: 'object' }) },
    } as unknown as ToolSet)
    harness.failInsertion(new Error('continuation insert failed'))

    const bulky: ModelMessage[] = [
      { role: 'user', content: 'task '.repeat(80) },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'search', input: { q: 1 } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'search',
            output: { type: 'text', value: 'old '.repeat(80) },
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't2', toolName: 'search', input: { q: 2 } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't2',
            toolName: 'search',
            output: { type: 'text', value: 'recent' },
          },
        ],
      },
    ]

    let stepResult: unknown
    harness.setChatStreamFactory((_messages, options) =>
      (async function* streamWithFailedSplit() {
        const prepareStep = options.prepareStep
        if (!prepareStep) throw new Error('Expected prepareStep to be wired')
        yield {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'search',
          input: { q: 1 },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'search',
          output: { type: 'text', value: 'old' },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-call',
          toolCallId: 't2',
          toolName: 'search',
          input: { q: 2 },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-result',
          toolCallId: 't2',
          toolName: 'search',
          output: { type: 'text', value: 'recent' },
        } as ModelStreamPart<ToolSet>
        stepResult = await prepareStep({
          steps: [],
          stepNumber: 1,
          model: {},
          messages: bulky,
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(compact).not.toHaveBeenCalled()
    expect(stepResult).toEqual({ messages: bulky })
  })

  it('keeps the full payload when the summary receipt belongs to another retained round', async () => {
    const compact = vi.fn<GenerationCompactionPort['compact']>().mockImplementation(async (_id, request) => ({
      status: 'compacted',
      summaryMessageId: 'summary',
      summary: 'Older history only.',
      coverage: { ...request, retainedToolCallId: 'wrong-round', boundaryMessageId: 'user-1' },
    }))
    harness.setCompaction({
      getThresholdTokens: () => 50,
      compact,
    })
    harness.setPreparedTools({
      search: { description: 'search', inputSchema: jsonSchema({ type: 'object' }) },
    } as unknown as ToolSet)

    const bulky: ModelMessage[] = [
      { role: 'user', content: 'task '.repeat(80) },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'search', input: { q: 1 } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'search',
            output: { type: 'text', value: 'old '.repeat(80) },
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't2', toolName: 'search', input: { q: 2 } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't2',
            toolName: 'search',
            output: { type: 'text', value: 'recent' },
          },
        ],
      },
    ]

    let stepResult: unknown
    harness.setChatStreamFactory((_messages, options) =>
      (async function* streamWithUncoveredPrefix() {
        const prepareStep = options.prepareStep
        if (!prepareStep) throw new Error('Expected prepareStep to be wired')
        yield {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'search',
          input: { q: 1 },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'search',
          output: { type: 'text', value: 'old' },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-call',
          toolCallId: 't2',
          toolName: 'search',
          input: { q: 2 },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-result',
          toolCallId: 't2',
          toolName: 'search',
          output: { type: 'text', value: 'recent' },
        } as ModelStreamPart<ToolSet>
        stepResult = await prepareStep({
          steps: [],
          stepNumber: 1,
          model: {},
          messages: bulky,
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(compact).toHaveBeenCalledOnce()
    expect(stepResult).toEqual({ messages: bulky })
  })

  it('inserts the retained tail before shortening the compacted assistant', async () => {
    const compact = vi.fn<GenerationCompactionPort['compact']>((_id, request) => {
      const prefix = harness.session.messages.find((message) => message.id === 'assistant-1')
      const continuation = harness.session.messages.find(
        (message) => message.role === 'assistant' && message.id !== 'assistant-1'
      )
      expect(prefix?.contentParts.some((part) => part.type === 'tool-call' && part.toolCallId === 't2')).toBe(false)
      expect(continuation?.contentParts.some((part) => part.type === 'tool-call' && part.toolCallId === 't2')).toBe(
        true
      )
      return Promise.resolve({
        status: 'compacted',
        summaryMessageId: 'summary',
        summary: 'Earlier work done.',
        coverage: { ...request, boundaryMessageId: 'assistant-1' },
      })
    })
    harness.setCompaction({
      getThresholdTokens: () => 50,
      compact,
    })
    harness.setPreparedTools({
      search: { description: 'search', inputSchema: jsonSchema({ type: 'object' }) },
    } as unknown as ToolSet)

    const bulky: ModelMessage[] = [
      { role: 'user', content: 'task '.repeat(80) },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'search', input: { q: 1 } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'search',
            output: { type: 'text', value: 'old '.repeat(80) },
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't2', toolName: 'search', input: { q: 2 } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't2',
            toolName: 'search',
            output: { type: 'text', value: 'recent' },
          },
        ],
      },
    ]

    harness.setChatStreamFactory((_messages, options) =>
      (async function* streamWithPersistedTail() {
        const prepareStep = options.prepareStep
        if (!prepareStep) throw new Error('Expected prepareStep to be wired')
        yield {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'search',
          input: { q: 1 },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'search',
          output: { type: 'text', value: 'old' },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-call',
          toolCallId: 't2',
          toolName: 'search',
          input: { q: 2 },
        } as ModelStreamPart<ToolSet>
        yield {
          type: 'tool-result',
          toolCallId: 't2',
          toolName: 'search',
          output: { type: 'text', value: 'recent' },
        } as ModelStreamPart<ToolSet>
        await prepareStep({
          steps: [],
          stepNumber: 1,
          model: {},
          messages: bulky,
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0])
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(compact).toHaveBeenCalledOnce()
    expect(
      harness.inserted[0]?.message.contentParts.some((part) => part.type === 'tool-call' && part.toolCallId === 't2')
    ).toBe(true)
  })

  it('reuses a mid-run rewrite after an earlier image follow-up is dropped', async () => {
    const compact = vi.fn<GenerationCompactionPort['compact']>().mockImplementation(async (_id, request) => ({
      status: 'compacted',
      summaryMessageId: 'summary',
      summary: 'Earlier work done.',
      coverage: { ...request, boundaryMessageId: 'assistant-1' },
    }))
    harness.setCompaction({
      getThresholdTokens: () => 80,
      compact,
    })
    harness.setPreparedTools({
      search: { description: 'search', inputSchema: jsonSchema({ type: 'object' }) },
    } as unknown as ToolSet)

    const imageFollowUp = (name: string): ModelMessage => ({
      role: 'user',
      content: [
        { type: 'text', text: `[Image from view_image tool: ${name}]` },
        { type: 'image', image: name, mediaType: 'image/png' },
      ],
    })
    const t2Assistant: ModelMessage = {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 't2', toolName: 'search', input: {} }],
    }
    const t2Result: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't2',
          toolName: 'search',
          output: { type: 'text', value: 'recent' },
        },
      ],
    }
    const firstStep: ModelMessage[] = [
      { role: 'user', content: 'task '.repeat(80) },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'search', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'search',
            output: { type: 'text', value: 'old '.repeat(80) },
          },
        ],
      },
      imageFollowUp('a.png'),
      t2Assistant,
      t2Result,
    ]
    const secondStep = firstStep.filter((_, index) => index !== 3)

    const stepResults: unknown[] = []
    harness.setChatStreamFactory((_messages, options) =>
      (async function* streamWithImageWindowShift() {
        const prepareStep = options.prepareStep
        if (!prepareStep) throw new Error('Expected prepareStep to be wired')
        for (const toolCallId of ['t1', 't2']) {
          yield { type: 'tool-call', toolCallId, toolName: 'search', input: {} } as ModelStreamPart<ToolSet>
          yield {
            type: 'tool-result',
            toolCallId,
            toolName: 'search',
            output: { type: 'text', value: 'result' },
          } as ModelStreamPart<ToolSet>
        }
        const prepareOptions = {
          steps: [],
          stepNumber: 1,
          model: {},
          messages: firstStep,
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0]
        stepResults.push(await prepareStep(prepareOptions))
        stepResults.push(await prepareStep({ ...prepareOptions, stepNumber: 2, messages: secondStep }))
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(compact).toHaveBeenCalledOnce()
    expect(stepResults).toEqual([
      { messages: [{ role: 'assistant', content: 'Earlier work done.' }, t2Assistant, t2Result] },
      { messages: [{ role: 'assistant', content: 'Earlier work done.' }, t2Assistant, t2Result] },
    ])
  })

  it('does not retry mid-run compaction after a non-throwing failure', async () => {
    const compact = vi
      .fn<GenerationCompactionPort['compact']>()
      .mockResolvedValue({ status: 'failed', failure: { code: 'summary_failed', message: 'summary failed' } })
    harness.setCompaction({
      getThresholdTokens: () => 50,
      compact,
    })
    harness.setPreparedTools({
      search: { description: 'search', inputSchema: jsonSchema({ type: 'object' }) },
    } as unknown as ToolSet)

    const bulky: ModelMessage[] = [
      { role: 'user', content: 'task '.repeat(80) },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'search', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'search',
            output: { type: 'text', value: 'old '.repeat(80) },
          },
        ],
      },
    ]
    harness.setChatStreamFactory((_messages, options) =>
      (async function* streamWithNoOpCompact() {
        const prepareStep = options.prepareStep
        if (!prepareStep) throw new Error('Expected prepareStep to be wired')
        for (const toolCallId of ['t1']) {
          yield { type: 'tool-call', toolCallId, toolName: 'search', input: {} } as ModelStreamPart<ToolSet>
          yield {
            type: 'tool-result',
            toolCallId,
            toolName: 'search',
            output: { type: 'text', value: 'result' },
          } as ModelStreamPart<ToolSet>
        }
        const prepareOptions = {
          steps: [],
          stepNumber: 1,
          model: {},
          messages: bulky,
          experimental_context: undefined,
        } as unknown as Parameters<NonNullable<ChatStreamOptions['prepareStep']>>[0]
        await prepareStep(prepareOptions)
        await prepareStep({ ...prepareOptions, stepNumber: 2 })
        yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(compact).toHaveBeenCalledOnce()
  })

  it('persists a tool-call checkpoint immediately instead of waiting for the periodic interval', async () => {
    harness.setStreamFactory(() =>
      stream([
        { type: 'text-delta', text: 'before' } as ModelStreamPart<ToolSet>,
        {
          type: 'tool-call',
          toolCallId: 'tool-1',
          toolName: 'search',
          input: { query: 'Chatbox' },
        } as ModelStreamPart<ToolSet>,
      ])
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(harness.persisted).toHaveLength(3)
    expect(harness.persisted[1].refreshCounting).toBe(false)
    expect(harness.persisted[1].message.contentParts).toEqual([
      { type: 'text', text: 'before', stepIndex: 0 },
      expect.objectContaining({ type: 'tool-call', toolCallId: 'tool-1' }),
    ])
  })

  it('ends the first user turn with the existing Agent Mode suggestion projection', async () => {
    harness.enableAgentModeSuggestion([
      {
        type: 'text',
        text: '{"suggest":true,"reason":"This task needs files and tools"}',
      },
    ])

    await harness.service.orchestrate('session-1', targetMessage(), { operationType: 'send_message' })

    expect(lastPersisted(harness)).toMatchObject({
      generating: false,
      finishReason: 'agent-mode-suggested',
      status: [],
      contentParts: [
        {
          type: 'agent-mode-suggestion',
          reason: 'This task needs files and tools',
        },
      ],
    })
    expect(harness.runtime.get('session-1')).toBeUndefined()
  })

  it('persists a runtime abort as a non-error terminal state', async () => {
    harness.setStreamFactory(() =>
      (async function* abortedStream() {
        await Promise.resolve()
        harness.runtime.abort('session-1', 'assistant-1')
        expect(harness.runtime.get('session-1')?.abortController.signal.aborted).toBe(true)
        yield* []
        throw new Error('request aborted')
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(lastPersisted(harness)).toMatchObject({
      generating: false,
      status: [],
    })
    expect(lastPersisted(harness).error).toBeUndefined()
    expect(harness.runtime.get('session-1')).toBeUndefined()
  })

  it('releases the runtime when an external abort interrupts the stream drain barrier', async () => {
    let releaseDrain: () => void = () => undefined
    const drain = new Promise<void>((resolve) => {
      releaseDrain = resolve
    })
    harness.runtime.registerUnsettledStreamDrain('session-1', drain)
    const externalAbortController = new AbortController()

    const generation = harness.service.orchestrate('session-1', targetMessage(), {
      externalAbortSignal: externalAbortController.signal,
    })
    await vi.waitFor(() => expect(harness.runtime.get('session-1', 'assistant-1')).toBeDefined())

    externalAbortController.abort()
    await generation

    expect(lastPersisted(harness)).toMatchObject({
      generating: false,
      status: [],
      finishReason: 'canceled',
    })
    expect(harness.runtime.get('session-1')).toBeUndefined()

    releaseDrain()
    await drain
  })

  it('maps ordinary errors through the injected host error policy', async () => {
    harness.setStreamFactory(() => stream([], new Error('provider failed')))

    await harness.service.orchestrate('session-1', targetMessage())

    expect(lastPersisted(harness)).toMatchObject({
      generating: false,
      status: [],
      error: 'provider failed',
      errorExtra: { source: 'test-error-mapper' },
    })
    expect(harness.afterMessageFailed).toHaveBeenCalledWith('session-1', lastPersisted(harness))
    expect(harness.afterMessageGenerated).not.toHaveBeenCalled()
    expect(harness.runtime.get('session-1')).toBeUndefined()
  })

  it('treats a disappearing session as an expected terminal outcome', async () => {
    const missingSession = new Error('Session session-1 not found')
    harness.failPersistenceFromCall(3, missingSession)
    harness.setStreamFactory(() =>
      (async function* disappearingSessionStream() {
        await Promise.resolve()
        harness.setNow(3_000)
        yield { type: 'text-delta', text: 'partial' } as ModelStreamPart<ToolSet>
      })()
    )

    await expect(harness.service.orchestrate('session-1', targetMessage())).resolves.toBeUndefined()
    expect(harness.runtime.get('session-1')).toBeUndefined()
    expect(lastPersisted(harness).error).toBeUndefined()
  })

  it('retains paused runtime state and a structured tool approval reason', async () => {
    harness.setStreamFactory(() =>
      stream(
        [
          {
            type: 'tool-call',
            toolCallId: 'tool-1',
            toolName: 'user_exec',
            input: { command: 'pwd' },
          } as ModelStreamPart<ToolSet>,
        ],
        {
          name: 'UserExecApprovalPausedError',
          toolCallId: 'tool-1',
          command: 'pwd',
          explanation: 'Inspect the current directory',
        }
      )
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(lastPersisted(harness)).toMatchObject({
      generating: false,
      finishReason: 'tool-call-paused',
      status: [],
      contentParts: [
        {
          type: 'tool-call',
          state: 'paused',
          toolCallId: 'tool-1',
          pauseReason: {
            type: 'user_exec_approval',
            command: 'pwd',
            explanation: 'Inspect the current directory',
          },
        },
      ],
    })
    expect(harness.runtime.get('session-1')).toMatchObject({
      messageId: 'assistant-1',
      phase: 'paused',
    })
  })

  it('uses host time for the periodic checkpoint boundary', async () => {
    harness.setStreamFactory(() =>
      (async function* timedStream() {
        await Promise.resolve()
        yield { type: 'text-delta', text: 'first' } as ModelStreamPart<ToolSet>
        harness.setNow(3_000)
        yield { type: 'text-delta', text: ' second' } as ModelStreamPart<ToolSet>
      })()
    )

    await harness.service.orchestrate('session-1', targetMessage())

    expect(harness.persisted).toHaveLength(3)
    expect(harness.persisted[1].message.contentParts).toEqual([{ type: 'text', text: 'first second', stepIndex: 0 }])
  })

  it('owns locking and background follow-up wake-up for paused-tool entry points', async () => {
    await harness.service.stopPausedToolCall('session-1', 'assistant-1', 'missing-tool')
    await harness.service.continuePausedToolCall('session-1', 'assistant-1', 'missing-tool')
    await harness.service.retryFromLastToolCallAfterApiError('session-1', 'assistant-1', 'missing-tool')

    expect(harness.coordinationEvents).toEqual([
      'lock:session-1',
      'wake:session-1',
      'lock:session-1',
      'wake:session-1',
      'lock:session-1',
    ])
  })

  it('persists a session tool-limit opt-out without changing the global setting', async () => {
    harness.session.settings = { provider: 'openai', temperature: 0.3 }
    harness.globalSettings.pauseOnToolCallLimit = true

    await harness.service.disableToolCallLimitPauseAndContinue('session-1', 'assistant-1', 'missing-tool', 'session')

    expect(harness.session.settings).toEqual({
      provider: 'openai',
      temperature: 0.3,
      pauseOnToolCallLimit: false,
    })
    expect(harness.globalSettings.pauseOnToolCallLimit).toBe(true)
  })

  it('persists a global tool-limit opt-out and removes the current session override', async () => {
    harness.session.settings = { provider: 'openai', temperature: 0.3, pauseOnToolCallLimit: true }
    harness.globalSettings.pauseOnToolCallLimit = true

    await harness.service.disableToolCallLimitPauseAndContinue('session-1', 'assistant-1', 'missing-tool', 'global')

    expect(harness.globalSettings.pauseOnToolCallLimit).toBe(false)
    expect(harness.session.settings).toEqual({ provider: 'openai', temperature: 0.3 })
  })

  it('tracks one opt-out action and resumes under the generation lock', async () => {
    await harness.service.disableToolCallLimitPauseAndContinue('session-1', 'assistant-1', 'missing-tool', 'session')

    expect(harness.trackPauseAction).toHaveBeenCalledOnce()
    expect(harness.trackPauseAction).toHaveBeenCalledWith({ type: 'tool_limit', action: 'disable_session' })
    await vi.waitFor(() => {
      expect(harness.coordinationEvents).toEqual(['lock:session-1', 'wake:session-1'])
    })
  })

  it('wraps tools with the step-limit pause for an attended chat', async () => {
    const capturedTools = captureToolsOnStream(harness)

    await harness.service.orchestrate('session-1', targetMessage(), { operationType: 'send_message' })

    expect(typeof capturedTools()).toBe('function')
    expect(capturedTools()).not.toBe(probeExecute)
  })

  it('leaves tools unwrapped for a full access chat so an unattended run is never stalled', async () => {
    harness.sessionSettings.commandApprovalMode = 'full_access'
    const capturedTools = captureToolsOnStream(harness)

    await harness.service.orchestrate('session-1', targetMessage(), { operationType: 'send_message' })

    expect(capturedTools()).toBe(probeExecute)
  })

  it('keeps the step-limit pause for a full access chat that opted back in', async () => {
    harness.sessionSettings.commandApprovalMode = 'full_access'
    harness.sessionSettings.pauseOnToolCallLimit = true
    const capturedTools = captureToolsOnStream(harness)

    await harness.service.orchestrate('session-1', targetMessage(), { operationType: 'send_message' })

    expect(typeof capturedTools()).toBe('function')
    expect(capturedTools()).not.toBe(probeExecute)
  })

  it('still resumes the paused batch when persisting the opt-out fails', async () => {
    harness.failSessionSettingsUpdate(new Error('storage failed'))

    await expect(
      harness.service.disableToolCallLimitPauseAndContinue('session-1', 'assistant-1', 'missing-tool', 'session')
    ).rejects.toThrow('storage failed')

    await vi.waitFor(() => {
      expect(harness.coordinationEvents).toEqual(['lock:session-1', 'wake:session-1'])
    })
  })

  it('forwards a persisted file preview version through approval continuation', async () => {
    const execute = vi.fn(async () => ({ success: false, errorCode: 'STALE_CONTENT' }))
    harness.setTools({ edit_file: { execute } } as unknown as ToolSet)
    harness.session.messages[1] = {
      ...targetMessage(),
      generating: false,
      finishReason: 'tool-call-paused',
      contentParts: [
        {
          type: 'tool-call',
          state: 'paused',
          toolCallId: 'tool-1',
          toolName: 'edit_file',
          args: { file_path: '/workspace/config.ts', old_text: 'a', new_text: 'b' },
          pauseReason: {
            type: 'file_mutation_approval',
            title: 'Edit config',
            preview: '-a\n+b',
            editPreview: { version: 'reviewed-version' },
          },
        },
      ],
    }
    harness.runtime.start('session-1', 'assistant-1')
    harness.runtime.setPhase('session-1', 'assistant-1', 'paused')
    await harness.service.continuePausedToolCall('session-1', 'assistant-1', 'tool-1')
    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ approved: true, approvalFileVersion: 'reviewed-version' })
    )
    expect(lastPersisted(harness).contentParts).toEqual([
      expect.objectContaining({ result: { success: false, errorCode: 'STALE_CONTENT' } }),
    ])
  })

  it('continues an approved tool call, persists its result, and resumes generation', async () => {
    const execute = vi.fn(() => Promise.resolve({ stdout: '/workspace' }))
    harness.setTools({
      user_exec: {
        execute,
      },
    } as unknown as ToolSet)
    harness.session.messages[1] = {
      ...targetMessage(),
      generating: false,
      finishReason: 'tool-call-paused',
      contentParts: [
        {
          type: 'tool-call',
          state: 'paused',
          toolCallId: 'tool-1',
          toolName: 'user_exec',
          args: { command: 'pwd' },
          pauseReason: { type: 'user_exec_approval', command: 'pwd', workdir: '/workspace' },
        },
      ],
    }
    harness.runtime.start('session-1', 'assistant-1')
    harness.runtime.setPhase('session-1', 'assistant-1', 'paused')

    await harness.service.continuePausedToolCall('session-1', 'assistant-1', 'tool-1')

    expect(execute).toHaveBeenCalledWith(
      { command: 'pwd' },
      expect.objectContaining({
        toolCallId: 'tool-1',
        approved: true,
        approvalWorkdir: '/workspace',
        approvalDetails: undefined,
        abortSignal: expect.any(AbortSignal),
      })
    )
    expect(lastPersisted(harness).contentParts).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        state: 'result',
        toolCallId: 'tool-1',
        result: { stdout: '/workspace' },
        pauseReason: undefined,
      }),
    ])
    expect(harness.runtime.get('session-1')).toBeUndefined()
  })

  it('stops every call in a tool-limit batch without resuming generation', async () => {
    const pauseReason = { type: 'tool_call_limit' as const, maxToolCalls: 25 }
    harness.session.messages[1] = {
      ...targetMessage(),
      generating: false,
      finishReason: 'tool-call-paused',
      contentParts: [
        {
          type: 'tool-call',
          state: 'paused',
          toolCallId: 'tool-1',
          toolName: 'search',
          args: {},
          pauseReason,
        },
        {
          type: 'tool-call',
          state: 'paused',
          toolCallId: 'tool-2',
          toolName: 'search',
          args: {},
          pauseReason,
        },
      ],
    }
    harness.runtime.start('session-1', 'assistant-1')
    harness.runtime.setPhase('session-1', 'assistant-1', 'paused')

    await harness.service.stopPausedToolCall('session-1', 'assistant-1', 'tool-1')

    expect(lastPersisted(harness).contentParts).toEqual([
      expect.objectContaining({ toolCallId: 'tool-1', state: 'error', pauseReason: undefined }),
      expect.objectContaining({ toolCallId: 'tool-2', state: 'error', pauseReason: undefined }),
    ])
    expect(harness.runtime.get('session-1')).toBeUndefined()
  })

  it('records a timed-out approval denial for the whole batch', async () => {
    const commandPause = { type: 'user_exec_approval' as const, command: 'rm -rf build' }
    harness.session.messages[1] = {
      ...targetMessage(),
      generating: false,
      finishReason: 'tool-call-paused',
      contentParts: [
        {
          type: 'tool-call',
          state: 'paused',
          toolCallId: 'tool-1',
          toolName: 'user_exec',
          args: {},
          stepIndex: 1,
          pauseReason: commandPause,
        },
        {
          type: 'tool-call',
          state: 'paused',
          toolCallId: 'tool-2',
          toolName: 'user_exec',
          args: {},
          stepIndex: 1,
          pauseReason: commandPause,
        },
        {
          type: 'tool-call',
          state: 'paused',
          toolCallId: 'tool-3',
          toolName: 'user_exec',
          args: {},
          stepIndex: 2,
          pauseReason: commandPause,
        },
      ],
    }

    await harness.service.stopPausedToolCall('session-1', 'assistant-1', 'tool-1', { denyReason: 'timeout' })

    expect(harness.trackPauseAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval', action: 'timeout' })
    )
    expect(lastPersisted(harness).contentParts).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-1',
        state: 'error',
        result: {
          success: false,
          exitCode: null,
          stdout: '',
          stderr: 'Command not run. Automatically denied: no user response within 45 seconds.',
        },
      }),
      expect.objectContaining({
        toolCallId: 'tool-2',
        state: 'error',
        result: { error: 'Automatically denied: no user response within 45 seconds.' },
      }),
      expect.objectContaining({ toolCallId: 'tool-3', state: 'paused' }),
    ])
  })

  it('restores approval UI when an interrupted legacy edit requires a fresh preview', async () => {
    const execute = vi.fn().mockRejectedValue({
      name: 'FileMutationApprovalPausedError',
      toolCallId: 'tool-1',
      title: 'Edit file: /workspace/a',
      preview: '-a\n+b',
      editPreview: { version: 'fresh' },
      stats: { mode: 'edit', addedLines: 1, removedLines: 1, approximate: true },
    })
    harness.setTools({ edit_file: { execute } } as unknown as ToolSet)
    harness.session.messages[1] = {
      ...targetMessage(),
      generating: false,
      error: 'provider disconnected',
      contentParts: [
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: 'tool-1',
          toolName: 'edit_file',
          args: {},
          pauseReason: { type: 'file_mutation_approval', title: 'Edit file: /workspace/a', preview: '' },
        },
      ],
    }
    await harness.service.retryFromLastToolCallAfterApiError('session-1', 'assistant-1', 'tool-1')
    expect(lastPersisted(harness)).toMatchObject({
      generating: false,
      finishReason: 'tool-call-paused',
      contentParts: [
        {
          state: 'paused',
          toolCallId: 'tool-1',
          pauseReason: {
            type: 'file_mutation_approval',
            editPreview: { version: 'fresh' },
            stats: { approximate: true },
          },
        },
      ],
    })
  })

  it.each(['reject', 'error-result', 'success-result'] as const)(
    'does not resume generation when a canceled tool retry returns %s',
    async (outcome) => {
      let started: () => void = () => undefined
      const executing = new Promise<void>((resolve) => {
        started = resolve
      })
      const execute = vi.fn(
        (_args: unknown, options: { abortSignal: AbortSignal }) =>
          new Promise<unknown>((resolve, reject) => {
            options.abortSignal.addEventListener(
              'abort',
              () => {
                if (outcome === 'reject') reject(options.abortSignal.reason)
                else if (outcome === 'error-result')
                  resolve({ isError: true, content: [{ type: 'text', text: 'Aborted' }] })
                else resolve({ found: true })
              },
              { once: true }
            )
            started()
          })
      )
      harness.setTools({ search: { execute } } as unknown as ToolSet)
      harness.session.messages[1] = {
        ...targetMessage(),
        generating: false,
        error: 'provider disconnected',
        contentParts: [{ type: 'tool-call', state: 'call', toolCallId: 'tool-1', toolName: 'search', args: {} }],
      }

      const retry = harness.service.retryFromLastToolCallAfterApiError('session-1', 'assistant-1', 'tool-1')
      await executing
      harness.runtime.requestAbort('session-1', 'assistant-1')
      await retry

      expect(execute).toHaveBeenCalledTimes(1)
      expect(lastPersisted(harness)).toMatchObject({ generating: false, finishReason: 'canceled', error: undefined })
      expect(lastPersisted(harness).contentParts).toEqual([
        expect.objectContaining({ state: 'error', toolCallId: 'tool-1' }),
      ])
      expect(harness.preparedRequests).toHaveLength(0)
      expect(harness.runtime.get('session-1')).toBeUndefined()
    }
  )

  it('persists cancellation before releasing a tool retry stopped during result persistence', async () => {
    const execute = vi.fn().mockResolvedValue({ found: true })
    harness.setTools({ search: { execute } } as unknown as ToolSet)
    harness.session.messages[1] = {
      ...targetMessage(),
      generating: false,
      error: 'provider disconnected',
      contentParts: [{ type: 'tool-call', state: 'call', toolCallId: 'tool-1', toolName: 'search', args: {} }],
    }
    const modifyMessage = harness.sessions.modifyMessage
    let persistedCancellation = false
    harness.sessions.modifyMessage = async (...args) => {
      const message = args[1]
      await modifyMessage(...args)
      if (message.finishReason === 'canceled') {
        expect(harness.runtime.get('session-1')?.abortController.signal.aborted).toBe(true)
        persistedCancellation = true
      } else if (message.contentParts.some((part) => part.type === 'tool-call' && part.state === 'result')) {
        harness.runtime.beginStop('session-1', 'assistant-1')
      }
    }

    await harness.service.retryFromLastToolCallAfterApiError('session-1', 'assistant-1', 'tool-1')

    expect(persistedCancellation).toBe(true)
    expect(lastPersisted(harness)).toMatchObject({
      generating: false,
      finishReason: 'canceled',
      contentParts: [expect.objectContaining({ state: 'result', result: { found: true } })],
    })
    expect(harness.preparedRequests).toHaveLength(0)
    expect(harness.runtime.get('session-1')).toBeUndefined()
  })

  it('retries the last interrupted tool call before resuming generation', async () => {
    const execute = vi.fn(() => Promise.resolve({ found: true }))
    harness.setTools({
      search: {
        execute,
      },
    } as unknown as ToolSet)
    harness.session.messages[1] = {
      ...targetMessage(),
      generating: false,
      error: 'provider disconnected',
      contentParts: [
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: 'tool-1',
          toolName: 'search',
          args: { query: 'Chatbox' },
        },
      ],
    }

    await harness.service.retryFromLastToolCallAfterApiError('session-1', 'assistant-1', 'tool-1')

    expect(execute).toHaveBeenCalledWith(
      { query: 'Chatbox' },
      { toolCallId: 'tool-1', approved: true, approvalDetails: undefined, abortSignal: expect.any(AbortSignal) }
    )
    expect(lastPersisted(harness)).toMatchObject({
      generating: false,
      error: undefined,
      contentParts: [
        expect.objectContaining({
          toolCallId: 'tool-1',
          state: 'result',
          result: { found: true },
        }),
      ],
    })
  })
})
