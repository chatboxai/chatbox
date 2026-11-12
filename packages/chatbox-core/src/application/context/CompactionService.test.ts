import { buildCompactionHandoff, buildContext, selectContextMessages } from '@shared/context'
import { sandboxAttachmentIdentity, sandboxAttachmentRelPath } from '@shared/sandbox/attachment-path'
import { uploadedFilePath, uploadedFileToolHint } from '@shared/uploaded-file-tools'
import type { SessionContextSource } from '../../ports/session-context-source'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import { RowBackedSessionRepository } from '../session/RowBackedSessionRepository'
import { SessionRowWriteQueue } from '../session/SessionRowWriteQueue'
import { verifySessionTreeRoundTrip } from '../../session/session-tree/verify'
import { decodeSessionTree } from '../../session/session-tree/decode'
import { convertLegacyTreeToRowFormat } from '../session/compatibility/row-format'

import { describe, expect, test, vi } from 'vitest'
import type { LoggerPort } from '../../ports'
import type { Message, MessageFile, Session, SessionSettings, Settings } from '../../types'
import { getCompactionBudget } from '../token-estimation/math'
import { selectTokenEstimationContext } from '../token-estimation/TokenEstimationService'
import {
  type CompactionPolicyPort,
  CompactionService,
  type CompactionSummaryPort,
  getRequestOverheadBeyond,
} from './CompactionService'

