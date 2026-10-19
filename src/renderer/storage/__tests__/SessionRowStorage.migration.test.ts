import 'fake-indexeddb/auto'
import { it, expect, vi } from 'vitest'
import { relationFixture } from '../../../../packages/chatbox-core/src/ports/testing/session-row-relations-contract'
import { SESSION_ROW_MESSAGE_STORE } from '../session-row-idb-records'
import { DEFAULT_BACKUP_PAGE_LIMITS } from '@chatbox/core/backup'
import {
  verifyPublishedFormatUpgrade,
  verifyCandidateFormatUpgrade,
} from '../../../../packages/chatbox-core/src/ports/testing/session-row-migration-contract'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'
it('upgrades published IndexedDB format2 rows and keeps format3 opens bounded', async () => {
  const rows = new IndexedDBSessionRowStore()
  try {
    await verifyPublishedFormatUpgrade(() => rows)
    await verifyCandidateFormatUpgrade(rows)
  } finally {
    rows.close()
  }
})

it('publishes a bounded parent insertion and names from metadata', async () => {
  const rows = new IndexedDBSessionRowStore()
  try {
    const fixture = relationFixture()
    await rows.writeRows(fixture)
    const point = fixture.rows.messages.find((row) => row.messageId === 'old-0')!
    const { message, ...metadata } = point
    const reads: string[] = []
    const original = IDBObjectStore.prototype.get
    const spy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      reads.push(this.name)
      return original.call(this, key)
    })
    const result = await rows.applyDiff(
      {
        sessionId: 'transcript',
        threads: { upsert: [], delete: [] },
        insertParents: [{ threadId: 'old', parentMessageId: 'old-0', newParentMessageId: 'summary' }],
        messageMetadataUpsert: [{ ...metadata, activeChildId: 'summary' }],
        messages: {
          upsert: [
            {
              ...point,
              messageId: 'summary',
              parentMessageId: 'old-0',
              kind: 'summary',
              message: {
                id: 'summary',
                role: 'assistant',
                isSummary: true,
                contentParts: [{ type: 'text', text: 'summary' }],
              },
            },
          ],
          delete: [],
        },
      },
      { record: fixture.record, revision: 2 },
      1
    )
    expect(reads.filter((name) => name === SESSION_ROW_MESSAGE_STORE)).toEqual([])
    expect(result.threads.find((row) => row.threadId === 'old')?.summary).toMatchObject({
      messageCount: 4,
      hasAutoTitleContent: true,
    })
    spy.mockRestore()
    const data = await rows.readMessageMetadata({
      sessionId: 'transcript',
      messageIds: ['old-1', 'inactive'],
      expectedRevision: 2,
    })
    expect(data?.status === 'ready' && data.rows.map((row) => row.parentMessageId)).toEqual(['summary', 'summary'])
    const exported = []
    for await (const row of rows.iterateBackupRows('transcript', DEFAULT_BACKUP_PAGE_LIMITS, undefined, 'active'))
      exported.push(row)
    expect(exported.filter((row) => row.kind === 'thread').map((row) => row.thread.threadId)).toEqual(['active'])
    expect(exported.filter((row) => row.kind === 'message').map((row) => row.message.threadId)).toEqual([
      'active',
      'active',
      'active',
    ])
  } finally {
    vi.restoreAllMocks()
    rows.close()
  }
})
