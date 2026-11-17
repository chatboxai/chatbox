import { SESSION_TOKEN_PAGE_MESSAGES } from '../../ports/session-token-cache'
import { describe, expect, test, vi } from 'vitest'
import { selectContextMessages } from '@shared/context/builder'
import { deriveMessageFacts, addSummaryRow, emptyThreadSummary } from '../../session/message-facts'
import type { MessageRow, ThreadRow } from '../../session/session-tree/types'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import type { Message } from '../../types'
import { createRowTokenPlan, readRowContextSource, readRowTokenPage, readRowContextPlan } from './row-context'

async function fixture(count = 80, compact = false) {
  const store = new InMemorySessionRowStore()
  const messages: Message[] = Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: index === 0 ? 'system' : index % 2 ? 'user' : 'assistant',
    timestamp: 100 + index,
    contentParts: [{ type: 'text', text: `Message ${index}` }],
  }))
  if (compact) messages[45] = { ...messages[45], role: 'assistant', isSummary: true }
  const points = compact ? [{ boundaryMessageId: 'm44', summaryMessageId: 'm45', createdAt: 150 }] : []
  const rows: MessageRow[] = messages.map((message, index) => ({
    sessionId: 's',
    threadId: 't',
    messageId: message.id,
    parentMessageId: index ? messages[index - 1].id : null,
    activeChildId: messages[index + 1]?.id ?? null,
    siblingOrder: 0,
    kind: message.isSummary ? 'summary' : 'message',
    status: 'settled',
    createdAt: message.timestamp!,
    updatedAt: message.timestamp!,
    branchId: null,
    selected: true,
    facts: deriveMessageFacts(message),
    message,
  }))
  const thread: ThreadRow = {
    sessionId: 's',
    threadId: 't',
    threadOrder: -1,
    name: 'Active',
    createdAt: 100,
    rootMessageId: 'm0',
    activeLeafMessageId: messages.at(-1)!.id,
    compactionPoints: points,
    summary: rows.reduce((sum, row) => addSummaryRow(sum, { ...row, facts: row.facts! }), emptyThreadSummary()),
    control: { generatingAssistantCount: 0 },
  }
  const record = {
    id: 's',
    name: 'Chat',
    storageFormat: 'rows' as const,
    rowFormatVersion: 3 as const,
    rowAuthority: 1 as const,
    activeThreadId: 't',
  }
  await store.writeRows({ record, revision: 1, rows: { sessionId: 's', threads: [thread], messages: rows } })
  return { store, messages, points, record, rows, thread }
}

