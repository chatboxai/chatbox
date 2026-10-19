import { describe, expect, it, vi, type Mock } from 'vitest'
import type { SessionKnownMessageMetadata, SessionMessageRelationsSelector } from '../../ports/session-row-relations'
import { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from '../../session/message-facts'
import type { MessageRow, SessionRowRecord, ThreadRow } from '../../session/session-tree/types'
import type { Message } from '../../types'
import { planForkStructure } from './session-fork-command'
import { planMessageStructure } from './session-message-structure'
import { newMessageRow, type StructureCommandReader } from './session-structure-plan'
import { planThreadStructure } from './session-thread-command'
import { deriveSessionGenerationControl } from './session-generation-control'

const message = (id: string, role: Message['role'] = 'assistant'): Message => ({
  id,
  role,
  timestamp: 1,
  contentParts: [{ type: 'text', text: id }],
})
const record: SessionRowRecord = {
  id: 's',
  name: 'Session',
  storageFormat: 'rows',
  rowFormatVersion: 3,
  rowAuthority: 1,
  activeThreadId: 'active',
  settings: { provider: 'openai', modelId: 'model' },
}
const row = (
  id: string,
  parent: string | null,
  child: string | null,
  seq = 0,
  extra: Partial<MessageRow> = {}
): MessageRow => ({
  ...newMessageRow('s', 'active', message(id), parent, seq),
  activeChildId: child,
  selected: true,
  ...extra,
})
const identity = { seedListId: 'seed', storedListId: 'stored', newListId: 'new', createdAt: 42 }

function fixture(
  rows: MessageRow[],
  additional: ThreadRow[] = []
): StructureCommandReader & {
  messages: Mock<StructureCommandReader['messages']>
  metadata: Mock<StructureCommandReader['metadata']>
  relations: Mock<StructureCommandReader['relations']>
} {
  const metadata = rows.map(
    ({ message: body, ...value }): SessionKnownMessageMetadata => ({
      ...value,
      facts: deriveMessageFacts(body),
      selected: value.selected ?? false,
    })
  )
  let summary = emptyThreadSummary()
  for (const value of metadata.filter((value) => value.threadId === 'active' && value.selected))
    summary = addSummaryRow(summary, value)
  const active: ThreadRow = {
    sessionId: 's',
    threadId: 'active',
    seq: -1,
    name: null,
    rootMessageId:
      metadata.find((value) => value.threadId === 'active' && value.parentMessageId === null)?.messageId ?? null,
    activeLeafMessageId:
      metadata.filter((value) => value.threadId === 'active' && value.selected).at(-1)?.messageId ?? null,
    createdAt: 1,
    compactionPoints: [],
    summary,
    control: {
      generatingAssistantCount: metadata.filter(
        (value) => value.threadId === 'active' && value.status === 'generating' && value.facts.role === 'assistant'
      ).length,
    },
  }
  const threads = [active, ...additional]
  return {
    record,
    revision: 7,
    activeThread: active,
    metadata: vi.fn(async (ids: readonly string[]) => metadata.filter((value) => ids.includes(value.messageId))),
    messages: vi.fn(async (ids: readonly string[]) => rows.filter((value) => ids.includes(value.messageId))),
    thread: async (id) => threads.find((value) => value.threadId === id) ?? null,
    latestArchivedThread: async () => additional.toSorted((a, b) => b.seq - a.seq)[0] ?? null,
    relations: vi.fn(async (threadId: string, selector: SessionMessageRelationsSelector, limit: number) => {
      if (selector.kind !== 'children') throw new Error('Unexpected path traversal')
      let candidates = metadata
        .filter(
          (value) =>
            value.threadId === threadId &&
            value.parentMessageId === selector.parentMessageId &&
            (!selector.branchId || value.branchId === selector.branchId)
        )
        .sort((a, b) => a.seq - b.seq || a.messageId.localeCompare(b.messageId))
      if (selector.boundary) {
        const boundary = selector.boundary
        candidates = candidates.filter(
          (value) =>
            (value.seq - boundary.seq || value.messageId.localeCompare(boundary.messageId)) *
              (selector.reverse ? -1 : 1) >
            0
        )
      }
      if (selector.reverse) candidates.reverse()
      return candidates.slice(0, limit)
    }),
  }
}

function forkRows(empty = false): MessageRow[] {
  return [
    row('pivot', null, empty ? null : 'current', 800, {
      forkCreatedAt: 10,
      ...(empty ? { pendingBranchId: 'empty', pendingBranchSeq: 2 } : {}),
    }),
    row('first', 'pivot', 'first-tail', 1, { branchId: 'b-first', selected: false }),
    row('first-tail', 'first', null, 0, { selected: false }),
    row('current', 'pivot', 'current-tail', 3, { branchId: 'b-current', selected: !empty }),
    row('current-tail', 'current', null, 0, { selected: !empty }),
  ]
}

describe('removing empty branch messages', () => {
  const point = (active: string | null, pending = false) =>
    row('pivot', null, active, 0, {
      message: message('pivot', 'user'),
      forkCreatedAt: 10,
      forkPivotId: 'pivot',
      ...(pending ? { pendingBranchId: 'empty', pendingBranchSeq: 2 } : {}),
    })
  it.each([false, true])('collapses an inactive last placeholder, selected empty=%s', async (empty) => {
    const reader = fixture([
      point(empty ? null : 'kept', empty),
      ...(empty ? [] : [row('kept', 'pivot', null, 0, { branchId: 'kept-branch' })]),
      row('removed', 'pivot', null, 1, { branchId: 'removed-branch', selected: false }),
    ])
    const plan = await planMessageStructure(reader, {
      action: 'message-remove',
      messageId: 'removed',
      replacementPivotId: 'unused',
    })
    expect(plan.diff.messageMetadataUpsert?.find((value) => value.messageId === 'pivot')).toMatchObject({
      activeChildId: empty ? null : 'kept',
      forkCreatedAt: undefined,
      forkPivotId: undefined,
      pendingBranchId: undefined,
    })
    if (!empty)
      expect(plan.diff.messageMetadataUpsert?.find((value) => value.messageId === 'kept')?.branchId).toBeNull()
  })
  it('retains a real branch and a selected empty branch after deleting another placeholder', async () => {
    const reader = fixture([
      point(null, true),
      row('kept', 'pivot', null, 0, { branchId: 'kept-branch', selected: false }),
      row('removed', 'pivot', null, 1, { branchId: 'removed-branch', selected: false }),
    ])
    const plan = await planMessageStructure(reader, {
      action: 'message-remove',
      messageId: 'removed',
      replacementPivotId: 'unused',
    })
    expect(plan.diff.messageMetadataUpsert?.find((value) => value.messageId === 'pivot')).toMatchObject({
      activeChildId: null,
      forkCreatedAt: 10,
      forkPivotId: 'pivot',
      pendingBranchId: 'empty',
    })
  })
})

describe('local fork commands', () => {
  it('creates a branch using sibling order without loading branch bodies', async () => {
    const reader = fixture(forkRows())
    const plan = await planForkStructure(reader, {
      action: 'fork-create',
      pivotId: 'pivot',
      identity,
      append: [message('reply')],
    })
    expect(plan.diff.messages.upsert[0]).toMatchObject({
      messageId: 'reply',
      parentMessageId: 'pivot',
      seq: 4,
      branchId: 'fork_list_new',
    })
    expect(plan.diff.messageMetadataUpsert?.find((value) => value.messageId === 'pivot')).toMatchObject({
      activeChildId: 'reply',
      forkCreatedAt: 10,
      pendingBranchId: undefined,
    })
    expect(plan.diff.messageMetadataUpsert?.map((value) => value.messageId).sort()).toEqual(['current', 'pivot'])
    expect(reader.messages).not.toHaveBeenCalled()
    expect(plan.result.navigation).toEqual({
      type: 'branch',
      mode: 'create',
      sharedPrefixEnd: { threadId: 'active', messageId: 'pivot' },
      firstMessageId: 'reply',
    })
  })

  it('reserves the empty branch slot and identity until a later append', async () => {
    const plan = await planForkStructure(fixture(forkRows()), { action: 'fork-create', pivotId: 'pivot', identity })
    expect(plan.diff.messageMetadataUpsert?.find((value) => value.messageId === 'pivot')).toMatchObject({
      activeChildId: null,
      pendingBranchId: 'fork_list_new',
      pendingBranchSeq: 4,
    })
    expect(plan.result.navigation).toMatchObject({ mode: 'create', firstMessageId: null })
  })

  it.each([
    ['next', 'current'],
    ['prev', 'first'],
  ] as const)('switches %s from a middle empty branch', async (target, expected) => {
    const reader = fixture(forkRows(true))
    const plan = await planForkStructure(reader, { action: 'fork-switch', pivotId: 'pivot', target })
    expect(plan.diff.messageMetadataUpsert?.find((value) => value.messageId === 'pivot')).toMatchObject({
      activeChildId: expected,
      pendingBranchId: undefined,
      pendingBranchSeq: undefined,
    })
    expect(reader.messages).not.toHaveBeenCalled()
  })

  it('selects a stable branch identity with a bounded indexed relation lookup', async () => {
    const reader = fixture(forkRows())
    const plan = await planForkStructure(reader, {
      action: 'fork-switch',
      pivotId: 'pivot',
      target: { branchId: 'b-first' },
    })
    expect(plan.result.navigation).toMatchObject({ mode: 'select', firstMessageId: 'first' })
    expect(reader.relations).toHaveBeenCalledWith(
      'active',
      { kind: 'children', parentMessageId: 'pivot', branchId: 'b-first' },
      1
    )
  })

  it('deletes an entire branch through a range and collapses its single sibling', async () => {
    const reader = fixture(forkRows())
    const plan = await planForkStructure(reader, { action: 'fork-delete', pivotId: 'pivot' })
    expect(plan.diff.deleteSubtrees).toEqual([{ threadId: 'active', rootMessageId: 'current' }])
    expect(plan.diff.messages.delete).toEqual([])
    expect(plan.result.affectedScopes).toEqual([{ type: 'subtree', threadId: 'active', rootMessageId: 'current' }])
    expect(plan.diff.messageMetadataUpsert?.find((value) => value.messageId === 'pivot')).toMatchObject({
      activeChildId: 'first',
      forkCreatedAt: undefined,
    })
    expect(reader.messages).not.toHaveBeenCalled()
  })

  it('expands selected and stored branches by a metadata range operation', async () => {
    const reader = fixture(forkRows(true))
    const plan = await planForkStructure(reader, { action: 'fork-expand', pivotId: 'pivot' })
    expect(plan.diff.expandForks).toEqual([{ threadId: 'active', branchPointId: 'pivot' }])
    expect(plan.diff.messageMetadataUpsert?.[0]).toMatchObject({
      activeChildId: 'first',
      forkCreatedAt: undefined,
      pendingBranchId: undefined,
    })
    expect(reader.messages).not.toHaveBeenCalled()
  })

  it('anchors branch navigation after shared summaries', async () => {
    const rows = forkRows()
    rows[0].activeChildId = 'summary'
    rows[1].parentMessageId = 'summary'
    rows[3].parentMessageId = 'summary'
    rows.push(
      row('summary', 'pivot', 'current', 0, { kind: 'summary', message: { ...message('summary'), isSummary: true } })
    )
    const plan = await planForkStructure(fixture(rows), { action: 'fork-switch', pivotId: 'pivot', target: 'next' })
    expect(plan.result.navigation).toMatchObject({ sharedPrefixEnd: { messageId: 'summary' } })
  })

  it('checks edited source content before Save & Resend', async () => {
    const rows = forkRows()
    rows[3].message = message('current', 'user')
    const reader = fixture(rows)
    await expect(
      planForkStructure(reader, {
        action: 'fork-save-resend',
        targetMessageId: 'current',
        replacement: message('edited', 'user'),
        expectedContentParts: [{ type: 'text', text: 'stale' }],
        identity,
      })
    ).rejects.toThrow('changed while editing')
    const plan = await planForkStructure(reader, {
      action: 'fork-save-resend',
      targetMessageId: 'current',
      replacement: message('edited', 'user'),
      expectedContentParts: rows[3].message.contentParts,
      identity,
    })
    expect(plan.diff.messages.upsert[0]).toMatchObject({ messageId: 'edited', branchId: 'fork_list_new' })
    expect(reader.messages.mock.calls.every(([ids]) => ids.length === 1 && ids[0] === 'current')).toBe(true)
  })
})

describe('local message and thread commands', () => {
  it('inserts within a branch by changing only the adjacent edges', async () => {
    const reader = fixture(forkRows())
    const plan = await planMessageStructure(reader, {
      action: 'message-insert-after',
      previousId: 'pivot',
      message: message('inserted'),
      requireAnchor: true,
    })
    expect(plan.diff.messages.upsert[0]).toMatchObject({
      parentMessageId: 'pivot',
      activeChildId: 'current',
      seq: 3,
      branchId: 'b-current',
    })
    expect(plan.diff.messageMetadataUpsert?.find((value) => value.messageId === 'current')).toMatchObject({
      parentMessageId: 'inserted',
      seq: 0,
      branchId: null,
    })
    expect(reader.messages).not.toHaveBeenCalled()
  })

  it('replaces a deleted root pivot and preserves its nested subtrees', async () => {
    const plan = await planMessageStructure(fixture(forkRows()), {
      action: 'message-remove',
      messageId: 'pivot',
      replacementPivotId: 'hidden',
    })
    expect(plan.diff.replaceMessagePivots).toEqual([
      { threadId: 'active', messageId: 'pivot', replacementMessageId: 'hidden' },
    ])
    expect(plan.diff.messages.upsert[0]).toMatchObject({
      messageId: 'hidden',
      activeChildId: 'current',
      forkCreatedAt: 10,
      message: { role: 'system', contentParts: [] },
    })
    expect(plan.diff.threads.upsert[0].rootMessageId).toBe('hidden')
    expect(plan.diff.messages.delete).toEqual(['pivot'])
  })

  it('promotes fork children using only sibling shifts at the containing parent', async () => {
    const rows = forkRows()
    rows[0].parentMessageId = 'parent'
    rows[0].seq = 5
    rows.unshift(row('parent', null, 'pivot', 900))
    const plan = await planMessageStructure(fixture(rows), {
      action: 'message-remove',
      messageId: 'pivot',
      replacementPivotId: 'hidden',
    })
    expect(plan.diff.reparentChildren).toEqual([
      { threadId: 'active', parentMessageId: 'pivot', newParentMessageId: 'parent', seqOffset: 5 },
    ])
    expect(plan.diff.siblingShifts).toEqual([{ threadId: 'active', parentMessageId: 'parent', afterSeq: 5, delta: 3 }])
    expect(plan.diff.messages.upsert).toEqual([])
  })

  it('keeps all historical branches when clearing only the active thread', async () => {
    const archived = {
      ...fixture([]).activeThread,
      threadId: 'history',
      seq: 2,
      name: 'History',
      rootMessageId: 'old',
      activeLeafMessageId: 'old',
    }
    const rows = [
      row('system', null, 'reply', 0, { message: message('system', 'system') }),
      row('reply', 'system', null),
      row('old', null, null, 0, { threadId: 'history' }),
      row('alternative', 'old', null, 1, { threadId: 'history', selected: false, branchId: 'old-branch' }),
    ]
    const reader = fixture(rows, [archived])
    const plan = await planMessageStructure(reader, { action: 'session-clear', scope: 'active' })
    expect(plan.diff.deleteThreadMessages).toEqual(['active'])
    expect(plan.diff.deleteSessionMessages).toBeUndefined()
    expect(plan.diff.threads.delete).toEqual([])
    expect(plan.diff.messages.upsert.map((value) => value.messageId)).toEqual(['system'])
    expect(reader.messages).toHaveBeenCalledExactlyOnceWith(['system'])
  })

  it('switches threads without moving any message identity or thread relation', async () => {
    const history = {
      ...fixture([]).activeThread,
      threadId: 'history',
      seq: 8,
      name: 'History',
      rootMessageId: 'old',
      activeLeafMessageId: 'old',
    }
    const reader = fixture([row('current', null, null)], [history])
    const plan = await planThreadStructure(reader, {
      action: 'thread-switch',
      threadId: 'history',
      archiveId: 'unused',
      now: 10,
    })
    expect(plan.record.activeThreadId).toBe('history')
    expect(plan.diff.threads.upsert.map(({ threadId, seq }) => ({ threadId, seq }))).toEqual([
      { threadId: 'active', seq: 9 },
      { threadId: 'history', seq: -1 },
    ])
    expect(plan.diff.messages).toEqual({ upsert: [], delete: [] })
    expect(reader.messages).not.toHaveBeenCalled()
  })

  it('creates a new stable thread and reads only the first system payload', async () => {
    const reader = fixture([
      row('system', null, 'reply', 0, { message: message('system', 'system') }),
      row('reply', 'system', null),
    ])
    const plan = await planThreadStructure(reader, {
      action: 'thread-create',
      archiveId: 'new-thread',
      now: 42,
      systemMessageId: 'new-system',
      defaultSystemPrompt: 'default',
    })
    expect(plan.record.activeThreadId).toBe('new-thread')
    expect(plan.diff.messages.upsert[0]).toMatchObject({
      threadId: 'new-thread',
      messageId: 'new-system',
      message: { contentParts: message('system').contentParts },
    })
    expect(plan.diff.threads.upsert.find((value) => value.threadId === 'active')).toMatchObject({ seq: 0 })
    expect(reader.messages).toHaveBeenCalledExactlyOnceWith(['system'])
  })

  it('rejects stale current-thread deletion receipts', async () => {
    const reader = fixture([row('current', null, null)])
    const plan = await planThreadStructure(reader, {
      action: 'thread-delete',
      threadId: 'active',
      expectedCurrent: { sessionId: 's', firstMessageId: 'stale', lastArchivedThreadId: undefined },
    })
    expect(plan.result.applied).toBe(false)
    expect(plan.diff.deleteThreadMessages).toBeUndefined()
  })
  it('updates an existing system prompt as one targeted command', async () => {
    const reader = fixture([
      row('system', null, 'reply', 0, { message: message('system', 'system') }),
      row('reply', 'system', null),
    ])
    const plan = await planMessageStructure(reader, {
      action: 'set-system-prompt',
      text: 'New prompt',
      messageId: 'unused',
      replacementPivotId: 'hidden',
      now: 42,
    })
    expect(plan.diff.messages.upsert[0]).toMatchObject({
      messageId: 'system',
      message: { contentParts: [{ type: 'text', text: 'New prompt' }] },
    })
    expect(reader.messages).toHaveBeenCalledExactlyOnceWith(['system'])
  })

  it('prepends a missing system prompt without reading the current payloads', async () => {
    const reader = fixture([
      row('user', null, 'reply', 900, { message: message('user', 'user') }),
      row('reply', 'user', null),
    ])
    const plan = await planMessageStructure(reader, {
      action: 'set-system-prompt',
      text: 'Prompt',
      messageId: 'system',
      replacementPivotId: 'hidden',
      now: 42,
    })
    expect(plan.diff.messages.upsert[0]).toMatchObject({
      messageId: 'system',
      parentMessageId: null,
      activeChildId: 'user',
    })
    expect(plan.diff.messageMetadataUpsert?.[0]).toMatchObject({ messageId: 'user', parentMessageId: 'system', seq: 0 })
    expect(plan.diff.threads.upsert[0].rootMessageId).toBe('system')
    expect(reader.messages).not.toHaveBeenCalled()
  })

  it('removes the system prompt and promotes its selected child atomically', async () => {
    const reader = fixture([
      row('system', null, 'reply', 0, { message: message('system', 'system') }),
      row('reply', 'system', null),
    ])
    const plan = await planMessageStructure(reader, {
      action: 'set-system-prompt',
      text: '',
      messageId: 'unused',
      replacementPivotId: 'hidden',
      now: 42,
    })
    expect(plan.diff.messages.delete).toEqual(['system'])
    expect(plan.diff.messageMetadataUpsert?.[0]).toMatchObject({ messageId: 'reply', parentMessageId: null })
    expect(plan.diff.threads.upsert[0].rootMessageId).toBe('reply')
  })

  it('deletes the current thread and activates the latest archived identity', async () => {
    const history = {
      ...fixture([]).activeThread,
      threadId: 'history',
      seq: 8,
      name: 'History',
      rootMessageId: 'old',
      activeLeafMessageId: 'old',
    }
    const plan = await planThreadStructure(fixture([row('current', null, null)], [history]), {
      action: 'thread-delete',
      threadId: 'active',
    })
    expect(plan.diff.deleteThreadMessages).toEqual(['active'])
    expect(plan.diff.threads.delete).toEqual(['active'])
    expect(plan.record.activeThreadId).toBe('history')
    expect(plan.result.navigation).toEqual({ type: 'thread-switch', threadId: 'history' })
  })

  it('checks generating runtime rows even when their branch is unselected', async () => {
    const rows = forkRows()
    rows[1].status = 'generating'
    rows[1].message = { ...rows[1].message, generating: true }
    await expect(
      planForkStructure(fixture(rows), {
        action: 'fork-delete',
        pivotId: 'pivot',
        guard: { action: 'delete-fork', activeGenerationMessageIds: new Set(['first']) },
      })
    ).rejects.toThrow()
  })
})

describe('row generation controls', () => {
  it('intersects runtime identities with persisted assistant state across branches and threads', async () => {
    const rows = [
      row('root', null, null, 0, { message: message('root', 'user') }),
      row('inactive', 'root', null, 0, {
        selected: false,
        status: 'generating',
        message: { ...message('inactive'), generating: true },
      }),
      row('history', null, null, 0, {
        threadId: 'history',
        status: 'generating',
        message: { ...message('history'), generating: true },
      }),
      row('stopped', 'root', null),
      row('user-runtime', 'root', null, 0, {
        status: 'generating',
        message: { ...message('user-runtime', 'user'), generating: true },
      }),
    ]
    const reader = fixture(rows)
    const control = deriveSessionGenerationControl(
      reader.activeThread,
      await reader.metadata(['inactive', 'history', 'stopped', 'user-runtime', 'missing'])
    )
    expect(control).toMatchObject({
      generatingReplyCount: 2,
      anyReplyGenerating: true,
      cancellableMessageIds: ['inactive', 'history'],
    })
  })

  it('keeps an inactive placeholder locked before its runtime is registered', () => {
    const reader = fixture([
      row('root', null, null, 0, { message: message('root', 'user') }),
      row('placeholder', 'root', null, 0, {
        selected: false,
        status: 'generating',
        message: { ...message('placeholder'), generating: true },
      }),
    ])
    expect(deriveSessionGenerationControl(reader.activeThread, [])).toMatchObject({
      generatingReplyCount: 0,
      anyReplyGenerating: true,
      cancellableMessageIds: [],
    })
  })

  it('ignores archived stale generating rows when no runtime owns them', () => {
    const reader = fixture([
      row('root', null, null, 0, { message: message('root', 'user') }),
      row('history', null, null, 0, {
        threadId: 'history',
        status: 'generating',
        message: { ...message('history'), generating: true },
      }),
    ])
    expect(deriveSessionGenerationControl(reader.activeThread, [])).toMatchObject({
      generatingReplyCount: 0,
      anyReplyGenerating: false,
    })
  })
})
