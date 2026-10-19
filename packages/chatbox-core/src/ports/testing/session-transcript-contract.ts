import { projectRowFixture } from './session-row-fixtures'
import type { MessageRow, ThreadRow } from '../../session/session-tree/types'
import { SessionRowConflictError, type SessionRowSnapshot } from '../session-row-store'
import type { SessionTranscriptPage } from '../session-transcript-source'
import type { SessionRowStoreContractCase, SessionRowStoreContractFactory } from './session-row-store-contract'

export function transcriptFixture(emptyActive = false): SessionRowSnapshot {
  const threads: ThreadRow[] = []
  const messages: MessageRow[] = []
  for (const [threadId, seq, count] of [
    ['old', 0, 3],
    ['empty', 1, 0],
    ['recent', 2, 4],
    ['active', -1, emptyActive ? 0 : 3],
  ] as const) {
    threads.push({
      sessionId: 'transcript',
      threadId,
      seq,
      name: threadId,
      createdAt: seq + 10,
      rootMessageId: count ? `${threadId}-0` : null,
      activeLeafMessageId: count ? `${threadId}-${count - 1}` : null,
      compactionPoints: [],
    })
    for (let index = 0; index < count; index++) {
      const messageId = `${threadId}-${index}`
      messages.push({
        sessionId: 'transcript',
        threadId,
        messageId,
        seq: index * 2,
        parentMessageId: index ? `${threadId}-${index - 1}` : null,
        activeChildId: index + 1 < count ? `${threadId}-${index + 1}` : null,
        kind: 'message',
        status: 'settled',
        createdAt: index,
        updatedAt: index,
        branchId: null,
        message: {
          id: messageId,
          role: index % 2 === 0 ? 'user' : 'assistant',
          contentParts: [{ type: 'text', text: messageId }],
        },
      })
    }
  }
  messages.push({
    ...messages[1],
    messageId: 'inactive',
    seq: 7,
    activeChildId: null,
    branchId: 'other',
    message: { id: 'inactive', role: 'assistant', contentParts: [] },
  })
  return projectRowFixture({
    rows: { sessionId: 'transcript', threads, messages },
    record: { id: 'transcript', name: 'transcript', type: 'chat', storageFormat: 'rows', activeThreadId: 'active' },
    revision: 1,
  })
}
function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}
function ids(page: SessionTranscriptPage | null): string[] {
  return page?.messages.map((row) => row.messageId) ?? []
}
async function rejects(task: () => Promise<unknown>, conflict = false) {
  try {
    await task()
  } catch (error) {
    if (conflict && !(error instanceof SessionRowConflictError)) throw error
    return
  }
  throw new Error('Expected read to reject')
}
export function createSessionTranscriptContract(
  factory: SessionRowStoreContractFactory
): SessionRowStoreContractCase[] {
  return [
    {
      name: 'transcript host pages of 20 and 50 decode only their shared cross-thread slice',
      run: async () => {
        const store = await factory()
        const fixture = transcriptFixture()
        fixture.rows.messages = []
        for (const thread of fixture.rows.threads) {
          if (thread.threadId === 'empty') continue
          thread.rootMessageId = `${thread.threadId}-0`
          thread.activeLeafMessageId = `${thread.threadId}-59`
          for (let index = 0; index < 60; index++) {
            const messageId = `${thread.threadId}-${index}`
            fixture.rows.messages.push({
              sessionId: 'transcript',
              threadId: thread.threadId,
              messageId,
              seq: index,
              parentMessageId: index ? `${thread.threadId}-${index - 1}` : null,
              activeChildId: index < 59 ? `${thread.threadId}-${index + 1}` : null,
              kind: 'message',
              status: 'settled',
              createdAt: index,
              updatedAt: index,
              branchId: null,
              message: { id: messageId, role: 'user', contentParts: [] },
            })
          }
        }
        await store.writeRows(projectRowFixture(fixture))
        for (const limit of [20, 50]) {
          const page = await store.readTranscriptWindow({
            sessionId: 'transcript',
            origin: { messageId: 'old-50' },
            limit,
          })
          equal(ids(page), [
            ...Array.from({ length: 10 }, (_, index) => `old-${index + 50}`),
            ...Array.from({ length: limit - 10 }, (_, index) => `recent-${index}`),
          ])
          equal(page?.messages.length, limit)
          const tail = await store.readTranscriptWindow({ sessionId: 'transcript', origin: 'tail', limit })
          equal(
            ids(tail),
            Array.from({ length: limit }, (_, index) => `active-${60 - limit + index}`)
          )
        }
      },
    },
    {
      name: 'centered transcript host pages fill both boundaries and continue with exclusive cursors',
      run: async () => {
        const store = await factory()
        const fixture = transcriptFixture()
        const template = fixture.rows.messages.find((row) => row.messageId === 'active-0')!
        fixture.rows.threads = [
          {
            ...fixture.rows.threads.find((thread) => thread.threadId === 'active')!,
            rootMessageId: 'm1',
            activeLeafMessageId: 'm1000',
          },
        ]
        fixture.rows.messages = Array.from({ length: 1000 }, (_, index) => ({
          ...template,
          messageId: `m${index + 1}`,
          seq: index,
          parentMessageId: index ? `m${index}` : null,
          activeChildId: index < 999 ? `m${index + 2}` : null,
          message: { id: `m${index + 1}`, role: 'user' as const, contentParts: [] },
        }))
        await store.writeRows(projectRowFixture(fixture))
        const range = (start: number, count: number) => Array.from({ length: count }, (_, index) => `m${start + index}`)
        for (const limit of [1, 20, 21, 50]) {
          const start = 500 - Math.floor((limit - 1) / 2)
          const page = await store.readTranscriptWindow({
            sessionId: 'transcript',
            origin: { messageId: 'm500', align: 'center' },
            limit,
            expectedRevision: 1,
          })
          equal(ids(page), range(start, limit))
          equal(page?.anchor, { threadId: 'active', messageId: 'm500' })
          equal(page?.older?.limit, limit)
          equal(page?.newer?.limit, limit)
          equal(
            ids(await store.readTranscriptWindow({ sessionId: 'transcript', cursor: page!.older!, limit })),
            range(start - limit, limit)
          )
          equal(
            ids(await store.readTranscriptWindow({ sessionId: 'transcript', cursor: page!.newer!, limit })),
            range(start + limit, limit)
          )
        }
        for (const [messageId, start, side] of [
          ['m3', 1, 'older'],
          ['m999', 981, 'newer'],
        ] as const) {
          const page = await store.readTranscriptWindow({
            sessionId: 'transcript',
            origin: { messageId, align: 'center' },
            limit: 20,
          })
          equal(ids(page), range(start, 20))
          equal(page?.anchor.messageId, messageId)
          equal(page?.[side], null)
        }
      },
    },
    {
      name: 'centered transcript targets span selected thread paths and preserve empty thread anchors',
      run: async () => {
        const store = await factory()
        await store.writeRows(transcriptFixture())
        const page = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { messageId: 'recent-0', align: 'center' },
          limit: 4,
        })
        equal(ids(page), ['old-2', 'recent-0', 'recent-1', 'recent-2'])
        equal(page?.anchor, { threadId: 'recent', messageId: 'recent-0' })
        equal(
          page?.threads.map((thread) => thread.threadId),
          ['old', 'recent']
        )
        equal(ids(await store.readTranscriptWindow({ sessionId: 'transcript', cursor: page!.older!, limit: 4 })), [
          'old-0',
          'old-1',
        ])
        equal(ids(await store.readTranscriptWindow({ sessionId: 'transcript', cursor: page!.newer!, limit: 4 })), [
          'recent-3',
          'active-0',
          'active-1',
          'active-2',
        ])
        equal(
          ids(
            await store.readTranscriptWindow({
              sessionId: 'transcript',
              origin: { threadId: 'recent', edge: 'head', align: 'center' },
              limit: 4,
            })
          ),
          ids(page)
        )
        const tail = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { threadId: 'old', edge: 'tail', align: 'center' },
          limit: 4,
        })
        equal(ids(tail), ['old-1', 'old-2', 'recent-0', 'recent-1'])
        equal(tail?.anchor, { threadId: 'old', messageId: 'old-2' })
        const empty = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { threadId: 'empty', edge: 'head', align: 'center' },
          limit: 4,
        })
        equal(ids(empty), [])
        equal(empty?.anchor, { threadId: 'empty', messageId: null })
        equal(ids(await store.readTranscriptWindow({ sessionId: 'transcript', cursor: empty!.newer!, limit: 4 })), [
          'recent-0',
          'recent-1',
          'recent-2',
          'recent-3',
        ])
        const all = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { messageId: 'active-1', align: 'center' },
          limit: 20,
        })
        equal(ids(all), [
          'old-0',
          'old-1',
          'old-2',
          'recent-0',
          'recent-1',
          'recent-2',
          'recent-3',
          'active-0',
          'active-1',
          'active-2',
        ])
        equal(all?.older, null)
        equal(all?.newer, null)
        await rejects(() =>
          store.readTranscriptWindow({
            sessionId: 'transcript',
            origin: { messageId: 'inactive', align: 'center' },
            limit: 4,
          })
        )
        await rejects(() =>
          store.readTranscriptWindow({
            sessionId: 'transcript',
            origin: { messageId: 'recent-0', align: 'middle' as 'center' },
            limit: 4,
          })
        )
        await rejects(
          () =>
            store.readTranscriptWindow({
              sessionId: 'transcript',
              origin: { messageId: 'recent-0', align: 'center' },
              expectedRevision: 2,
              limit: 4,
            }),
          true
        )
      },
    },
    {
      name: 'centered transcript byte budgets reserve the target before selecting adjacent payloads',
      run: async () => {
        const store = await factory()
        const fixture = transcriptFixture()
        fixture.rows.messages.find((row) => row.messageId === 'old-2')!.message.contentParts = [
          { type: 'text', text: 'x'.repeat(10000) },
        ]
        await store.writeRows(projectRowFixture(fixture))
        const target = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { messageId: 'recent-0' },
          limit: 1,
        })
        const next = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { messageId: 'recent-1' },
          limit: 1,
        })
        const maxBytes = target!.payloadBytes + next!.payloadBytes
        const page = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { messageId: 'recent-0', align: 'center' },
          limit: 4,
          maxBytes,
        })
        equal(ids(page), ['recent-0', 'recent-1'])
        equal(page?.payloadBytes, maxBytes)
        equal(page?.anchor, { threadId: 'recent', messageId: 'recent-0' })
        equal(page?.older?.messageId, 'recent-0')
        equal(page?.newer?.messageId, 'recent-1')
        const back = await store.readTranscriptWindow({
          sessionId: 'transcript',
          cursor: page!.older!,
          limit: 4,
          maxBytes,
        })
        equal(ids(back), ['old-2'])
        const oversized = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { messageId: 'recent-0', align: 'center' },
          limit: 4,
          maxBytes: 1,
        })
        equal(ids(oversized), ['recent-0'])
        equal(oversized?.payloadBytes, target?.payloadBytes)
        equal(
          ids(
            await store.readTranscriptWindow({
              sessionId: 'transcript',
              cursor: oversized!.newer!,
              limit: 4,
              maxBytes: 1,
            })
          ),
          ['recent-1']
        )
      },
    },
    {
      name: 'transcript pages share a bounded budget across selected thread paths in both directions',
      run: async () => {
        const store = await factory()
        await store.writeRows(transcriptFixture())
        const head = await store.readTranscriptWindow({ sessionId: 'transcript', origin: 'head', limit: 4 })
        equal(ids(head), ['old-0', 'old-1', 'old-2', 'recent-0'])
        equal(head?.older, null)
        const next = await store.readTranscriptWindow({ sessionId: 'transcript', cursor: head!.newer!, limit: 4 })
        equal(ids(next), ['recent-1', 'recent-2', 'recent-3', 'active-0'])
        const back = await store.readTranscriptWindow({ sessionId: 'transcript', cursor: next!.older!, limit: 4 })
        equal(ids(back), ids(head))
        const tail = await store.readTranscriptWindow({ sessionId: 'transcript', origin: 'tail', limit: 4 })
        equal(ids(tail), ['recent-3', 'active-0', 'active-1', 'active-2'])
        equal(tail?.newer, null)
        equal((await store.readThread({ sessionId: 'transcript' }))?.thread.threadId, 'active')
        equal((await store.readCommit('transcript'))?.revision, 1)
        equal(Object.hasOwn(head!, 'textTokens'), false)
      },
    },
    {
      name: 'transcript target includes its anchor and rejects hidden branches and mismatched cursors',
      run: async () => {
        const store = await factory()
        await store.writeRows(transcriptFixture())
        const page = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { messageId: 'recent-2' },
          limit: 3,
        })
        equal(ids(page), ['recent-2', 'recent-3', 'active-0'])
        equal(page?.anchor, { threadId: 'recent', messageId: 'recent-2' })
        await rejects(() =>
          store.readTranscriptWindow({ sessionId: 'transcript', origin: { messageId: 'inactive' }, limit: 3 })
        )
        await rejects(() => store.readTranscriptWindow({ sessionId: 'transcript', cursor: page!.older!, limit: 2 }))
        await rejects(() => store.readNavigationPage({ sessionId: 'transcript', cursor: page!.older!, limit: 3 }))
        await store.applyDiff(
          { sessionId: 'transcript', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
          { ...transcriptFixture(), revision: 2 },
          1
        )
        await rejects(
          () => store.readTranscriptWindow({ sessionId: 'transcript', cursor: page!.older!, limit: 3 }),
          true
        )
        await store.deleteRows('transcript', 2)
        await rejects(
          () => store.readTranscriptWindow({ sessionId: 'transcript', limit: 3, expectedRevision: 2 }),
          true
        )
        equal(await store.readCommit('transcript'), null)
      },
    },
    {
      name: 'transcript empty thread anchors can continue toward either neighboring nonempty thread',
      run: async () => {
        const store = await factory()
        await store.writeRows(transcriptFixture(true))
        const empty = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { threadId: 'empty', edge: 'head' },
          limit: 2,
        })
        equal(ids(empty), [])
        equal(empty?.anchor, { threadId: 'empty', messageId: null })
        equal(ids(await store.readTranscriptWindow({ sessionId: 'transcript', cursor: empty!.older!, limit: 2 })), [
          'old-1',
          'old-2',
        ])
        equal(ids(await store.readTranscriptWindow({ sessionId: 'transcript', cursor: empty!.newer!, limit: 2 })), [
          'recent-0',
          'recent-1',
        ])
        const active = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { threadId: 'active', edge: 'tail' },
          limit: 2,
        })
        equal(ids(active), [])
        equal(active?.newer, null)
        equal(ids(await store.readTranscriptWindow({ sessionId: 'transcript', cursor: active!.older!, limit: 2 })), [
          'recent-2',
          'recent-3',
        ])
        const tail = await store.readTranscriptWindow({ sessionId: 'transcript', origin: 'tail', limit: 2 })
        equal(ids(tail), ['recent-2', 'recent-3'])
        equal(
          tail?.threads.some((thread) => thread.threadId === 'active'),
          true
        )
      },
    },
    {
      name: 'transcript byte limits apply across thread boundaries and permit one oversized message',
      run: async () => {
        const store = await factory()
        await store.writeRows(transcriptFixture())
        const page = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: 'head',
          limit: 4,
          maxBytes: 1,
        })
        equal(ids(page), ['old-0'])
        equal((page?.payloadBytes ?? 0) > 1, true)
        equal(
          ids(
            await store.readTranscriptWindow({ sessionId: 'transcript', cursor: page!.newer!, limit: 4, maxBytes: 1 })
          ),
          ['old-1']
        )
        await rejects(() =>
          store.readTranscriptWindow({ sessionId: 'transcript', cursor: page!.newer!, limit: 4, maxBytes: 2 })
        )
      },
    },
    {
      name: 'navigation projection pages pair visible messages and retain cross-page assistant continuation',
      run: async () => {
        const store = await factory()
        await store.writeRows(transcriptFixture())
        const page = await store.readNavigationPage({ sessionId: 'transcript', origin: 'head', limit: 3 })
        equal(
          page?.entries.map((row) => [row.messageId, row.assistantMessageId]),
          [
            ['old-0', 'old-1'],
            ['old-2', undefined],
          ]
        )
        equal(page?.needsProjection, [])
        const split = await store.readNavigationPage({ sessionId: 'transcript', origin: 'head', limit: 1 })
        equal(split?.entries[0].assistantPending, true)
        const next = await store.readNavigationPage({ sessionId: 'transcript', cursor: split!.newer!, limit: 1 })
        equal(next?.leadingAssistant, { threadId: 'old', messageId: 'old-1', preview: 'old-1' })
        equal(next?.entries, [])
        equal(Boolean(next?.newer), true)
      },
    },
  ]
}