describe('row context and independent token pages', () => {
  test('reads complete generation context in shared-size batches', async () => {
    const f = await fixture(SESSION_TOKEN_PAGE_MESSAGES * 2 + 7)
    const read = vi.spyOn(f.store, 'readMessages')
    const source = await readRowContextSource(f.store, { sessionId: 's', targetMessageId: f.messages.at(-1)!.id })
    expect(source?.candidateMessages).toEqual(f.messages.slice(0, -1))
    const batches = read.mock.calls.map(([request]) => request.messageIds)
    expect(batches.some((ids) => ids.length === SESSION_TOKEN_PAGE_MESSAGES)).toBe(true)
    expect(batches.every((ids) => ids.length <= SESSION_TOKEN_PAGE_MESSAGES)).toBe(true)
    expect(new Set(batches.flat())).toEqual(new Set(f.messages.map((message) => message.id)))
  })

  test.each([0, 20, 50, undefined])('token identities match send selection for history limit %s', async (limit) => {
    const f = await fixture(80, true)
    const read = vi.spyOn(f.store, 'readMessages')
    const plan = await createRowTokenPlan(f.store, { sessionId: 's', maxContextMessageCount: limit })
    const draft: Message = { id: 'draft', role: 'user', contentParts: [] }
    const expected = selectContextMessages([...f.messages, draft], {
      compactionPoints: f.points,
      maxContextMessageCount: limit,
    })
      .filter((m) => m !== draft)
      .map((m) => m.id)
    expect(plan?.messageIds).toEqual(expected)
    expect(read).not.toHaveBeenCalled()
  })

  test('token body reads are isolated pages and reject a changed revision', async () => {
    const f = await fixture(80)
    const plan = await createRowTokenPlan(f.store, { sessionId: 's' })
    expect(plan).not.toBeNull()
    const read = vi.spyOn(f.store, 'readMessages')
    const first = await readRowTokenPage(f.store, {
      plan: plan!,
      cacheKey: 'history-breakdown-v1:test',
      offset: 0,
      limit: 16,
    })
    expect(first.messages).toHaveLength(16)
    expect(first.nextOffset).toBe(16)
    expect(read.mock.calls[0][0].messageIds).toHaveLength(16)
    await f.store.applyDiff(
      { sessionId: 's', messages: { upsert: [], delete: [] }, threads: { upsert: [], delete: [] } },
      { record: f.record, revision: 2 },
      1
    )
    await expect(
      readRowTokenPage(f.store, { plan: plan!, cacheKey: 'history-breakdown-v1:test', offset: 16, limit: 16 })
    ).rejects.toMatchObject({
      name: 'SessionRowConflictError',
    })
  })

  test('compacted generation reads no prefix bodies while retaining original path facts', async () => {
    const f = await fixture(60, true)
    const read = vi.spyOn(f.store, 'readMessages')
    const source = await readRowContextSource(f.store, { sessionId: 's', targetMessageId: 'm59' })
    expect(source?.mode).toBe('compacted')
    expect(source?.beforeTarget.userMessageCount).toBe(28)
    expect(source?.beforeTarget.lastUserMessageId).toBe('m57')
    const ids = read.mock.calls.flatMap(([request]) => request.messageIds)
    expect(ids).not.toContain('m1')
    expect(ids).toContain('m44')
    expect(ids).toContain('m59')
    expect(selectContextMessages(source!.candidateMessages, { compactionPoints: f.points }).map((m) => m.id)).toEqual(
      selectContextMessages(f.messages.slice(0, -1), { compactionPoints: f.points }).map((m) => m.id)
    )
  })

  test.each([false, true])('reads only a bounded send window from large history (compacted=%s)', async (compact) => {
    const f = await fixture(1601, compact)
    const read = vi.spyOn(f.store, 'readMessages')
    const source = await readRowContextSource(f.store, {
      sessionId: 's',
      targetMessageId: 'm1600',
      maxContextMessageCount: 20,
    })
    const expected = selectContextMessages(f.messages.slice(0, -1), {
      compactionPoints: f.points,
      maxContextMessageCount: 20,
    })
    expect(
      selectContextMessages(source!.candidateMessages, {
        compactionPoints: f.points,
        maxContextMessageCount: 20,
      })
    ).toEqual(expected)
    const ids = read.mock.calls.flatMap(([request]) => request.messageIds)
    expect(new Set(ids)).toEqual(new Set([...expected.map((message) => message.id), 'm1600']))
    expect(ids.length).toBeLessThanOrEqual(23)
    expect(source?.pathMessageIds).toHaveLength(1600)
    expect(source?.beforeTarget.userMessageCount).toBe(compact ? 799 : 800)
  })

  test.each([0, 20])('reserves a pending current input before reading compression bodies (limit=%s)', async (limit) => {
    const f = await fixture(1600, true)
    const read = vi.spyOn(f.store, 'readMessages')
    const draft: Message = { id: 'draft', role: 'user', contentParts: [] }
    const source = await readRowContextSource(f.store, {
      sessionId: 's',
      maxContextMessageCount: limit,
      reserveCurrentInput: true,
    })
    const options = { compactionPoints: f.points, maxContextMessageCount: limit }
    const expected = selectContextMessages([...f.messages, draft], options).filter((message) => message !== draft)
    expect(
      selectContextMessages([...source!.candidateMessages, draft], options).filter((message) => message !== draft)
    ).toEqual(expected)
    expect(read.mock.calls.flatMap(([request]) => request.messageIds)).toEqual(expected.map((message) => message.id))
  })

  test.each([false, true])('selects legacy steering across a summary before body reads (resume=%s)', async (resume) => {
    const f = await fixture(60, true)
    f.rows[44].message.finishReason = 'stop'
    f.rows[46].message.role = 'user'
    f.rows[46].message.steered = true
    f.rows[59].message.role = 'assistant'
    f.rows[59].message.generating = true
    f.rows[59].status = 'generating'
    for (const row of f.rows) row.facts = deriveMessageFacts(row.message)
    await f.store.writeRows(
      { record: f.record, revision: 2, rows: { sessionId: 's', threads: [f.thread], messages: f.rows } },
      1
    )
    const read = vi.spyOn(f.store, 'readMessages')
    const source = await readRowContextSource(f.store, {
      sessionId: 's',
      targetMessageId: 'm59',
      includeTarget: resume,
      maxContextMessageCount: 20,
    })
    const forModel = (messages: Message[]) =>
      messages.map((message) => (resume && message.id === 'm59' ? { ...message, generating: false } : message))
    const options = { compactionPoints: f.points, maxContextMessageCount: 20 }
    const expected = selectContextMessages(
      forModel(f.rows.slice(0, resume ? undefined : -1).map((row) => row.message)),
      options
    )
    expect(selectContextMessages(forModel(source!.candidateMessages), options)).toEqual(expected)
    expect(source!.candidateMessages.some((message) => message.id === 'm59')).toBe(resume)
    const ids = read.mock.calls.flatMap(([request]) => request.messageIds)
    expect(ids).not.toContain('m46')
    expect(new Set(ids)).toEqual(new Set([...expected.map((message) => message.id), 'm44', 'm59']))
  })

  test.each([undefined, Number.MAX_SAFE_INTEGER])('preserves explicitly unlimited send history (%s)', async (limit) => {
    const f = await fixture(120)
    const read = vi.spyOn(f.store, 'readMessages')
    const source = await readRowContextSource(f.store, { sessionId: 's', maxContextMessageCount: limit })
    expect(source?.candidateMessages).toEqual(f.messages)
    expect(read.mock.calls.flatMap(([request]) => request.messageIds)).toHaveLength(120)
  })

  test('an inactive target follows its own ancestors, irrespective of sibling sequence labels', async () => {
    const f = await fixture(4)
    const branch: MessageRow = {
      ...f.rows[2],
      messageId: 'inactive',
      parentMessageId: 'm1',
      activeChildId: null,
      siblingOrder: 1,
      selected: false,
      branchId: 'other',
      message: { ...f.messages[2], id: 'inactive' },
    }
    await f.store.writeRows(
      { record: f.record, revision: 2, rows: { sessionId: 's', threads: [f.thread], messages: [...f.rows, branch] } },
      1
    )
    const plan = await readRowContextPlan(f.store, { sessionId: 's', targetMessageId: 'inactive' })
    expect(plan?.entries.map((entry) => entry.id)).toEqual(['m0', 'm1'])
    const source = await readRowContextSource(f.store, {
      sessionId: 's',
      targetMessageId: 'inactive',
      includeTarget: true,
    })
    expect(source?.candidateMessages.map((message) => message.id)).toEqual(['m0', 'm1', 'inactive'])
  })

  test('metadata selection preserves errors, legacy steering and orphan summary exclusions', async () => {
    const f = await fixture(8, false)
    f.rows[2].message.finishReason = 'stop'
    f.rows[3].message.steered = true
    f.rows[4].message.error = 'failed'
    f.rows[5].message.isSummary = true
    f.rows[5].kind = 'summary'
    for (const row of f.rows) row.facts = deriveMessageFacts(row.message)
    await f.store.writeRows(
      { record: f.record, revision: 2, rows: { sessionId: 's', threads: [f.thread], messages: f.rows } },
      1
    )
    const plan = await createRowTokenPlan(f.store, { sessionId: 's' })
    expect(plan?.messageIds).toEqual(
      selectContextMessages(f.rows.map((row) => row.message)).map((message) => message.id)
    )
    expect(plan?.messageIds).not.toContain('m4')
    expect(plan?.messageIds).not.toContain('m5')
  })
})
