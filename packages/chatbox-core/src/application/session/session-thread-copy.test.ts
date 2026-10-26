import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareSessionRowsFixture } from '../../ports/testing/session-row-fixtures'
import * as treeValidation from '../../session/session-tree/validate'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { Session } from '../../types'
import * as copyShape from './session-copy-shape'
import { copiedMessageId } from './session-thread-copy'

afterEach(() => vi.restoreAllMocks())

const source = (): Session => ({
  id: 'source',
  name: 'Source',
  threadName: '',
  messages: [{ id: 'current', role: 'user', contentParts: [{ type: 'text', text: 'current' }] }],
  threads: [
    {
      id: 'old',
      name: 'Old thread',
      createdAt: 1,
      messages: [
        { id: 'pivot', role: 'user', contentParts: [{ type: 'text', text: 'question' }] },
        { id: 'reply', role: 'assistant', contentParts: [{ type: 'text', text: 'large'.repeat(40000) }] },
      ],
    },
  ],
  messageForksHash: {
    pivot: {
      createdAt: 2,
      position: 0,
      lists: [
        { id: 'selected', messages: [] },
        {
          id: 'saved',
          messages: [{ id: 'inactive', role: 'assistant', contentParts: [{ type: 'text', text: 'saved' }] }],
        },
      ],
    },
  },
})
const request = { sessionId: 'source', threadId: 'old', expectedRevision: 1, targetSessionId: 'copy', createdAt: 99 }

