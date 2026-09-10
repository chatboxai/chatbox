import { selectContextMessages } from '@shared/context'
import { describe, expect, test, vi } from 'vitest'
import type { LoggerPort } from '../../ports'
import type { Message, Session, SessionSettings, Settings } from '../../types'
import { CompactionService } from './CompactionService'

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
  const shouldCompact = vi.fn(() => Promise.resolve(true))
  const generate = vi.fn(
    (input: {
      onStreamUpdate?: (text: string) => void
    }): Promise<{ success: boolean; summary?: string; error?: Error }> => {
      input.onStreamUpdate?.('streaming summary')
      return Promise.resolve({ success: true, summary: 'Final summary' })
    }
  )
  const service = new CompactionService({
    sessions: {
      getSession: () => Promise.resolve(session),
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
      getCompactionContext: (current: Session) => current.messages,
    },
    summaries: { generate },
    logger: options.logger,
    createId: () => 'summary-message',
    now: () => 123,
  })
  return {
    service,
    shouldCompact,
    generate,
    get session() {
      return session
    },
  }
}

describe('CompactionService', () => {
  test('uses the saved prompt for automatic compaction', async () => {
    const harness = createHarness({ compactionPrompt: 'Preserve decisions and file paths.' })
    await harness.service.run('session-1')
    expect(harness.generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Preserve decisions and file paths.' })
    )
  })

  test('keeps a manual prompt override scoped to one run', async () => {
    const harness = createHarness({ compactionPrompt: 'Saved instructions' })
    await harness.service.run('session-1', { force: true, prompt: 'One-time instructions' })
    expect(harness.generate).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'One-time instructions' }))
    await harness.service.run('session-1', { force: true })
    expect(harness.generate).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'Saved instructions' }))
  })

  test('appends a summary and exact boundary through an atomic Session update', async () => {
    const harness = createHarness()
    const streamUpdates: string[] = []

    const result = await harness.service.run('session-1', {
      onStreamUpdate: (text) => streamUpdates.push(text),
    })

    expect(result).toMatchObject({ success: true, compacted: true })
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

    const result = await harness.service.run('session-1', { force: true })

    expect(result).toMatchObject({ success: true, compacted: true })
    expect(harness.session.compactionPoints?.[0]).toMatchObject({ boundaryMessageId: 'a3' })
    expect(harness.session.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'summary-message'])

    // The summarizer saw only the covered range, with the tool call flattened to text.
    const summaryInput = harness.generate.mock.calls[0][0] as unknown as { messages: Message[] }
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

    const result = await harness.service.run('session-1', { force: true })

    expect(result).toMatchObject({ success: true, compacted: true })
    expect(harness.session.compactionPoints?.[0]).toMatchObject({ boundaryMessageId: 'a130' })
    const summaryInput = harness.generate.mock.calls[0][0] as unknown as { messages: Message[] }
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

    await expect(harness.service.run('session-1', { force })).resolves.toMatchObject({
      success: true,
      compacted: true,
    })
    expect(harness.session.compactionPoints?.[0].boundaryMessageId).toBe('a4')
    expect(
      selectContextMessages(harness.session.messages, {
        compactionPoints: harness.session.compactionPoints,
      }).map((item) => item.id)
    ).toEqual(['system', 'summary-message', 'new-user'])
    const summaryInput = harness.generate.mock.calls[0][0] as unknown as { messages: Message[] }
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

    const result = await harness.service.run('session-1', { force: true })

    expect(result).toMatchObject({
      success: false,
      compacted: false,
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

    const result = await harness.service.run('session-1', { force: true })

    expect(result).toEqual({ success: true, compacted: false })
    expect(log).toHaveBeenCalledWith(
      'warn',
      'Compaction boundary message disappeared during summary streaming; compaction abandoned',
      { sessionId: 'session-1', boundaryMessageId: 'assistant' }
    )
  })
})
