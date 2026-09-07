import type { ModelMessage } from 'ai'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ModelInterface } from '../../models/types'
import { buildNameGenerationAttemptKey, getCurrentThreadNamingIdentity } from '../../session/auto-title'
import type { Message, Session, Settings, Updater } from '../../types'
import { type ScheduledNameGeneration, SessionNamingService } from './SessionNamingService'
import type { SessionMetadataUpdate } from './session-metadata'
import { SessionNotFoundError } from './SessionWriteCoordinator'

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Untitled',
    type: 'chat',
    messages: [
      { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'System' }] },
      { id: 'user', role: 'user', contentParts: [{ type: 'text', text: '请帮我制定旅行计划' }] },
      { id: 'assistant', role: 'assistant', contentParts: [{ type: 'text', text: '当然可以' }] },
    ],
    ...overrides,
  }
}

function createHarness() {
  let session: Session | null = createSession()
  const settings = {
    language: 'en',
    threadNamingModel: { provider: 'openai', model: 'fast-model' },
  } as Settings
  const chat = vi.fn(() =>
    Promise.resolve({
      contentParts: [{ type: 'text' as const, text: '"北京旅行计划"' }],
    })
  )
  const model = {
    name: 'Naming model',
    modelId: 'fast-model',
    isSupportVision: () => false,
    isSupportToolUse: () => false,
    isSupportSystemMessage: () => true,
    normalizeCompletedResponse: (parts) => parts,
    chat,
    async *chatStream() {},
    paint: () => Promise.resolve([]),
  } satisfies ModelInterface
  const scheduled: Array<{ callback: () => void; cancelled: boolean }> = []
  const getSession = vi.fn(() => Promise.resolve(session))
  const updateSession = vi.fn((_sessionId: string, updater: Updater<SessionMetadataUpdate>) => {
    if (!session) return Promise.reject(new SessionNotFoundError('session-1'))
    const update = typeof updater === 'function' ? updater(session) : updater
    session = { ...session, ...update }
    return Promise.resolve(session)
  })
  const updateSessionWithMessages = vi.fn((_sessionId: string, updater: Updater<Session>) => {
    if (!session) return Promise.reject(new SessionNotFoundError('session-1'))
    const next = typeof updater === 'function' ? updater(session) : { ...session, ...updater }
    session = next
    return Promise.resolve(next)
  })
  const toModelMessages = vi.fn((messages: Message[]) => {
    const textPart = messages[0]?.contentParts[0]
    return Promise.resolve([
      { role: 'user', content: textPart?.type === 'text' ? textPart.text : '' },
    ] as ModelMessage[])
  })
  const service = new SessionNamingService({
    sessions: { getSession, updateSession, updateSessionWithMessages },
    settings: { getSettings: () => settings },
    models: { createModel: vi.fn(() => Promise.resolve(model)) },
    scheduler: {
      schedule(callback): ScheduledNameGeneration {
        const task = { callback, cancelled: false }
        scheduled.push(task)
        return {
          cancel: () => {
            task.cancelled = true
          },
        }
      },
    },
    getLanguageName: (language) => (language === 'zh-Hans' ? 'Simplified Chinese' : 'English'),
    toModelMessages,
    reportUnexpectedError: vi.fn(),
  })
  return {
    service,
    scheduled,
    chat,
    getSession,
    updateSession,
    updateSessionWithMessages,
    toModelMessages,
    settings,
    get session() {
      return session
    },
    setSession(next: Session | null) {
      session = next
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SessionNamingService', () => {
  test('uses the injected model and locale, cleans the name, and persists it', async () => {
    const harness = createHarness()

    await expect(harness.service.generateNameAndThreadName('session-1', 'zh-Hans')).resolves.toBe(true)

    expect(harness.session?.name).toBe('北京旅行计划')
    expect(harness.session?.threadName).toBe('北京旅行计划')
    const prompt = harness.toModelMessages.mock.calls[0][0][0].contentParts[0]
    expect(prompt).toMatchObject({ type: 'text' })
    if (prompt.type === 'text') expect(prompt.text).toContain('Simplified Chinese')
  })

  test('keeps the first pending schedule and names only after eligibility is re-checked', async () => {
    const harness = createHarness()

    harness.service.scheduleNameAndThreadName('session-1')
    harness.service.scheduleNameAndThreadName('session-1')

    expect(harness.scheduled).toHaveLength(1)
    expect(harness.scheduled[0].cancelled).toBe(false)
    harness.scheduled[0].callback()
    await vi.waitFor(() => expect(harness.session?.name).toBe('北京旅行计划'))
    expect(harness.chat).toHaveBeenCalledOnce()
  })

  test('skips a scheduled name when the assistant turn became ineligible', async () => {
    const harness = createHarness()
    harness.service.scheduleNameAndThreadName('session-1')
    harness.setSession(
      createSession({
        messages: [
          { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] },
          {
            id: 'assistant',
            role: 'assistant',
            finishReason: 'agent-mode-suggested',
            contentParts: [{ type: 'agent-mode-suggestion', reason: 'needs tools' }],
          },
        ],
      })
    )

    harness.scheduled[0].callback()
    await vi.waitFor(() =>
      expect(harness.service.isPending(buildNameGenerationAttemptKey('name', 'session-1'))).toBe(false)
    )
    expect(harness.chat).not.toHaveBeenCalled()
  })

  test('allows a replacement schedule while the previous eligibility read is in flight', async () => {
    const harness = createHarness()
    let resolveFirstRead: ((session: Session | null) => void) | undefined
    harness.getSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstRead = resolve
        })
    )

    harness.service.scheduleNameAndThreadName('session-1')
    harness.scheduled[0].callback()
    harness.service.scheduleNameAndThreadName('session-1')
    expect(harness.scheduled).toHaveLength(2)

    resolveFirstRead?.(null)
    await Promise.resolve()
    harness.scheduled[1].callback()
    await vi.waitFor(() => expect(harness.session?.name).toBe('北京旅行计划'))
  })

  test('defers failed streaming attempts until generation settles', async () => {
    const harness = createHarness()
    const streaming = createSession({
      messages: [
        { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] },
        { id: 'assistant', role: 'assistant', generating: true, contentParts: [] },
      ],
    })
    harness.setSession(streaming)
    harness.chat.mockRejectedValueOnce(new Error('model unavailable'))

    harness.service.scheduleNameAndThreadName('session-1', { messages: streaming.messages })
    harness.scheduled[0].callback()
    await vi.waitFor(() => expect(harness.chat).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(harness.service.isActive(buildNameGenerationAttemptKey('name', 'session-1'))).toBe(false)
    )

    harness.service.scheduleNameAndThreadName('session-1', { messages: streaming.messages })
    expect(harness.scheduled).toHaveLength(1)

    const settled = createSession()
    harness.setSession(settled)
    harness.service.scheduleNameAndThreadName('session-1', { messages: settled.messages })
    expect(harness.scheduled).toHaveLength(2)
    harness.scheduled[1].callback()
    await vi.waitFor(() => expect(harness.session?.name).toBe('北京旅行计划'))
    expect(harness.chat).toHaveBeenCalledTimes(2)
  })

  test('does not write back or record retries after deletion during the model call', async () => {
    const harness = createHarness()
    harness.chat.mockImplementation(() => {
      harness.setSession(null)
      return Promise.resolve({ contentParts: [{ type: 'text' as const, text: 'Deleted title' }] })
    })

    harness.service.scheduleNameAndThreadName('session-1')
    harness.scheduled[0].callback()
    await vi.waitFor(() => expect(harness.chat).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(harness.service.isActive(buildNameGenerationAttemptKey('name', 'session-1'))).toBe(false)
    )

    expect(harness.session).toBeNull()
    expect(harness.updateSession).not.toHaveBeenCalled()
    expect(harness.updateSessionWithMessages).toHaveBeenCalledOnce()
    harness.service.scheduleNameAndThreadName('session-1')
    expect(harness.scheduled).toHaveLength(2)
  })

  test('strips multiline think blocks before persisting a generated name', async () => {
    const harness = createHarness()
    harness.chat.mockResolvedValueOnce({
      contentParts: [{ type: 'text' as const, text: '<think>\nreason\nmore\n</think>\n周末计划' }],
    })

    await expect(harness.service.generateNameAndThreadName('session-1')).resolves.toBe(true)
    expect(harness.session?.name).toBe('周末计划')
  })

  test('syncAutoTitle backfills a historical threadName without calling the model', async () => {
    const harness = createHarness()
    harness.setSession(createSession({ name: '北京旅行计划', threadName: undefined }))

    harness.service.syncAutoTitle(harness.session!)
    harness.service.syncAutoTitle(harness.session!)
    await vi.waitFor(() => expect(harness.session?.threadName).toBe('北京旅行计划'))
    expect(harness.updateSession).toHaveBeenCalledOnce()
    expect(harness.chat).not.toHaveBeenCalled()
    expect(harness.scheduled).toHaveLength(0)
  })

  test('syncAutoTitle backfills a cleared historical session to pending instead of the old name', async () => {
    const harness = createHarness()
    harness.setSession(
      createSession({
        name: '北京旅行计划',
        threadName: undefined,
        messages: [{ id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'System' }] }],
      })
    )

    harness.service.syncAutoTitle(harness.session!)
    await vi.waitFor(() => expect(harness.session?.threadName).toBe(''))
    expect(harness.chat).not.toHaveBeenCalled()
  })

  test('syncAutoTitle still migrates threadName when auto titles are disabled', async () => {
    const harness = createHarness()
    harness.settings.autoGenerateTitle = false
    harness.setSession(createSession({ name: '北京旅行计划', threadName: undefined }))

    harness.service.syncAutoTitle(harness.session!)
    await vi.waitFor(() => expect(harness.session?.threadName).toBe('北京旅行计划'))
    expect(harness.scheduled).toHaveLength(0)
    expect(harness.chat).not.toHaveBeenCalled()
  })

  test('syncAutoTitle schedules thread naming for a newly named pending session', () => {
    const harness = createHarness()
    harness.setSession(createSession({ name: 'Travel planner', threadName: '' }))

    harness.service.syncAutoTitle(harness.session!)

    expect(harness.scheduled).toHaveLength(1)
    expect(harness.session?.threadName).toBe('')
    expect(harness.chat).not.toHaveBeenCalled()
  })

  test('syncAutoTitle schedules Untitled naming and skips when the setting is off', () => {
    const harness = createHarness()
    harness.service.syncAutoTitle(harness.session!)
    expect(harness.scheduled).toHaveLength(1)

    const disabled = createHarness()
    disabled.settings.autoGenerateTitle = false
    disabled.service.syncAutoTitle(disabled.session!)
    expect(disabled.scheduled).toHaveLength(0)
  })

  test('cancels pending work and clears retry state when a Session is deleted', () => {
    const harness = createHarness()
    harness.service.scheduleNameAndThreadName('session-1')

    harness.service.clearSessionState('session-1')

    expect(harness.scheduled[0].cancelled).toBe(true)
    expect(harness.service.isPending(buildNameGenerationAttemptKey('name', 'session-1'))).toBe(false)
  })

  test('does not write a stale thread title after the current thread is replaced', async () => {
    const harness = createHarness()
    const original = createSession({ name: 'Travel planner', threadName: '' })
    harness.setSession(original)

    harness.chat.mockImplementation(() => {
      harness.setSession(
        createSession({
          name: 'Travel planner',
          threadName: '',
          messages: [{ id: 'system-new', role: 'system', contentParts: [{ type: 'text', text: 'System' }] }],
          threads: [
            {
              id: 'archived-1',
              name: 'Old pending',
              messages: original.messages,
              createdAt: 1,
            },
          ],
        })
      )
      return Promise.resolve({ contentParts: [{ type: 'text' as const, text: 'Old trip title' }] })
    })

    harness.service.scheduleThreadName('session-1')
    harness.scheduled[0].callback()
    await vi.waitFor(() => expect(harness.chat).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(harness.service.isActive(buildNameGenerationAttemptKey('thread', 'session-1'))).toBe(false)
    )

    expect(harness.session?.threadName).toBe('')
    expect(harness.session?.threads?.[0]?.messages).toEqual(original.messages)
  })

  test('does not overwrite a restored thread name after the current thread is removed', async () => {
    const harness = createHarness()
    const original = createSession({ name: 'Travel planner', threadName: '' })
    harness.setSession(original)

    harness.chat.mockImplementation(() => {
      harness.setSession(
        createSession({
          name: 'Travel planner',
          threadName: 'History',
          messages: [
            { id: 'history-user', role: 'user', contentParts: [{ type: 'text', text: 'earlier' }] },
            { id: 'history-assistant', role: 'assistant', contentParts: [{ type: 'text', text: 'ok' }] },
          ],
          threads: [],
        })
      )
      return Promise.resolve({ contentParts: [{ type: 'text' as const, text: 'Stale title' }] })
    })

    harness.service.scheduleThreadName('session-1')
    harness.scheduled[0].callback()
    await vi.waitFor(() => expect(harness.chat).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(harness.service.isActive(buildNameGenerationAttemptKey('thread', 'session-1'))).toBe(false)
    )

    expect(harness.session?.threadName).toBe('History')
  })

  test('does not overwrite a thread name the user set during the model call', async () => {
    const harness = createHarness()
    const original = createSession({ name: 'Travel planner', threadName: '' })
    harness.setSession(original)

    harness.chat.mockImplementation(() => {
      harness.setSession({ ...original, threadName: 'Manual title' })
      return Promise.resolve({ contentParts: [{ type: 'text' as const, text: 'Generated title' }] })
    })

    harness.service.scheduleThreadName('session-1')
    harness.scheduled[0].callback()
    await vi.waitFor(() => expect(harness.chat).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(harness.service.isActive(buildNameGenerationAttemptKey('thread', 'session-1'))).toBe(false)
    )
    expect(harness.session?.threadName).toBe('Manual title')
  })

  test('lets a replacement thread schedule while an older naming request is in flight', async () => {
    const harness = createHarness()
    const original = createSession({ name: 'Travel planner', threadName: '' })
    harness.setSession(original)

    let releaseChat: ((value: { contentParts: Array<{ type: 'text'; text: string }> }) => void) | undefined
    harness.chat.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseChat = resolve
        })
    )

    harness.service.syncAutoTitle(original)
    expect(harness.scheduled).toHaveLength(1)
    harness.scheduled[0].callback()
    await vi.waitFor(() => expect(harness.chat).toHaveBeenCalledOnce())

    const next = createSession({
      name: 'Travel planner',
      threadName: '',
      messages: [
        { id: 'system-2', role: 'system', contentParts: [{ type: 'text', text: 'System' }] },
        { id: 'user-2', role: 'user', contentParts: [{ type: 'text', text: 'new trip' }] },
        { id: 'assistant-2', role: 'assistant', contentParts: [{ type: 'text', text: 'sure' }] },
      ],
      threads: [
        {
          id: 'archived-1',
          name: 'Old pending',
          messages: original.messages,
          createdAt: 1,
        },
      ],
    })
    harness.setSession(next)
    harness.service.syncAutoTitle(next)

    expect(harness.scheduled).toHaveLength(2)
    expect(
      harness.service.isActive(
        buildNameGenerationAttemptKey('thread', 'session-1', getCurrentThreadNamingIdentity(original))
      )
    ).toBe(true)

    releaseChat?.({ contentParts: [{ type: 'text', text: 'Old trip title' }] })
    await vi.waitFor(() =>
      expect(
        harness.service.isActive(
          buildNameGenerationAttemptKey('thread', 'session-1', getCurrentThreadNamingIdentity(original))
        )
      ).toBe(false)
    )
    expect(harness.session?.threadName).toBe('')

    harness.scheduled[1].callback()
    await vi.waitFor(() => expect(harness.session?.threadName).toBe('北京旅行计划'))
  })

  test('clears identity-scoped pending keys when a Session is deleted', () => {
    const harness = createHarness()
    const original = createSession({ name: 'Travel planner', threadName: '' })
    harness.setSession(original)
    harness.service.syncAutoTitle(original)

    harness.service.clearSessionState('session-1')

    expect(harness.scheduled[0].cancelled).toBe(true)
    expect(
      harness.service.isPending(
        buildNameGenerationAttemptKey('thread', 'session-1', getCurrentThreadNamingIdentity(original))
      )
    ).toBe(false)
  })

  test('evaluates thread identity inside the queued title write', async () => {
    const harness = createHarness()
    const original = createSession({ name: 'Travel planner', threadName: '' })
    harness.setSession(original)

    harness.updateSessionWithMessages.mockImplementation((_sessionId, updater) => {
      const switched = createSession({
        name: 'Travel planner',
        threadName: '',
        messages: [{ id: 'system-new', role: 'system', contentParts: [{ type: 'text', text: 'System' }] }],
        threads: [
          {
            id: 'archived-1',
            name: 'Old pending',
            messages: original.messages,
            createdAt: 1,
          },
        ],
      })
      const next = typeof updater === 'function' ? updater(switched) : { ...switched, ...updater }
      harness.setSession(next)
      return Promise.resolve(next)
    })

    await expect(harness.service.generateThreadName('session-1')).resolves.toBe(false)
    expect(harness.session?.threadName).toBe('')
    expect(harness.session?.messages[0]?.id).toBe('system-new')
  })

  test('still writes when an unrelated archived thread is removed during the model call', async () => {
    const harness = createHarness()
    const original = createSession({
      name: 'Travel planner',
      threadName: '',
      threads: [
        {
          id: 'archived-1',
          name: 'Old',
          messages: [{ id: 'old-user', role: 'user', contentParts: [{ type: 'text', text: 'earlier' }] }],
          createdAt: 1,
        },
      ],
    })
    harness.setSession(original)

    harness.chat.mockImplementation(() => {
      harness.setSession({ ...original, threads: [] })
      return Promise.resolve({ contentParts: [{ type: 'text' as const, text: '北京旅行计划' }] })
    })

    harness.service.scheduleThreadName('session-1')
    harness.scheduled[0].callback()
    await vi.waitFor(() => expect(harness.session?.threadName).toBe('北京旅行计划'))
  })
})
