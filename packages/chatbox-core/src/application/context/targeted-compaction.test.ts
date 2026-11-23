import { selectContextMessages } from '@shared/context'
import { describe, expect, test, vi } from 'vitest'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { CompactionPoint, Message, Session, SessionSettings, Settings } from '../../types'
import { CompactionService, type CompactionSummaryPort } from './CompactionService'

const SESSION_ID = 'session-1'

function message(id: string, role: Message['role'], overrides: Partial<Message> = {}): Message {
  return { id, role, contentParts: [{ type: 'text', text: `text of ${id}` }], ...overrides }
}

function summary(id: string): Message {
  return { id, role: 'assistant', contentParts: [{ type: 'text', text: `summary ${id}` }], isSummary: true }
}

function conversation(...ids: string[]): Message[] {
  return ids.map((id) => message(id, id.startsWith('u') ? 'user' : 'assistant'))
}

/** The summarizer saw these messages, by their text. */
function summarizedTexts(generate: ReturnType<typeof vi.fn<CompactionSummaryPort['generate']>>): string[] {
  const input = generate.mock.calls[0]?.[0]
  return (input?.messages ?? []).map((m) =>
    m.contentParts.map((part) => (part.type === 'text' ? part.text : '')).join('')
  )
}

function createHarness(
  session: Omit<Session, 'id' | 'name'>,
  options: {
    maxContextMessageCount?: number
    /** Runs while the summary streams, before the commit. */
    duringSummary?: (repository: InMemorySessionRepository) => Promise<void>
    summary?: Awaited<ReturnType<CompactionSummaryPort['generate']>>
  } = {}
) {
  const repository = new InMemorySessionRepository()
  const sessionSettings: SessionSettings = {
    provider: 'openai',
    modelId: 'gpt-4.1',
    maxContextMessageCount: options.maxContextMessageCount,
  }
  const globalSettings = { language: 'en', defaultChatModel: { provider: 'openai', model: 'gpt-4.1' } } as Settings
  const generate = vi.fn<CompactionSummaryPort['generate']>(async () => {
    await options.duringSummary?.(repository)
    return options.summary ?? { success: true, summary: 'Targeted summary' }
  })
  let sequence = 0
  const service = new CompactionService({
    sessions: {
      getSessionHeader: (sessionId) => repository.getSessionHeader(sessionId),
      getSessionContextSource: (request) => repository.getSessionContextSource(request),
      getSessionSettings: () => Promise.resolve(sessionSettings),
      async commitSessionCompaction(sessionId, operation) {
        const { delta } = await repository.executeSessionCommand(sessionId, { type: 'structure', operation })
        return { applied: delta.structureResult?.applied === true, revision: delta.revision }
      },
    },
    settings: { getSettings: () => globalSettings },
    policy: {
      measure: () => Promise.resolve(null),
      // The renderer's selection: the send window with the current-input slot reserved.
      getCompactionContext(source, settings) {
        const currentInput: Message = { id: 'compaction-current-input', role: 'user', contentParts: [] }
        return selectContextMessages([...source.candidateMessages, currentInput], {
          compactionPoints: source.compactionPoints,
          maxContextMessageCount: settings.maxContextMessageCount,
        }).filter((m) => m.id !== currentInput.id)
      },
    },
    summaries: { generate },
    createId: () => `new-summary-${++sequence}`,
    now: () => 1_000,
  })
  const seeded = { id: SESSION_ID, name: 'Targeted', ...session } as Session
  return {
    repository,
    generate,
    seed: () => repository.seedSession(seeded),
    compactAt: (targetMessageId: string, abortSignal?: AbortSignal) =>
      service.run(SESSION_ID, { kind: 'targeted', targetMessageId }, { prompt: 'Summarize', abortSignal }),
    inspect: () => repository.inspectSession(SESSION_ID)!,
    /** What the next request on the active path would send. */
    activeContextIds: () => {
      const current = repository.inspectSession(SESSION_ID)!
      return selectContextMessages(current.messages, { compactionPoints: current.compactionPoints }).map((m) => m.id)
    },
  }
}

