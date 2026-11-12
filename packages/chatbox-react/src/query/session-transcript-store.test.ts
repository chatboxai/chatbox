import type { SessionRowSnapshot } from '@chatbox/core/ports'
import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionRowStore } from '@chatbox/core/testing'
import { SessionTranscriptWindowController } from './session-transcript-window'

function fixture(): SessionRowSnapshot {
  const sessionId = 'transcript-window'
  const threads = [0, 1, 2].map((index) => ({
    sessionId,
    threadId: `T${index + 1}`,
    threadOrder: index === 2 ? -1 : index,
    name: `Thread ${index + 1}`,
    createdAt: index,
    rootMessageId: `T${index + 1}-1`,
    activeLeafMessageId: `T${index + 1}-100`,
    compactionPoints: [],
  }))
  return {
    record: {
      id: sessionId,
      name: 'Transcript',
      type: 'chat',
      storageFormat: 'rows',
      rowFormatVersion: 3,
      rowAuthority: 1,
      activeThreadId: 'T3',
    },
    revision: 1,
    rows: {
      sessionId,
      threads,
      messages: threads.flatMap((thread) =>
        Array.from({ length: 100 }, (_, index) => {
          const messageId = `${thread.threadId}-${index + 1}`
          return {
            sessionId,
            threadId: thread.threadId,
            messageId,
            siblingOrder: index,
            parentMessageId: index ? `${thread.threadId}-${index}` : null,
            activeChildId: index < 99 ? `${thread.threadId}-${index + 2}` : null,
            kind: 'message' as const,
            status: 'settled' as const,
            createdAt: index,
            updatedAt: index,
            branchId: null,
            selected: true,
            selectedDepth: index,
            message: {
              id: messageId,
              role: 'user' as const,
              contentParts: [{ type: 'text' as const, text: messageId }],
            },
          }
        })
      ),
    },
  }
}

describe.each([20, 50])('transcript window with the row store, page size %i', (pageSize) => {
  it('opens, accumulates pages across threads, searches, views and switches using real cursors', async () => {
    const store = new InMemorySessionRowStore()
    const snapshot = fixture()
    await store.writeRows(snapshot)
    const read = vi.spyOn(store, 'readTranscriptWindow')
    const controller = new SessionTranscriptWindowController({ sessionId: snapshot.record.id, pageSize, source: store })
    const ack = () => {
      const request = controller.getSnapshot().layout
      expect(request).not.toBeNull()
      controller.acknowledgeLayout(request!.requestId)
    }
    expect(await controller.open()).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(
      Array.from({ length: pageSize }, (_, index) => `T3-${101 - pageSize + index}`)
    )
    expect(controller.getSnapshot().firstWindowReady).toBe(false)
    ack()
    expect(controller.getSnapshot().firstWindowReady).toBe(true)
    for (let page = 1; page <= 5; page++) {
      expect(await controller.loadOlder(page)).toBe(true)
      ack()
      expect(controller.getSnapshot().pages.length).toBe(page + 1)
      expect(controller.getSnapshot().rows.length).toBe((page + 1) * pageSize)
    }
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T3-100')
    expect(controller.getSnapshot().hasNewer).toBe(false)
    expect(new Set(controller.getSnapshot().rows.map((row) => row.threadId)).size).toBeGreaterThan(1)
    expect(await controller.loadNewer(6)).toBe(false)
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T3-100')
    expect(controller.getSnapshot().pages).toHaveLength(6)

    expect(await controller.openSearch('T2-91')).toBe(true)
    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().rows[0].messageId).toBe(`T2-${91 - Math.floor((pageSize - 1) / 2)}`)
    expect(controller.getSnapshot().rows[Math.floor((pageSize - 1) / 2)].messageId).toBe('T2-91')
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe(`T3-${pageSize / 2 - 9}`)
    expect(controller.getSnapshot().layout).toMatchObject({ kind: 'anchor', anchor: { messageId: 'T2-91' } })
    ack()
    expect(await controller.viewThread('T1')).toBe(true)
    expect(controller.getSnapshot().rows[0].messageId).toBe('T1-1')
    expect((await store.readCommit(snapshot.record.id))?.record.activeThreadId).toBe('T3')
    ack()

    const switched = {
      ...snapshot,
      revision: 2,
      record: { ...snapshot.record, activeThreadId: 'T1' },
      rows: {
        ...snapshot.rows,
        threads: snapshot.rows.threads.map((thread) => ({
          ...thread,
          threadOrder: thread.threadId === 'T1' ? -1 : thread.threadId === 'T2' ? 0 : 1,
        })),
      },
    }
    await store.writeRows(switched)
    expect(await controller.showSwitchedThread(switched)).toBe(true)
    expect(controller.getSnapshot().pages).toHaveLength(1)
    expect(controller.getSnapshot().rows.at(-1)?.messageId).toBe('T1-100')
    expect(controller.getSnapshot().layout?.kind).toBe('tail')
    ack()
    expect(controller.getSnapshot().revision).toBe(2)
    expect(controller.getSnapshot().hasNewer).toBe(false)
    controller.close()
  })
})
