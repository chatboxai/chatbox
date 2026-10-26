import type { SessionAttachmentFacts } from '@chatbox/core/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectSessionOwnership } from '../../src/renderer/adapters/session-ownership'
import { drivers, message, setupRows, source } from './session-rows-harness'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe.each(drivers)('%s attachment metadata', (driver) => {
  it('pages workspace files/images on the selected path and ownership across all threads and branches without bodies', async () => {
    const initial = source()
    initial.messages = Array.from({ length: 405 }, (_, index) => message(`active-${index}`))
    initial.messages[1].files = [
      {
        id: 'upload',
        name: 'file.txt',
        fileType: 'text/plain',
        storageKey: 'parsed',
        rawStorageKey: 'raw',
        sessionAttachmentId: 42,
      },
    ]
    initial.messages[2].contentParts.push({ type: 'image', storageKey: 'image-key' })
    initial.threads = [
      {
        id: 'archived',
        name: 'Archived',
        createdAt: 1,
        messages: [
          {
            ...message('old'),
            files: [
              { id: 'old-upload', name: 'old.txt', fileType: 'text/plain', storageKey: 'old', sessionAttachmentId: 43 },
            ],
          },
        ],
      },
    ]
    initial.messageForksHash = {
      'active-3': {
        position: 1,
        createdAt: 1,
        lists: [
          {
            id: 'inactive',
            messages: [
              {
                ...message('fork'),
                files: [
                  {
                    id: 'fork-file',
                    name: 'fork.txt',
                    fileType: 'text/plain',
                    storageKey: 'fork',
                    sessionAttachmentId: 44,
                  },
                ],
              },
            ],
          },
        ],
      },
    }
    const h = await setupRows(driver, initial)
    cleanups.push(h.dispose)
    const bodies = vi.spyOn(h.rows, 'readMessages')
    const snapshots = vi.spyOn(h.rows, 'readSnapshot')
    const completeRows = vi.spyOn(h.rows, 'iterateRows')
    const pages = vi.spyOn(h.rows, 'readMessageRelationsPage')
    const selected: SessionAttachmentFacts[] = []
    for await (const row of h.repository.iterateSessionAttachmentFacts({ sessionId: 's', scope: 'active-path' }))
      selected.push(row)
    expect(selected.map((row) => row.messageId)).toEqual(initial.messages.map((row) => row.id))
    expect(selected[1].files).toEqual([{ id: 'upload', name: 'file.txt', storageKey: 'parsed', rawStorageKey: 'raw' }])
    expect(selected[2].imageStorageKeys).toEqual(['image-key'])
    expect(pages).toHaveBeenCalledTimes(3)
    const ownership = await collectSessionOwnership(h.repository, 's')
    expect(ownership.messageIds).toHaveLength(407)
    expect(ownership.attachmentReferences.map((claim) => claim.attachmentId).sort()).toEqual([42, 43, 44])
    expect(bodies).not.toHaveBeenCalled()
    expect(snapshots).not.toHaveBeenCalled()
    expect(completeRows).not.toHaveBeenCalled()
  })

  it('rejects revision changes before completion, including changes after the last yielded row', async () => {
    const h = await setupRows(driver)
    cleanups.push(h.dispose)
    const iterator = h.repository
      .iterateSessionAttachmentFacts({ sessionId: 's', scope: 'active-path' })
      [Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    await h.repository.executeSessionCommand('s', { type: 'append', messages: [message('later')] })
    await expect(iterator.next()).rejects.toMatchObject({ name: 'SessionRowConflictError' })
  })

  it('stops on abort and accepts an empty active thread as an empty reference source', async () => {
    const initial = source()
    initial.messages = []
    const h = await setupRows(driver, initial)
    cleanups.push(h.dispose)
    expect(await collectSessionOwnership(h.repository, 's')).toEqual({ messageIds: [], attachmentReferences: [] })
    const controller = new AbortController()
    controller.abort(new Error('Canceled attachment read'))
    const iterator = h.repository
      .iterateSessionAttachmentFacts({ sessionId: 's', scope: 'active-path', signal: controller.signal })
      [Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toThrow('Canceled attachment read')
  })
})