describe('targeted compaction', () => {
  test('summarizes the conversation through the target and inserts the point right after it', async () => {
    const messages = conversation('u1', 'a1', 'u2', 'a2', 'u3', 'a3')
    const harness = createHarness({ messages })
    await harness.seed()

    const result = await harness.compactAt('a2')

    expect(result).toMatchObject({
      status: 'compacted',
      summaryMessageId: 'new-summary-1',
      coverage: { kind: 'targeted', boundaryMessageId: 'a2' },
    })
    expect(summarizedTexts(harness.generate)).toEqual(['text of u1', 'text of a1', 'text of u2', 'text of a2'])
    const session = harness.inspect()
    expect(session.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'new-summary-1', 'u3', 'a3'])
    expect(session.messages.slice(5)).toEqual(messages.slice(4))
    expect(session.compactionPoints).toEqual([
      { summaryMessageId: 'new-summary-1', boundaryMessageId: 'a2', createdAt: 1_000 },
    ])
    expect(harness.activeContextIds()).toEqual(['new-summary-1', 'u3', 'a3'])
  })

  test('compacts only the first message when it is the target', async () => {
    const harness = createHarness({ messages: conversation('u1', 'a1', 'u2') })
    await harness.seed()

    expect((await harness.compactAt('u1')).status).toBe('compacted')

    expect(summarizedTexts(harness.generate)).toEqual(['text of u1'])
    expect(harness.inspect().messages.map((m) => m.id)).toEqual(['u1', 'new-summary-1', 'a1', 'u2'])
    expect(harness.activeContextIds()).toEqual(['new-summary-1', 'a1', 'u2'])
  })

  test('ends the conversation with the summary when the last message is the target', async () => {
    const harness = createHarness({ messages: conversation('u1', 'a1') })
    await harness.seed()

    expect((await harness.compactAt('a1')).status).toBe('compacted')

    expect(harness.inspect().messages.map((m) => m.id)).toEqual(['u1', 'a1', 'new-summary-1'])
    expect(harness.activeContextIds()).toEqual(['new-summary-1'])
  })

  test('keeps the system prompt out of the boundary and in front of later context', async () => {
    const harness = createHarness({ messages: [message('sys', 'system'), ...conversation('u1', 'a1', 'u2')] })
    await harness.seed()

    expect((await harness.compactAt('a1')).status).toBe('compacted')

    expect(harness.activeContextIds()).toEqual(['sys', 'new-summary-1', 'u2'])
  })

  test('folds an earlier summary into the new one instead of the messages it already covers', async () => {
    const earlier: CompactionPoint = { summaryMessageId: 's1', boundaryMessageId: 'a1', createdAt: 10 }
    const harness = createHarness({
      messages: [...conversation('u1', 'a1'), summary('s1'), ...conversation('u2', 'a2', 'u3', 'a3')],
      compactionPoints: [earlier],
    })
    await harness.seed()

    expect((await harness.compactAt('a2')).status).toBe('compacted')

    const summarized = summarizedTexts(harness.generate).join('\n')
    expect(summarized).toContain('summary s1')
    expect(summarized).toContain('text of u2')
    expect(summarized).toContain('text of a2')
    expect(summarized).not.toContain('text of u1')
    expect(summarized).not.toContain('text of a1')
    const session = harness.inspect()
    expect(session.messages.map((m) => m.id)).toEqual(['u1', 'a1', 's1', 'u2', 'a2', 'new-summary-1', 'u3', 'a3'])
    expect(session.compactionPoints).toEqual([
      earlier,
      { summaryMessageId: 'new-summary-1', boundaryMessageId: 'a2', createdAt: 1_000 },
    ])
    expect(harness.activeContextIds()).toEqual(['new-summary-1', 'u3', 'a3'])
  })

  test('refuses a target an existing summary already follows, without summarizing', async () => {
    const harness = createHarness({
      messages: [...conversation('u1', 'a1'), summary('s1'), ...conversation('u2')],
      compactionPoints: [{ summaryMessageId: 's1', boundaryMessageId: 'a1', createdAt: 10 }],
    })
    await harness.seed()
    const before = harness.inspect()

    expect(await harness.compactAt('a1')).toEqual({ status: 'skipped', reason: 'stale_path' })

    expect(harness.generate).not.toHaveBeenCalled()
    expect(harness.inspect()).toEqual(before)
  })

  test('refuses a target before a later compaction point, which would summarize that prefix twice', async () => {
    const harness = createHarness({
      messages: [...conversation('u1', 'a1', 'u2', 'a2'), summary('s1'), ...conversation('u3')],
      compactionPoints: [{ summaryMessageId: 's1', boundaryMessageId: 'a2', createdAt: 10 }],
    })
    await harness.seed()
    const before = harness.inspect()

    expect(await harness.compactAt('a1')).toEqual({ status: 'skipped', reason: 'stale_path' })

    expect(harness.inspect()).toEqual(before)
    expect(harness.activeContextIds()).toEqual(['s1', 'u3'])
  })

  test('refuses a target whose subtree holds a compaction point on another branch', async () => {
    // Branch x (stored) carries its own summary below the fork at u1; inserting a summary after u1 would move
    // branch x under a summary that repeats part of s-x's prefix.
    const harness = createHarness({
      messages: [...conversation('u1', 'a1-y')],
      messageForksHash: {
        u1: {
          position: 1,
          createdAt: 1,
          lists: [
            { id: 'list-x', messages: [message('a1-x', 'assistant'), summary('s-x'), message('u2-x', 'user')] },
            { id: 'list-y', messages: [] },
          ],
        },
      },
      compactionPoints: [{ summaryMessageId: 's-x', boundaryMessageId: 'a1-x', createdAt: 10 }],
    })
    await harness.seed()
    const before = harness.inspect()

    expect(await harness.compactAt('u1')).toEqual({ status: 'skipped', reason: 'stale_path' })

    expect(harness.inspect()).toEqual(before)
  })

  test('respects the message-count limit of the send window it replaces', async () => {
    const harness = createHarness(
      { messages: conversation('u1', 'a1', 'u2', 'a2', 'u3', 'a3') },
      { maxContextMessageCount: 2 }
    )
    await harness.seed()

    expect((await harness.compactAt('a2')).status).toBe('compacted')

    // The reserved current-input slot plus the last two messages through the target.
    expect(summarizedTexts(harness.generate)).toEqual(['text of u2', 'text of a2'])
  })

  describe('branches', () => {
    const forked = (): Omit<Session, 'id' | 'name'> => ({
      messages: conversation('u1', 'a1-y', 'u2-y', 'a2-y'),
      messageForksHash: {
        u1: {
          position: 1,
          createdAt: 1,
          lists: [
            { id: 'list-x', messages: conversation('a1-x', 'u2-x', 'a2-x') },
            { id: 'list-y', messages: [] },
          ],
        },
      },
    })

    test('compacts the visible branch and leaves the stored branch untouched', async () => {
      const harness = createHarness(forked())
      await harness.seed()
      const storedBefore = harness.inspect().messageForksHash?.u1.lists[0]

      expect((await harness.compactAt('u2-y')).status).toBe('compacted')

      expect(summarizedTexts(harness.generate)).toEqual(['text of u1', 'text of a1-y', 'text of u2-y'])
      const session = harness.inspect()
      expect(session.messages.map((m) => m.id)).toEqual(['u1', 'a1-y', 'u2-y', 'new-summary-1', 'a2-y'])
      expect(session.messageForksHash?.u1.lists[0]).toEqual(storedBefore)
    })

    test('keeps every branch below a shared-prefix target under the new summary', async () => {
      const harness = createHarness(forked())
      await harness.seed()

      expect((await harness.compactAt('u1')).status).toBe('compacted')

      const session = harness.inspect()
      expect(session.messages.map((m) => m.id)).toEqual(['u1', 'new-summary-1', 'a1-y', 'u2-y', 'a2-y'])
      const lists = Object.values(session.messageForksHash ?? {}).flatMap((fork) => fork.lists)
      expect(lists.flatMap((list) => list.messages.map((m) => m.id))).toEqual(['a1-x', 'u2-x', 'a2-x'])
    })

    test('a branch switch while summarizing places the summary in the stored branch and keeps the visible one', async () => {
      const switched: Omit<Session, 'id' | 'name'> = {
        messages: conversation('u1', 'a1-x', 'u2-x', 'a2-x'),
        messageForksHash: {
          u1: {
            position: 0,
            createdAt: 1,
            lists: [
              { id: 'list-x', messages: [] },
              { id: 'list-y', messages: conversation('a1-y', 'u2-y', 'a2-y') },
            ],
          },
        },
      }
      const harness = createHarness(forked(), {
        duringSummary: (repository) =>
          repository.seedSession({ id: SESSION_ID, name: 'Targeted', ...switched } as Session),
      })
      await harness.seed()

      expect((await harness.compactAt('u2-y')).status).toBe('compacted')

      const session = harness.inspect()
      expect(session.messages).toEqual(switched.messages)
      expect(session.messageForksHash?.u1.lists[1].messages.map((m) => m.id)).toEqual([
        'a1-y',
        'u2-y',
        'new-summary-1',
        'a2-y',
      ])
      expect(harness.activeContextIds()).toEqual(['u1', 'a1-x', 'u2-x', 'a2-x'])
    })
  })

  describe('stale or invalid targets', () => {
    test('skips a target that no longer exists', async () => {
      const harness = createHarness({ messages: conversation('u1', 'a1') })
      await harness.seed()

      expect(await harness.compactAt('deleted')).toEqual({ status: 'skipped', reason: 'stale_path' })
      expect(harness.generate).not.toHaveBeenCalled()
    })

    test('abandons the summary when the target is deleted while it streams', async () => {
      const harness = createHarness(
        { messages: conversation('u1', 'a1', 'u2', 'a2') },
        {
          duringSummary: (repository) =>
            repository.seedSession({ id: SESSION_ID, name: 'Targeted', messages: conversation('u1', 'u2', 'a2') }),
        }
      )
      await harness.seed()

      expect(await harness.compactAt('a1')).toEqual({ status: 'skipped', reason: 'stale_path' })

      const session = harness.inspect()
      expect(session.messages.map((m) => m.id)).toEqual(['u1', 'u2', 'a2'])
      expect(session.compactionPoints ?? []).toEqual([])
    })

    test('abandons the summary when a message it covers is deleted while it streams', async () => {
      const harness = createHarness(
        { messages: conversation('u1', 'a1', 'u2', 'a2') },
        {
          duringSummary: (repository) =>
            repository.seedSession({ id: SESSION_ID, name: 'Targeted', messages: conversation('u1', 'u2', 'a2') }),
        }
      )
      await harness.seed()

      expect(await harness.compactAt('u2')).toEqual({ status: 'skipped', reason: 'stale_path' })

      expect(harness.inspect().messages.map((m) => m.id)).toEqual(['u1', 'u2', 'a2'])
    })

    test('keeps a reply that arrives while summarizing after the new summary', async () => {
      const harness = createHarness(
        { messages: conversation('u1', 'a1') },
        {
          duringSummary: (repository) =>
            repository.seedSession({
              id: SESSION_ID,
              name: 'Targeted',
              messages: conversation('u1', 'a1', 'u2', 'a2'),
            }),
        }
      )
      await harness.seed()

      expect((await harness.compactAt('a1')).status).toBe('compacted')

      expect(harness.inspect().messages.map((m) => m.id)).toEqual(['u1', 'a1', 'new-summary-1', 'u2', 'a2'])
      expect(harness.activeContextIds()).toEqual(['new-summary-1', 'u2', 'a2'])
    })

    test.each([
      ['a generating reply', message('a1', 'assistant', { generating: true })],
      ['a failed reply', message('a1', 'assistant', { error: 'boom' })],
      ['a summary', summary('a1')],
      ['a system prompt', message('a1', 'system')],
    ])('refuses %s as the target without summarizing', async (_label, target) => {
      const harness = createHarness({ messages: [message('u1', 'user'), target] })
      await harness.seed()
      const before = harness.inspect()

      expect(await harness.compactAt('a1')).toEqual({ status: 'skipped', reason: 'stale_path' })

      expect(harness.generate).not.toHaveBeenCalled()
      expect(harness.inspect()).toEqual(before)
    })
  })

  test('leaves the conversation unchanged when the summary fails', async () => {
    const harness = createHarness(
      { messages: conversation('u1', 'a1', 'u2') },
      { summary: { success: false, error: new Error('provider down') } }
    )
    await harness.seed()
    const before = harness.inspect()

    expect(await harness.compactAt('a1')).toMatchObject({
      status: 'failed',
      failure: { code: 'summary_failed', message: 'provider down' },
    })
    expect(harness.inspect()).toEqual(before)
  })

  test('leaves the conversation unchanged when cancelled while summarizing', async () => {
    const controller = new AbortController()
    const harness = createHarness(
      { messages: conversation('u1', 'a1', 'u2') },
      {
        duringSummary: async () => {
          controller.abort()
        },
      }
    )
    await harness.seed()
    const before = harness.inspect()

    const outcome = await harness.compactAt('a1', controller.signal)

    expect(outcome).toEqual({ status: 'cancelled' })
    expect(harness.inspect()).toEqual(before)
  })
})
