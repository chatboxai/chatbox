import { selectContextMessages } from '@shared/context'
import { describe, expect, test, vi } from 'vitest'
import type { LoggerPort } from '../../ports'
import type { Message, Session, SessionSettings, Settings } from '../../types'
import { selectTokenEstimationContext } from '../token-estimation/TokenEstimationService'
import { CompactionService, type CompactionSummaryPort } from './CompactionService'

function message(id: string, role: Message['role']): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }] }
}

function createHarness(
  options: {
    compactionPrompt?: string
    autoCompaction?: boolean
    beforeUpdate?: (session: Session) => Session
    logger?: LoggerPort
    messages?: Message[]
  } = {}
) {
  let session: Session = {
    id: 'session-1',
    name: 'Compaction',
    messages: options.messages ?? [
      message('system', 'system'),
      message('user', 'user'),
      message('assistant', 'assistant'),
    ],
    settings: {
      provider: 'openai',
      modelId: 'gpt-4.1',
      autoCompaction: options.autoCompaction,
    },
  }
  const sessionSettings: SessionSettings = {
    provider: 'openai',
    modelId: 'gpt-4.1',
    maxContextMessageCount: 10,
  }
  const globalSettings = {
    language: 'en',
    compactionPrompt: options.compactionPrompt,
    autoCompaction: true,
    defaultChatModel: { provider: 'openai', model: 'gpt-4.1' },
  } as Settings
  const getCompactionContext = vi.fn(
    (current: Session, _settings: SessionSettings, _pendingMessage?: Message) => current.messages
  )
  const shouldCompact = vi.fn(() => Promise.resolve(true))
  const generate = vi.fn<CompactionSummaryPort['generate']>(async (input) => {
    input.onStreamUpdate?.('streaming summary')
    return { success: true, summary: 'Final summary' }
  })
  const getSession = vi.fn(() => Promise.resolve(session))
  const service = new CompactionService({
    sessions: {
      getSession,
      getSessionSettings: () => Promise.resolve(sessionSettings),
      async updateSessionWithMessages(_sessionId, updater) {
        session = options.beforeUpdate?.(session) ?? session
        session = updater(session)
        return session
      },
    },
    settings: { getSettings: () => globalSettings },
    policy: {
      shouldCompact,
      getCompactionContext,
    },
    summaries: { generate },
    logger: options.logger,
    createId: () => 'summary-message',
    now: () => 123,
  })
  return {
    service,
    getSession,
    getCompactionContext,
    shouldCompact,
    generate,
    get session() {
      return session
    },
  }
}

