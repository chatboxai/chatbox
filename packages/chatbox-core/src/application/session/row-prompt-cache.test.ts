import { describe, expect, it, vi } from 'vitest'
import type { Message, Session } from '../../types'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import { RowBackedSessionRepository } from './RowBackedSessionRepository'
import { SessionRowWriteQueue } from './SessionRowWriteQueue'
const message = (id: string, role: Message['role'], chars = 10, extra: Partial<Message> = {}): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: 'x'.repeat(chars) }],
  ...extra,
})
async function fixture(messages: Message[], compactionPoints?: Session['compactionPoints']) {
  const records = new InMemorySessionRecordStore()
  const rows = new InMemorySessionRowStore()
  await records.setRecord({ id: 's', name: 'Fixture', messages, compactionPoints })
  const repo = new RowBackedSessionRepository({
    records,
    rows,
    writes: new SessionRowWriteQueue((_id, run) => run()),
  })
  await repo.getSessionHeader('s')
  const read = vi.spyOn(rows, 'readMessages')
  const snapshot = vi.spyOn(rows, 'readSnapshot')
  return { repo, read, snapshot }
}
const pairs = [
  message('system', 'system'),
  message('u', 'user', 5000),
  message('a', 'assistant'),
  message('last', 'user'),
]
describe('row prompt-cache policy', () => {
  it.each([
    ['first user turn', [message('u', 'user', 5000)], false],
    ['cached prefix', pairs, true],
    ['system-only length', [message('s', 'system', 5000), message('u', 'user'), message('a', 'assistant')], false],
    ['in-flight prefix', [message('u', 'user', 5000), message('a', 'assistant', 0, { generating: true })], true],
    [
      'queued future turn',
      [message('u', 'user'), message('a', 'assistant', 0, { generating: true }), message('future', 'user', 5000)],
      false,
    ],
    [
      'fork marker',
      [message('marker', 'user', 5000, { isForkMarker: true }), message('u', 'user'), message('a', 'assistant')],
      false,
    ],
    [
      'tool history',
      [
        message('u', 'user'),
        message('tool', 'assistant', 0, {
          contentParts: [
            { type: 'tool-call', state: 'result', toolCallId: 'call', toolName: 'lookup', args: {}, result: {} },
          ],
        }),
      ],
      true,
    ],
  ] as const)('matches policy for %s using metadata only', async (_name, input, expected) => {
    const f = await fixture([...input])
    expect(await f.repo.readSessionPromptCacheDecision({ sessionId: 's', mode: 'work' })).toBe(expected)
    expect(f.read).not.toHaveBeenCalled()
    expect(f.snapshot).not.toHaveBeenCalled()
  })
  it('keeps chat-mode edits free of cache confirmation', async () => {
    const f = await fixture(pairs)
    expect(await f.repo.readSessionPromptCacheDecision({ sessionId: 's', mode: 'chat' })).toBe(false)
  })
  it('checks the selected provider context and latest-message deletion rule', async () => {
    const f = await fixture(pairs)
    expect(
      await f.repo.readSessionPromptCacheDecision({
        sessionId: 's',
        mode: 'work',
        deletion: { messageId: 'u', target: 'message' },
      })
    ).toBe(true)
    expect(
      await f.repo.readSessionPromptCacheDecision({
        sessionId: 's',
        mode: 'work',
        deletion: { messageId: 'last', target: 'message' },
      })
    ).toBe(false)
    expect(
      await f.repo.readSessionPromptCacheDecision({
        sessionId: 's',
        mode: 'work',
        maxContextMessageCount: 0,
        deletion: { messageId: 'u', target: 'message' },
      })
    ).toBe(false)
    expect(f.read).not.toHaveBeenCalled()
  })
  it('recognizes compaction and summary deletion from row identities', async () => {
    const input = [
      message('u', 'user'),
      message('summary', 'assistant', 10, { isSummary: true }),
      message('last', 'user'),
    ]
    const f = await fixture(input, [{ boundaryMessageId: 'u', summaryMessageId: 'summary', createdAt: 1 }])
    expect(await f.repo.readSessionPromptCacheDecision({ sessionId: 's', mode: 'work' })).toBe(true)
    expect(
      await f.repo.readSessionPromptCacheDecision({
        sessionId: 's',
        mode: 'work',
        deletion: { messageId: 'summary', target: 'summary' },
      })
    ).toBe(true)
    expect(f.read).not.toHaveBeenCalled()
  })
  it('reads only the nearest previous user body for a target', async () => {
    const f = await fixture([...pairs, message('reply', 'assistant')])
    expect((await f.repo.readPreviousUserMessage('s', 'reply'))?.id).toBe('last')
    expect(f.read.mock.calls.map(([request]) => request.messageIds)).toEqual([['last']])
    expect(f.snapshot).not.toHaveBeenCalled()
  })
})