/** A 16K window: 4K reply reservation, 12K usable, compaction above 9.2K. */
const budget = getCompactionBudget(16_384)!
const overThreshold = { tokens: budget.thresholdTokens + 1, budget }
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
    maxContextMessageCount?: number
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
    maxContextMessageCount: options.maxContextMessageCount ?? 10,
  }
  const globalSettings = {
    language: 'en',
    compactionPrompt: options.compactionPrompt,
    autoCompaction: true,
    defaultChatModel: { provider: 'openai', model: 'gpt-4.1' },
  } as Settings
  const getCompactionContext = vi.fn(
    (current: SessionContextSource, _settings: SessionSettings, _pendingMessage?: Message) => current.candidateMessages
  )
  const measure = vi.fn<CompactionPolicyPort['measure']>(() => Promise.resolve(overThreshold))
  const generate = vi.fn<CompactionSummaryPort['generate']>(async (input) => {
    input.onStreamUpdate?.('streaming summary')
    return { success: true, summary: 'Final summary' }
  })
  const rows = new InMemorySessionRowStore()
  const records = new InMemorySessionRecordStore()
  const repository = new RowBackedSessionRepository({
    records,
    rows,
    writes: new SessionRowWriteQueue((_id, run) => run()),
  })
  const seedFixture = async () => {
    const verified = verifySessionTreeRoundTrip(session, { activeThreadId: session.id, now: 0 })
    if (!verified.ok) throw new Error(verified.reason)
    const tree = convertLegacyTreeToRowFormat(verified.tree, verified.session.messageForksHash)
    const previous = await rows.getRevision(session.id)
    await rows.writeRows(
      {
        record: tree.session,
        revision: (previous ?? 0) + 1,
        rows: { sessionId: session.id, threads: tree.threads, messages: tree.messages },
      },
      previous
    )
  }
  const getSession = vi.fn(async () => {
    await seedFixture()
    return repository.getSessionHeader(session.id)
  })
  let summarySequence = 0
  const service = new CompactionService({
    sessions: {
      getSessionHeader: getSession,
      async getSessionContextSource(request) {
        if (request.expectedRevision === undefined) await getSession()
        return repository.getSessionContextSource(request)
      },
      getSessionSettings: () => Promise.resolve(sessionSettings),
      async commitSessionCompaction(_sessionId, operation) {
        if (options.beforeUpdate) {
          session = options.beforeUpdate(session)
          await seedFixture()
        }
        const result = await repository.executeSessionCommand(session.id, { type: 'structure', operation })
        if (result.delta.structureResult?.applied) {
          const snapshot = (await rows.readSnapshot(session.id))!
          const exported = decodeSessionTree({ session: snapshot.record, ...snapshot.rows })
          if (!exported.ok) throw new Error(exported.reason)
          session = exported.session
        }
        return { applied: result.delta.structureResult?.applied === true, revision: result.delta.revision }
      },
    },
    settings: { getSettings: () => globalSettings },
    policy: {
      measure,
      getCompactionContext,
    },
    summaries: { generate },
    logger: options.logger,
    createId: () => (summarySequence++ ? `summary-message-${summarySequence}` : 'summary-message'),
    now: () => 123,
  })
  return {
    service,
    getSession,
    getCompactionContext,
    measure,
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
      selectTokenEstimationContext(
        { messages: session.candidateMessages, compactionPoints: session.compactionPoints },
        settings.maxContextMessageCount,
        pending
      )
    )
    const request = { kind: 'generation' as const, targetMessageId: 'target', retainedToolCallId: 'retained' }
    const result = await harness.service.run('session-1', request)
    expect(result).toMatchObject({ status: 'compacted', coverage: { ...request, boundaryMessageId: 'recent-user' } })
    // The prior summary leads the user turn after it as plain history, without a handoff directive.
    const summarized = harness.generate.mock.calls[0][0].messages
    expect(summarized.map((message) => message.id)).toEqual(['recent-user'])
    expect(summarized[0]).toMatchObject({
      role: 'user',
      contentParts: [
        { type: 'text', text: buildCompactionHandoff('old-summary', 'history').text },
        ...message('recent-user', 'user').contentParts,
      ],
    })
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

  test('appends a summary and exact boundary through an atomic row commit', async () => {
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

    expect(harness.measure).toHaveBeenCalledWith(expect.objectContaining({ pendingMessage }))
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

    expect(result.status, result.status === 'failed' ? result.failure.message : undefined).toBe('compacted')
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

  test('covers unlimited histories longer than 200 messages', async () => {
    const messages: Message[] = []
    for (let round = 1; round <= 130; round += 1) {
      messages.push(message(`u${round}`, 'user'))
      messages.push(message(`a${round}`, 'assistant'))
    }
    const harness = createHarness({ messages, maxContextMessageCount: Number.MAX_SAFE_INTEGER })

    const result = await harness.service.run('session-1', { kind: 'manual' })

    expect(result.status, result.status === 'failed' ? result.failure.message : undefined).toBe('compacted')
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
    expect(harness.measure).not.toHaveBeenCalled()
  })

  test('returns a structured failure and leaves message rows unchanged when summary generation fails', async () => {
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

test('decides automatic compaction once before starting feedback and reads fresh planning rows', async () => {
  const harness = createHarness()
  const onStart = vi.fn(() => {
    expect(harness.measure).toHaveBeenCalledOnce()
    expect(harness.service.isInProgress('session-1')).toBe(true)
    expect(harness.generate).not.toHaveBeenCalled()
  })
  const result = await harness.service.run('session-1', { kind: 'automatic' }, { onStart })
  expect(result.status).toBe('compacted')
  expect(onStart).toHaveBeenCalledOnce()
  // Decision, planning, then the size the compaction left.
  expect(harness.getSession).toHaveBeenCalledTimes(3)
})

test('does not start feedback when automatic compaction is unnecessary or cancelled during estimation', async () => {
  const harness = createHarness()
  const onStart = vi.fn()
  harness.measure.mockResolvedValueOnce({ tokens: budget.thresholdTokens, budget })
  await expect(harness.service.run('session-1', { kind: 'automatic' }, { onStart })).resolves.toEqual({
    status: 'skipped',
    reason: 'not_needed',
  })
  const controller = new AbortController()
  harness.measure.mockImplementationOnce(async () => {
    controller.abort()
    return overThreshold
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

test('measures the request overhead recorded from the last request', async () => {
  const harness = createHarness()
  harness.service.recordRequestOverhead('session-1', { toolTokens: 1_234.4, extraSystemTokens: 300 })

  await harness.service.needsCompaction('session-1')

  expect(harness.measure).toHaveBeenCalledWith(
    expect.objectContaining({ requestOverhead: { toolTokens: 1_235, extraSystemTokens: 300 } })
  )
})

test('subtracts only the instructions a host estimate already counted from the request overhead', () => {
  const overhead = { toolTokens: 500, extraSystemTokens: 2_000 }
  const memory = 'Remember the user prefers metric units. '.repeat(100)
  const memoryTokens = Math.ceil(memory.length / 4)

  expect(getRequestOverheadBeyond(overhead)).toBe(2_500)
  expect(getRequestOverheadBeyond(overhead, memory)).toBe(2_500 - memoryTokens)
  expect(getRequestOverheadBeyond(overhead, memory.repeat(10))).toBe(500)
})

test('waits for meaningful growth after a compaction that could not get below the threshold', async () => {
  const harness = createHarness()
  await expect(harness.service.run('session-1', { kind: 'automatic' })).resolves.toMatchObject({ status: 'compacted' })
  // The post-commit measurement recorded the compacted size: still above the threshold.
  expect(harness.measure).toHaveBeenLastCalledWith(expect.objectContaining({ pendingMessage: undefined }))

  harness.measure.mockResolvedValueOnce({ tokens: overThreshold.tokens + budget.minGrowthTokens - 1, budget })
  await expect(harness.service.needsCompaction('session-1')).resolves.toBe(false)

  harness.measure.mockResolvedValueOnce({ tokens: overThreshold.tokens + budget.minGrowthTokens, budget })
  await expect(harness.service.needsCompaction('session-1')).resolves.toBe(true)

  // A request that no longer fits the usable window compacts regardless.
  harness.measure.mockResolvedValueOnce({ tokens: budget.usableTokens + 1, budget })
  await expect(harness.service.needsCompaction('session-1')).resolves.toBe(true)
})

test('drops the growth baseline when the active path no longer ends past that compaction', async () => {
  const harness = createHarness()
  await harness.service.run('session-1', { kind: 'manual' })
  harness.measure.mockResolvedValueOnce({ tokens: overThreshold.tokens + 1, budget })
  await expect(harness.service.needsCompaction('session-1')).resolves.toBe(false)

  // Switching to another branch or thread leaves the compacted summary off the active path.
  Object.assign(harness.session, {
    messages: [message('system', 'system'), message('other-user', 'user'), message('other-assistant', 'assistant')],
    compactionPoints: undefined,
  })
  harness.measure.mockResolvedValueOnce({ tokens: overThreshold.tokens + 1, budget })
  await expect(harness.service.needsCompaction('session-1')).resolves.toBe(true)
})

test('drops the growth baseline when the model window changes', async () => {
  const harness = createHarness()
  await harness.service.run('session-1', { kind: 'manual' })
  const smaller = getCompactionBudget(8_192)!
  harness.measure.mockResolvedValueOnce({ tokens: smaller.thresholdTokens + 1, budget: smaller })
  await expect(harness.service.needsCompaction('session-1')).resolves.toBe(true)
})

test('does not carry a conversation compaction size across a generation compaction', async () => {
  const harness = createHarness()
  await harness.service.run('session-1', { kind: 'manual' })
  harness.measure.mockResolvedValueOnce({ tokens: overThreshold.tokens + 1, budget })
  await expect(harness.service.needsCompaction('session-1')).resolves.toBe(false)

  Object.assign(harness.session.messages[2], {
    generating: true,
    contentParts: [{ type: 'tool-call', state: 'call', toolCallId: 'current-tool', toolName: 'search', args: {} }],
  })
  await expect(
    harness.service.run('session-1', {
      kind: 'generation',
      targetMessageId: 'assistant',
      retainedToolCallId: 'current-tool',
    })
  ).resolves.toMatchObject({ status: 'compacted' })

  harness.measure.mockResolvedValueOnce({ tokens: overThreshold.tokens + 1, budget })
  await expect(harness.service.needsCompaction('session-1')).resolves.toBe(true)
})

describe('attachments of compacted history', () => {
  const report: MessageFile = {
    id: 'report',
    name: 'report.csv',
    fileType: 'text/csv',
    storageKey: 'parsed-report',
    lineCount: 1,
  }
  const notes: MessageFile = {
    id: 'notes',
    name: 'notes.txt',
    fileType: 'text/plain',
    storageKey: 'parsed-notes',
    lineCount: 1,
  }
  const contents: Record<string, string> = { 'parsed-report': 'REPORT ROWS', 'parsed-notes': 'NOTES BODY' }
  const attachmentResolver = { read: async (key: string) => contents[key] ?? null }
  const requestText = (messages: Message[]) =>
    messages
      .flatMap((entry) => entry.contentParts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))
      .join('\n')

  async function compactTwice() {
    const harness = createHarness({
      messages: [
        message('system', 'system'),
        { ...message('user-1', 'user'), files: [report] },
        message('assistant-1', 'assistant'),
        { ...message('user-2', 'user'), files: [notes] },
        message('assistant-2', 'assistant'),
      ],
    })
    await expect(harness.service.run('session-1', { kind: 'manual' })).resolves.toMatchObject({
      status: 'compacted',
      attachments: { compactedFiles: [report, notes] },
    })
    harness.session.messages.push(message('user-3', 'user'), message('assistant-3', 'assistant'))
    // The second summary covers the first one, whose attachments it carries forward.
    await expect(harness.service.run('session-1', { kind: 'manual' })).resolves.toMatchObject({ status: 'compacted' })
    return harness.session
  }

  const workspacePath = (file: MessageFile) => `input/${file.id}-${file.name}`

  test.each([
    [
      'file tools',
      { modelSupportToolUseForFile: true },
      [uploadedFileToolHint('parsed-report'), uploadedFileToolHint('parsed-notes')],
    ],
    [
      'the sandbox',
      { sandboxMode: true },
      [
        sandboxAttachmentRelPath('report.csv', sandboxAttachmentIdentity(report)),
        sandboxAttachmentRelPath('notes.txt', sandboxAttachmentIdentity(notes)),
      ],
    ],
    [
      'workspace tools',
      { workspacePath },
      [
        `<WORKSPACE_PATH>${workspacePath(report)}</WORKSPACE_PATH>`,
        `<WORKSPACE_PATH>${workspacePath(notes)}</WORKSPACE_PATH>`,
      ],
    ],
  ])('keeps their paths in the next request with %s', async (_label, policy, paths) => {
    const session = await compactTwice()
    const summary = session.messages.find((entry) => entry.id === session.compactionPoints?.at(-1)?.summaryMessageId)
    expect(summary).toMatchObject({ compactedFiles: [report, notes] })

    const request = await buildContext([...session.messages, message('next-user', 'user')], {
      compactionPoints: session.compactionPoints,
      attachmentResolver,
      ...policy,
    })

    const text = requestText(request)
    for (const path of paths) expect(text).toContain(path)
    expect(text).toContain('report.csv')
    expect(text).not.toContain('REPORT ROWS')
    expect(request.at(-1)).toMatchObject({ role: 'user' })
    expect(text).toContain('next-user')
  })

  test('names files without a path when no tool of the request can open them', async () => {
    const session = await compactTwice()

    const request = await buildContext([...session.messages, message('next-user', 'user')], {
      compactionPoints: session.compactionPoints,
      attachmentResolver,
    })

    const text = requestText(request)
    expect(text).toContain('<FILE_NAME>report.csv</FILE_NAME>')
    expect(text).toContain('<FILE_NAME>notes.txt</FILE_NAME>')
    expect(text).toContain('cannot be reopened')
    expect(text).not.toContain(uploadedFilePath('parsed-report'))
    expect(text).not.toContain('REPORT ROWS')
  })
})