describe('CompactionService', () => {
  test('rejects a retained round outside the target before generating or persisting a summary', async () => {
    const harness = createHarness()
    const result = await harness.service.run('session-1', {
      kind: 'generation',
      targetMessageId: 'assistant',
      retainedToolCallId: 'other-branch',
    })
    expect(result).toEqual({ status: 'skipped', reason: 'stale_path' })
    expect(harness.generate).not.toHaveBeenCalled()
    expect(harness.session.compactionPoints).toBeUndefined()
  })

  test('abandons a summary when its target path changes before commit', async () => {
    const harness = createHarness({
      beforeUpdate: (session) => ({
        ...session,
        messages: [message('replacement', 'user'), session.messages[2]],
      }),
    })
    Object.assign(harness.session.messages[2], {
      generating: true,
      contentParts: [{ type: 'tool-call', state: 'call', toolCallId: 'current-tool', toolName: 'search', args: {} }],
    })
    const result = await harness.service.run('session-1', {
      kind: 'generation',
      targetMessageId: 'assistant',
      retainedToolCallId: 'current-tool',
    })
    expect(harness.generate).toHaveBeenCalledOnce()
    expect(result).toEqual({ status: 'skipped', reason: 'stale_path' })
    expect(harness.session.compactionPoints).toBeUndefined()
  })

  test.each(['summary', 'commit'] as const)('cancels at %s without persisting a summary', async (stage) => {
    const abort = new AbortController()
    const harness = createHarness({
      beforeUpdate: (session) => {
        if (stage === 'commit') abort.abort()
        return session
      },
    })
    harness.generate.mockImplementationOnce(async () => {
      if (stage === 'summary') abort.abort()
      return { success: true, summary: 'Cancelled summary' }
    })
    expect(await harness.service.run('session-1', { kind: 'manual' }, { abortSignal: abort.signal })).toEqual({
      status: 'cancelled',
    })
    expect(harness.session.compactionPoints).toBeUndefined()
    expect(harness.session.messages.some((message) => message.isSummary)).toBe(false)
    expect(harness.service.isInProgress('session-1')).toBe(false)
  })

  test('reports busy while another summary runs and accepts work after it settles', async () => {
    const harness = createHarness()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    harness.generate.mockImplementationOnce(async () => {
      await waiting
      return { success: true, summary: 'First summary' }
    })
    const first = harness.service.run('session-1', { kind: 'manual' })
    expect(await harness.service.run('session-1', { kind: 'manual' })).toEqual({ status: 'skipped', reason: 'busy' })
    release()
    expect(await first).toMatchObject({ status: 'compacted' })
    expect(await harness.service.run('session-1', { kind: 'manual' })).toMatchObject({ status: 'compacted' })
  })

  test('summarizes an archived generation using its prior summary and eligible boundary', async () => {
    const harness = createHarness()
    const target: Message = {
      ...message('target', 'assistant'),
      generating: true,
      contentParts: [{ type: 'tool-call', state: 'call', toolCallId: 'retained', toolName: 'search', args: {} }],
    }
    const oldSummary: Message = { ...message('old-summary', 'assistant'), isSummary: true }
    harness.session.threads = [
      {
        id: 'archived',
        name: 'Archived',
        createdAt: 1,
        messages: [
          message('old-user', 'user'),
          oldSummary,
          message('recent-user', 'user'),
          { ...message('marker', 'assistant'), isForkMarker: true },
          target,
        ],
        compactionPoints: [{ summaryMessageId: 'old-summary', boundaryMessageId: 'old-user', createdAt: 1 }],
      },
    ]
    harness.getCompactionContext.mockImplementation((session, settings, pending) =>
      selectTokenEstimationContext(session, settings.maxContextMessageCount, pending)
    )
    const request = { kind: 'generation' as const, targetMessageId: 'target', retainedToolCallId: 'retained' }
    const result = await harness.service.run('session-1', request)
    expect(result).toMatchObject({ status: 'compacted', coverage: { ...request, boundaryMessageId: 'recent-user' } })
    expect(harness.generate.mock.calls[0][0].messages.map((message) => message.id)).toEqual([
      'old-summary',
      'recent-user',
    ])
    expect(harness.session.compactionPoints).toBeUndefined()
    expect(harness.session.threads[0].compactionPoints?.at(-1)?.boundaryMessageId).toBe('recent-user')
  })

  test('uses the saved prompt for automatic compaction', async () => {
    const harness = createHarness({ compactionPrompt: 'Preserve decisions and file paths.' })
    await harness.service.run('session-1', { kind: 'automatic' })
    expect(harness.generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Preserve decisions and file paths.' })
    )
  })

  test('keeps a manual prompt override scoped to one run', async () => {
    const harness = createHarness({ compactionPrompt: 'Saved instructions' })
    await harness.service.run('session-1', { kind: 'manual' }, { prompt: 'One-time instructions' })
    expect(harness.generate).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'One-time instructions' }))
    await harness.service.run('session-1', { kind: 'manual' })
    expect(harness.generate).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'Saved instructions' }))
  })

  test('appends a summary and exact boundary through an atomic Session update', async () => {
    const harness = createHarness()
    const streamUpdates: string[] = []

    const result = await harness.service.run(
      'session-1',
      { kind: 'automatic' },
      {
        onStreamUpdate: (text) => streamUpdates.push(text),
      }
    )

    expect(result).toMatchObject({
      status: 'compacted',
      coverage: { kind: 'conversation', boundaryMessageId: 'assistant' },
    })
    if (result.status !== 'compacted') throw new Error('Expected a committed summary')
    expect(streamUpdates).toEqual(['streaming summary'])
    expect(harness.generate).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }))
    expect(harness.session.messages.at(-1)).toMatchObject({ role: 'assistant', isSummary: true })
    expect(harness.session.compactionPoints).toEqual([
      {
        summaryMessageId: result.summaryMessageId,
        boundaryMessageId: 'assistant',
        createdAt: 123,
      },
    ])
  })

  test('uses the pending turn for the threshold without including it in the summary boundary', async () => {
    const harness = createHarness()
    const pendingMessage = message('pending-user', 'user')

    await harness.service.run('session-1', { kind: 'automatic', pendingMessage })

    expect(harness.shouldCompact).toHaveBeenCalledWith(expect.objectContaining({ pendingMessage }))
    expect(harness.getCompactionContext).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), pendingMessage)
    expect(harness.generate.mock.calls[0]?.[0]).toMatchObject({
      messages: expect.not.arrayContaining([pendingMessage]),
    })
  })

  test('summarizes through the latest message with tool calls flattened', async () => {
    const toolMessage: Message = {
      id: 'a1',
      role: 'assistant',
      contentParts: [
        { type: 'text', text: 'checked' },
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'tc-1',
          toolName: 'read_file',
          args: { path: '/tmp/x' },
          result: { content: 'file body' },
        },
      ],
    }
    const harness = createHarness({
      messages: [
        message('u1', 'user'),
        toolMessage,
        message('u2', 'user'),
        message('a2', 'assistant'),
        message('u3', 'user'),
        message('a3', 'assistant'),
      ],
    })

    const result = await harness.service.run('session-1', { kind: 'manual' })

    expect(result).toMatchObject({ status: 'compacted' })
    expect(harness.session.compactionPoints?.[0]).toMatchObject({ boundaryMessageId: 'a3' })
    expect(harness.session.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'summary-message'])

    // The summarizer saw only the covered range, with the tool call flattened to text.
    const summaryInput = harness.generate.mock.calls[0][0]
    expect(summaryInput.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3'])
    const flattenedParts = summaryInput.messages[1].contentParts ?? []
    expect(flattenedParts.some((part) => part.type === 'tool-call')).toBe(false)
    expect(
      flattenedParts.some(
        (part) => part.type === 'text' && part.text.includes('[tool read_file]') && part.text.includes('file body')
      )
    ).toBe(true)
  })

  test('covers the latest message in histories longer than 200 messages', async () => {
    const messages: Message[] = []
    for (let round = 1; round <= 130; round += 1) {
      messages.push(message(`u${round}`, 'user'))
      messages.push(message(`a${round}`, 'assistant'))
    }
    const harness = createHarness({ messages })

    const result = await harness.service.run('session-1', { kind: 'manual' })

    expect(result).toMatchObject({ status: 'compacted' })
    expect(harness.session.compactionPoints?.[0]).toMatchObject({ boundaryMessageId: 'a130' })
    const summaryInput = harness.generate.mock.calls[0][0]
    expect(summaryInput.messages).toHaveLength(260)
    expect(summaryInput.messages.at(-1)?.id).toBe('a130')
  })

  test.each([false, true])('preserves messages arriving during compaction (force=%s)', async (force) => {
    const messages = Array.from({ length: 4 }, (_, index) => [
      message(`u${index + 1}`, 'user'),
      message(`a${index + 1}`, 'assistant'),
    ]).flat()
    const harness = createHarness({
      messages: [message('system', 'system'), ...messages],
      beforeUpdate: (session) => ({
        ...session,
        messages: [...session.messages, message('new-user', 'user')],
      }),
    })

    await expect(harness.service.run('session-1', { kind: force ? 'manual' : 'automatic' })).resolves.toMatchObject({
      status: 'compacted',
    })
    expect(harness.session.compactionPoints?.[0].boundaryMessageId).toBe('a4')
    expect(
      selectContextMessages(harness.session.messages, {
        compactionPoints: harness.session.compactionPoints,
      }).map((item) => item.id)
    ).toEqual(['system', 'summary-message', 'new-user'])
    const summaryInput = harness.generate.mock.calls[0][0]
    expect(summaryInput.messages.map((item) => item.id)).toEqual(['system', ...messages.map((item) => item.id)])
  })

  test('honors the per-session auto-compaction override before invoking policy', async () => {
    const harness = createHarness({ autoCompaction: false })

    await expect(harness.service.needsCompaction('session-1')).resolves.toBe(false)
    expect(harness.shouldCompact).not.toHaveBeenCalled()
  })

  test('returns a structured failure and leaves Session data unchanged when summary generation fails', async () => {
    const harness = createHarness()
    harness.generate.mockResolvedValueOnce({ success: false, error: new Error('provider failed') })
    const originalMessages = harness.session.messages

    const result = await harness.service.run('session-1', { kind: 'manual' })

    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'summary_failed', message: 'provider failed' },
    })
    expect(harness.session.messages).toBe(originalMessages)
    expect(harness.service.isInProgress('session-1')).toBe(false)
  })

  test('logs and abandons compaction when the boundary disappears while the summary streams', async () => {
    const log = vi.fn<LoggerPort['log']>()
    const harness = createHarness({
      beforeUpdate: (session) => ({
        ...session,
        messages: session.messages.filter((current) => current.id !== 'assistant'),
      }),
      logger: { log },
    })

    const result = await harness.service.run('session-1', { kind: 'manual' })

    expect(result).toEqual({ status: 'skipped', reason: 'stale_path' })
    expect(log).toHaveBeenCalledWith('warn', 'Compaction path changed during summary streaming; compaction abandoned', {
      sessionId: 'session-1',
      boundaryMessageId: 'assistant',
    })
  })
})

