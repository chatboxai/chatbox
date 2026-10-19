import { deriveMessageFacts } from '../../session/message-facts'
import type { MessageRow } from '../../session/session-tree/types'
import type { Message } from '../../types'
import { SessionRowConflictError } from '../session-row-store'
import { relationFixture } from './session-row-relations-contract'
import type { SessionRowStoreContractCase, SessionRowStoreContractFactory } from './session-row-store-contract'

export const previewMessage = (id: string, role: Message['role'], extra: Partial<Message> = {}): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
  ...extra,
})

export function branchPreviewFixture(messages: Message[]) {
  const fixture = relationFixture()
  const base = fixture.rows.messages.find((row) => row.messageId === 'inactive')!
  const branch: MessageRow[] = messages.map((message, index) => ({
    ...base,
    messageId: message.id,
    parentMessageId: index ? messages[index - 1].id : base.parentMessageId,
    activeChildId: messages[index + 1]?.id ?? null,
    seq: index ? 0 : base.seq,
    branchId: index ? null : 'inactive',
    kind: message.isSummary ? 'summary' : 'message',
    status: message.generating ? 'generating' : 'settled',
    facts: deriveMessageFacts(message),
    message,
  }))
  fixture.rows.messages = [...fixture.rows.messages.filter((row) => row.messageId !== 'inactive'), ...branch]
  return fixture
}

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}

async function rejects(read: () => Promise<unknown>, conflict = false) {
  try {
    await read()
  } catch (error) {
    if (conflict && !(error instanceof SessionRowConflictError)) throw error
    return
  }
  throw new Error('Expected branch preview read to reject')
}

export function createSessionBranchPreviewContract(
  factory: SessionRowStoreContractFactory
): SessionRowStoreContractCase[] {
  return [
    {
      name: 'skips leading hidden rows, pairs a user head, and counts every later row except its paired reply',
      run: async () => {
        const store = await factory()
        await store.writeRows(
          branchPreviewFixture([
            previewMessage('summary', 'assistant', { isSummary: true }),
            previewMessage('marker', 'user', { isForkMarker: true }),
            previewMessage('user', 'user'),
            previewMessage('summary-after', 'assistant', { isSummary: true }),
            previewMessage('marker-after', 'assistant', { isForkMarker: true }),
            previewMessage('reply', 'assistant'),
            previewMessage('followup', 'user'),
            previewMessage('reply2', 'assistant'),
          ])
        )
        equal(await store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'summary' }), {
          sessionId: 'transcript',
          revision: 1,
          threadId: 'old',
          headMessageId: 'user',
          headRole: 'user',
          pairedReplyMessageId: 'reply',
          followupCount: 4,
        })
      },
    },
    {
      name: 'does not pair an assistant head and reports marker-only paths as empty previews',
      run: async () => {
        const store = await factory()
        await store.writeRows(
          branchPreviewFixture([previewMessage('assistant', 'assistant'), previewMessage('user', 'user')])
        )
        const preview = await store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'assistant' })
        equal(
          [preview?.headMessageId, preview?.headRole, preview?.pairedReplyMessageId, preview?.followupCount],
          ['assistant', 'assistant', null, 1]
        )
        const markers = branchPreviewFixture([
          previewMessage('summary', 'assistant', { isSummary: true }),
          previewMessage('marker', 'user', { isForkMarker: true }),
        ])
        markers.revision = 2
        await store.writeRows(markers, 1)
        const empty = await store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'summary' })
        equal(
          [empty?.headMessageId, empty?.headRole, empty?.pairedReplyMessageId, empty?.followupCount],
          [null, null, null, 0]
        )
      },
    },
    {
      name: 'counts a user-only path without manufacturing a paired reply',
      run: async () => {
        const store = await factory()
        await store.writeRows(
          branchPreviewFixture([
            previewMessage('user', 'user'),
            previewMessage('second', 'user'),
            previewMessage('last', 'system'),
          ])
        )
        const preview = await store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'user' })
        equal([preview?.pairedReplyMessageId, preview?.followupCount], [null, 2])
      },
    },
    {
      name: 'follows the branch local active child through nested forks and excludes inactive descendants',
      run: async () => {
        const store = await factory()
        const fixture = branchPreviewFixture([
          previewMessage('user', 'user'),
          previewMessage('reply', 'assistant'),
          previewMessage('selected-tail', 'user'),
        ])
        const alternative = previewMessage('nested-inactive', 'assistant')
        fixture.rows.messages.push({
          ...fixture.rows.messages.find((row) => row.messageId === 'reply')!,
          messageId: alternative.id,
          parentMessageId: 'user',
          activeChildId: null,
          seq: 1,
          branchId: 'nested',
          facts: deriveMessageFacts(alternative),
          message: alternative,
        })
        await store.writeRows(fixture)
        const preview = await store.readBranchPreview({
          sessionId: 'transcript',
          firstMessageId: 'user',
          revealedMessageIds: ['nested-inactive', 'selected-tail', 'old-1'],
        })
        equal(
          [preview?.headMessageId, preview?.pairedReplyMessageId, preview?.followupCount, preview?.revealedMessageIds],
          ['user', 'reply', 1, ['selected-tail']]
        )
      },
    },
    {
      name: 'returns requested revealed identities once in path order and omits identities from other paths',
      run: async () => {
        const store = await factory()
        await store.writeRows(
          branchPreviewFixture([
            previewMessage('user', 'user'),
            previewMessage('reply', 'assistant'),
            previewMessage('later', 'assistant'),
          ])
        )
        const preview = await store.readBranchPreview({
          sessionId: 'transcript',
          firstMessageId: 'user',
          revealedMessageIds: ['later', 'old-1', 'reply', 'missing', 'user', 'later'],
        })
        equal(preview?.revealedMessageIds, ['user', 'reply', 'later'])
        equal(
          (await store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'user', revealedMessageIds: [] }))
            ?.revealedMessageIds,
          []
        )
      },
    },
    {
      name: 'returns missing sessions, rejects missing heads, and fences stale revisions',
      run: async () => {
        const store = await factory()
        equal(await store.readBranchPreview({ sessionId: 'missing', firstMessageId: 'user' }), null)
        await store.writeRows(branchPreviewFixture([previewMessage('user', 'user')]))
        await rejects(() => store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'missing' }))
        await rejects(
          () => store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'user', expectedRevision: 2 }),
          true
        )
        const changed = branchPreviewFixture([previewMessage('user', 'user'), previewMessage('reply', 'assistant')])
        changed.revision = 2
        await store.writeRows(changed, 1)
        await rejects(
          () => store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'user', expectedRevision: 1 }),
          true
        )
        equal(
          (await store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'user', expectedRevision: 2 }))
            ?.revision,
          2
        )
      },
    },
    {
      name: 'rejects invalid identities and revisions before traversing a path',
      run: async () => {
        const store = await factory()
        await store.writeRows(branchPreviewFixture([previewMessage('user', 'user')]))
        for (const request of [
          { sessionId: '', firstMessageId: 'user' },
          { sessionId: 'transcript', firstMessageId: '' },
          { sessionId: 'transcript', firstMessageId: 'user', expectedRevision: 0 },
          { sessionId: 'transcript', firstMessageId: 'user', expectedRevision: 1.5 },
          { sessionId: 'transcript', firstMessageId: 'user', revealedMessageIds: [''] },
        ])
          await rejects(() => store.readBranchPreview(request))
      },
    },
  ]
}