describe('row-based thread copy', () => {
  it('copies a complete session by identity mapping without revalidating its tree', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession(source())
    const validate = vi.spyOn(treeValidation, 'validateSessionTree')
    await repository.copySessionRows({ ...request, scope: { type: 'session' } })
    expect(validate).not.toHaveBeenCalled()
    expect(repository.inspectSession('copy')?.threads?.[0].name).toBe('Old thread')
  })

  it.each([false, true])(
    'preserves the publication result when cleanup fails (publish failure: %s)',
    async (failPublish) => {
      const repository = new InMemorySessionRepository()
      await repository.seedSession(source())
      const stage = repository.rowStore.stageRows.bind(repository.rowStore)
      const failure = new Error('publication failed')
      vi.spyOn(repository.rowStore, 'stageRows').mockImplementation(async (...args) => {
        const writer = await stage(...args)
        return {
          ...writer,
          publish: failPublish
            ? async () => {
                throw failure
              }
            : writer.publish,
          dispose: async () => {
            throw new Error('cleanup failed')
          },
        }
      })
      if (failPublish) {
        await expect(repository.copySessionThreadRows(request)).rejects.toBe(failure)
        expect(await repository.getSessionHeader('copy')).toBeNull()
      } else {
        const result = await repository.copySessionThreadRows(request)
        expect(result.revision).toBe(1)
        expect((await repository.getSessionHeader('copy'))?.header.name).toBe('Old thread')
      }
    }
  )

  it('copies only the selected thread with all its branches and fresh identities', async () => {
    const repository = new InMemorySessionRepository()
    const input = source()
    await repository.seedSession(input)
    const read = vi.spyOn(repository.rowStore, 'iterateRows')
    const validate = vi.spyOn(treeValidation, 'validateSessionTree')
    const result = await repository.copySessionThreadRows(request)
    expect(validate).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledWith({ sessionId: 'source', expectedRevision: 1, threadId: 'old' })
    expect(result.header).toMatchObject({ id: 'copy', name: 'Old thread', threadName: 'Old thread' })
    expect(result.diff.messages.upsert).toEqual([])
    expect(result.appendedMessageIds).toEqual([])
    expect(result.diff.threads.upsert[0].createdAt).toBe(99)
    const copied = repository.inspectSession('copy')!
    expect(copied.messages.map((message) => message.id)).toEqual(
      ['pivot', 'reply'].map((id) => copiedMessageId('copy', id))
    )
    expect(copied.messages[1].contentParts).toEqual(input.threads![0].messages[1].contentParts)
    expect(copied.threads).toEqual(undefined)
    expect(copied.messageForksHash?.[copiedMessageId('copy', 'pivot')].lists[1].messages[0].id).toBe(
      copiedMessageId('copy', 'inactive')
    )
    expect(repository.inspectSession('source')?.messages[0].id).toBe('current')
    expect(await repository.rowStore.getRevision('source')).toBe(1)
  })

  it('rejects a changed source before publishing any target', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession(source())
    const iterate = repository.rowStore.iterateRows.bind(repository.rowStore)
    vi.spyOn(repository.rowStore, 'iterateRows').mockImplementation(async function* (...args) {
      yield* iterate(...args)
      await repository.executeSessionCommand('source', { type: 'header', updater: { name: 'New source' } })
    })
    await expect(repository.copySessionThreadRows(request)).rejects.toThrow('changed before')
    expect(await repository.getSessionHeader('copy')).toBeNull()
    expect(await repository.getSessionHeader('source')).toMatchObject({ revision: 2 })
  })

  it('preserves an existing target and rejects stale initial revisions', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession(source())
    await repository.createSessionRows({ id: 'copy', name: 'Existing' }, [])
    await expect(repository.copySessionThreadRows(request)).rejects.toThrow('already exists')
    await expect(
      repository.copySessionThreadRows({ ...request, targetSessionId: 'new', expectedRevision: 0 })
    ).rejects.toThrow('changed before')
    expect(await repository.getSessionHeader('copy')).toMatchObject({ header: { name: 'Existing' }, revision: 1 })
  })

  it('reports a committed target despite a failed external record projection', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession(source())
    vi.spyOn(repository.recordStore, 'setRecord').mockRejectedValueOnce(new Error('record unavailable'))
    const result = await repository.copySessionThreadRows(request)
    expect(result.recordProjectionError).toBeInstanceOf(Error)
    expect(await repository.rowStore.getRevision('copy')).toBe(result.revision)
    expect(repository.inspectSession('copy')?.messages).toHaveLength(2)
  })

  it('copies every thread and branch while replacing active source markers', async () => {
    const repository = new InMemorySessionRepository()
    const input = source()
    input.messages.push({
      id: 'old-marker',
      role: 'assistant',
      contentParts: [],
      isForkMarker: true,
      forkedFromSessionId: 'origin',
    })
    await repository.seedSession(input)
    const validate = vi.spyOn(treeValidation, 'validateSessionTree')
    const result = await repository.copySessionRows({
      ...request,
      scope: { type: 'session' },
      appendForkMarkerId: 'new-marker',
    })
    expect(validate).toHaveBeenCalledOnce()
    const checked = validate.mock.calls[0][0]
    expect(checked.threads.map((thread) => thread.threadId)).toEqual(['copy'])
    expect(checked.messages.every((message) => message.threadId === 'copy' && !('message' in message))).toBe(true)
    expect(result.header.name).toBe('Source')
    const copy = repository.inspectSession('copy')!
    expect(copy.messages.map((message) => message.id)).toEqual(
      ['current', 'new-marker'].map((id) => copiedMessageId('copy', id))
    )
    expect(copy.messages.at(-1)).toMatchObject({ isForkMarker: true, forkedFromSessionId: 'source' })
    expect(copy.threads?.map((thread) => thread.name)).toEqual(['Old thread'])
    expect(copy.threads?.[0].messages[1].contentParts).toEqual(input.threads![0].messages[1].contentParts)
    expect(copy.messageForksHash?.[copiedMessageId('copy', 'pivot')].lists[1].messages[0].id).toBe(
      copiedMessageId('copy', 'inactive')
    )
    expect(result.diff.threads.upsert).toHaveLength(1)
    expect(result.diff.threads.upsert[0].summary).toEqual((await repository.getSessionHeader('copy'))?.summary)
  })

  it.each(['parent', 'summary', 'thread'] as const)(
    'rejects a broken %s produced by a branch transformation before publication',
    async (kind) => {
      const repository = new InMemorySessionRepository()
      await repository.seedSession(source())
      const prepare = copyShape.prepareSessionCopyShape
      vi.spyOn(copyShape, 'prepareSessionCopyShape').mockImplementation(async (...args) => {
        const shape = await prepare(...args)
        return {
          ...shape,
          thread:
            kind === 'summary'
              ? {
                  ...shape.thread,
                  compactionPoints: [
                    { boundaryMessageId: 'missing', summaryMessageId: shape.marker.messageId, createdAt: 1 },
                  ],
                }
              : shape.thread,
          transform: (row) => {
            const transformed = shape.transform(row)
            if (!transformed || kind === 'summary') return transformed
            return kind === 'parent'
              ? { ...transformed, parentMessageId: 'missing' }
              : { ...transformed, threadId: 'old' }
          },
        }
      })
      const stage = repository.rowStore.stageRows.bind(repository.rowStore)
      const publish = vi.fn()
      const dispose = vi.fn()
      vi.spyOn(repository.rowStore, 'stageRows').mockImplementation(async (...args) => {
        const writer = await stage(...args)
        return {
          ...writer,
          publish: async () => {
            publish()
            await writer.publish()
          },
          dispose: async () => {
            dispose()
            await writer.dispose()
          },
        }
      })
      await expect(
        repository.copySessionRows({
          ...request,
          scope: { type: 'session' },
          appendForkMarkerId: 'new-marker',
        })
      ).rejects.toThrow(kind === 'thread' ? 'thread identity' : 'Invalid copied branch')
      expect(publish).not.toHaveBeenCalled()
      expect(dispose).toHaveBeenCalledOnce()
      expect(await repository.getSessionHeader('copy')).toBeNull()
      expect(await repository.rowStore.getRevision('source')).toBe(1)
    }
  )

  it('preserves the selected successor and drops branches owned by a replaced marker', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession({
      id: 'source',
      name: 'Source',
      messages: [
        { id: 'user', role: 'user', contentParts: [] },
        { id: 'marker', role: 'assistant', contentParts: [], isForkMarker: true },
        { id: 'kept', role: 'assistant', contentParts: [{ type: 'text', text: 'kept' }] },
      ],
      messageForksHash: {
        marker: {
          createdAt: 1,
          position: 0,
          lists: [
            { id: 'selected', messages: [] },
            { id: 'dropped', messages: [{ id: 'hidden', role: 'assistant', contentParts: [] }] },
          ],
        },
      },
    })
    await repository.copySessionRows({ ...request, scope: { type: 'session' }, appendForkMarkerId: 'new-marker' })
    expect(repository.inspectSession('copy')?.messages.map((message) => message.id)).toEqual(
      ['user', 'kept', 'new-marker'].map((id) => copiedMessageId('copy', id))
    )
    const copiedRows = repository.rowStore.snapshot().find((value) => value.record.id === 'copy')!.rows.messages
    expect(copiedRows.some((row) => row.messageId === copiedMessageId('copy', 'hidden'))).toBe(false)
    expect(repository.inspectSession('copy')?.messageForksHash).toBeUndefined()
  })

  it('appends a marker into a selected empty branch and retains the inactive reply', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession({
      id: 'source',
      name: 'Source',
      messages: [{ id: 'user', role: 'user', contentParts: [] }],
      messageForksHash: {
        user: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'empty', messages: [] },
            {
              id: 'saved',
              messages: [{ id: 'reply', role: 'assistant', contentParts: [{ type: 'text', text: 'saved' }] }],
            },
          ],
        },
      },
    })
    await repository.copySessionRows({ ...request, scope: { type: 'session' }, appendForkMarkerId: 'new-marker' })
    const copy = repository.inspectSession('copy')!
    expect(copy.messages.map((message) => message.id)).toEqual(
      ['user', 'new-marker'].map((id) => copiedMessageId('copy', id))
    )
    expect(copy.messageForksHash?.[copiedMessageId('copy', 'user')].lists).toHaveLength(2)
  })

  it('rejects a concurrent creator between the target check and candidate capture', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession(source())
    const begin = repository.rowStore.stageRows.bind(repository.rowStore)
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = vi.fn()
    vi.spyOn(repository.rowStore, 'stageRows').mockImplementation(async (...args) => {
      entered()
      await barrier
      return begin(...args)
    })
    const copy = repository.copySessionThreadRows(request)
    const rejected = expect(copy).rejects.toThrow('changed')
    await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce())
    const other = prepareSessionRowsFixture({ id: 'copy', name: 'Concurrent creator', messages: [] })
    await repository.rowStore.writeRows(
      {
        record: other.session,
        revision: 1,
        rows: { sessionId: 'copy', threads: other.threads, messages: other.messages },
      },
      null
    )
    release()
    await rejected
    expect(await repository.getSessionHeader('copy')).toMatchObject({
      revision: 1,
      header: { name: 'Concurrent creator' },
    })
    expect(await repository.rowStore.getRevision('source')).toBe(1)
  })

  it.each(['copy', 'create'] as const)(
    'preserves a creator arriving before the initial %s revision capture',
    async (operation) => {
      const repository = new InMemorySessionRepository()
      await repository.seedSession(source())
      const revision = repository.rowStore.getRevision.bind(repository.rowStore)
      let inserted = false
      vi.spyOn(repository.rowStore, 'getRevision').mockImplementation(async (id) => {
        if (id === 'copy' && !inserted) {
          inserted = true
          const other = prepareSessionRowsFixture({ id: 'copy', name: 'Concurrent creator', messages: [] })
          await repository.rowStore.writeRows(
            {
              record: other.session,
              revision: 1,
              rows: { sessionId: 'copy', threads: other.threads, messages: other.messages },
            },
            null
          )
        }
        return revision(id)
      })
      await expect(
        operation === 'copy'
          ? repository.copySessionThreadRows(request)
          : repository.createSessionRows({ id: 'copy', name: 'New' }, [])
      ).rejects.toThrow('already exists')
      expect(await repository.getSessionHeader('copy')).toMatchObject({
        revision: 1,
        header: { name: 'Concurrent creator' },
      })
    }
  )

  it('rejects an oversized marker relation index before creating a target candidate', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession({
      id: 'source',
      name: 'Source',
      messages: [{ id: 'marker', role: 'assistant', contentParts: [], isForkMarker: true }],
    })
    const read = repository.rowStore.readMessageRelationsPage.bind(repository.rowStore)
    vi.spyOn(repository.rowStore, 'readMessageRelationsPage').mockImplementation(async (...args) => {
      const page = await read(...args)
      if (page?.status === 'ready')
        page.rows[0].facts.seedAttachments = [{ name: 'x'.repeat(16 * 1024 * 1024), storageKey: 'key' }]
      return page
    })
    const begin = vi.spyOn(repository.rowStore, 'stageRows')
    await expect(
      repository.copySessionRows({ ...request, scope: { type: 'session' }, appendForkMarkerId: 'new-marker' })
    ).rejects.toThrow('Copy relation index exceeds budget')
    expect(begin).not.toHaveBeenCalled()
    expect(await repository.rowStore.getRevision('copy')).toBeNull()
    expect(await repository.rowStore.getRevision('source')).toBe(1)
  })

  it('copies complete Unicode messages while preserving nested identities', async () => {
    const repository = new InMemorySessionRepository()
    const text = '你好\n🙂'.repeat(100_000)
    await repository.seedSession({
      id: 'source',
      name: 'Source',
      messages: [{ id: 'message', role: 'assistant', contentParts: [{ type: 'text', text }] }],
    })
    await repository.copySessionRows({ ...request, scope: { type: 'session' } })
    expect(repository.inspectSession('copy')?.messages[0]).toMatchObject({
      id: copiedMessageId('copy', 'message'),
      contentParts: [{ type: 'text', text }],
    })
    expect(repository.inspectSession('source')?.messages[0].id).toBe('message')
  })
})