test('decides automatic compaction once before starting feedback and reads a fresh planning session', async () => {
  const harness = createHarness()
  const onStart = vi.fn(() => {
    expect(harness.shouldCompact).toHaveBeenCalledOnce()
    expect(harness.service.isInProgress('session-1')).toBe(true)
    expect(harness.generate).not.toHaveBeenCalled()
  })
  const result = await harness.service.run('session-1', { kind: 'automatic' }, { onStart })
  expect(result.status).toBe('compacted')
  expect(onStart).toHaveBeenCalledOnce()
  expect(harness.getSession).toHaveBeenCalledTimes(2)
})

test('does not start feedback when automatic compaction is unnecessary or cancelled during estimation', async () => {
  const harness = createHarness()
  const onStart = vi.fn()
  harness.shouldCompact.mockResolvedValueOnce(false)
  await expect(harness.service.run('session-1', { kind: 'automatic' }, { onStart })).resolves.toEqual({
    status: 'skipped',
    reason: 'not_needed',
  })
  const controller = new AbortController()
  harness.shouldCompact.mockImplementationOnce(async () => {
    controller.abort()
    return true
  })
  await expect(
    harness.service.run('session-1', { kind: 'automatic' }, { onStart, abortSignal: controller.signal })
  ).resolves.toEqual({ status: 'cancelled' })
  expect(onStart).not.toHaveBeenCalled()
  expect(harness.generate).not.toHaveBeenCalled()
  expect(harness.service.isInProgress('session-1')).toBe(false)
})

test('releases ownership when start feedback throws and permits a later run', async () => {
  const harness = createHarness()
  const result = await harness.service.run(
    'session-1',
    { kind: 'manual' },
    {
      onStart: () => {
        throw new Error('Feedback unavailable')
      },
    }
  )
  expect(result.status).toBe('failed')
  expect(harness.service.isInProgress('session-1')).toBe(false)
  expect(harness.generate).not.toHaveBeenCalled()
  expect((await harness.service.run('session-1', { kind: 'manual' })).status).toBe('compacted')
})

test('only the admitted concurrent run starts feedback', async () => {
  const harness = createHarness()
  const onStart = vi.fn()
  const first = harness.service.run('session-1', { kind: 'manual' }, { onStart })
  const second = harness.service.run('session-1', { kind: 'automatic' }, { onStart })
  expect(await second).toEqual({ status: 'skipped', reason: 'busy' })
  expect((await first).status).toBe('compacted')
  expect(onStart).toHaveBeenCalledOnce()
})

test('cancellation from start feedback does not generate a summary or retain ownership', async () => {
  const harness = createHarness()
  const controller = new AbortController()
  const result = await harness.service.run(
    'session-1',
    { kind: 'manual' },
    { abortSignal: controller.signal, onStart: () => controller.abort() }
  )
  expect(result).toEqual({ status: 'cancelled' })
  expect(harness.generate).not.toHaveBeenCalled()
  expect(harness.service.isInProgress('session-1')).toBe(false)
})
