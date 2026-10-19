import { describe, expect, it, vi } from 'vitest'
import { SessionRowConflictError } from '../../ports/session-row-store'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'

async function fixture() {
  const repository = new InMemorySessionRepository()
  for (const id of ['a', 'b'])
    await repository.seedSession({
      id,
      name: id,
      type: 'chat',
      messages: Array.from({ length: 120 }, (_, index) => ({
        id: `${id}${index}`,
        role: 'user',
        contentParts: [{ type: 'text', text: 'ordinary' }],
      })),
    })
  return repository
}

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('serialized search batches', () => {
  it('finishes one bounded page before a same-session write and releases the owner between pages', async () => {
    const repository = await fixture()
    const entered = deferred(),
      release = deferred()
    const read = repository.rowStore.readTranscriptWindow.bind(repository.rowStore)
    vi.spyOn(repository.rowStore, 'readTranscriptWindow').mockImplementationOnce(async (request) => {
      entered.resolve()
      await release.promise
      return read(request)
    })
    const pagePromise = repository.readSessionSearchWindow({ sessionId: 'a' })
    await entered.promise
    let written = false
    const write = repository.executeSessionCommand('a', { type: 'header', updater: { name: 'changed' } }).then(() => {
      written = true
    })
    await repository.executeSessionCommand('b', { type: 'header', updater: { name: 'independent' } })
    expect(written).toBe(false)
    release.resolve()
    const first = await pagePromise
    await write
    expect(first?.page?.revision).toBe(1)
    const cursor = first?.page?.older
    if (!cursor) throw new Error('Expected cursor')
    const next = await repository.readSessionSearchWindow({ sessionId: 'a', cursor })
    expect(next?.page?.revision).toBe(2)
    expect(next?.page?.messages[0].messageId).toBe('a20')
    await expect(repository.readSessionTranscriptWindow({ sessionId: 'a', cursor, limit: 50 })).rejects.toBeInstanceOf(
      SessionRowConflictError
    )
  })

  it.each(['abort', 'failure'] as const)('releases a batch owner after %s', async (kind) => {
    const repository = await fixture(),
      controller = new AbortController()
    vi.spyOn(repository.rowStore, 'readTranscriptWindow').mockImplementationOnce(async () => {
      if (kind === 'abort') controller.abort(new Error('canceled'))
      throw new Error(kind)
    })
    await expect(repository.readSessionSearchWindow({ sessionId: 'a', signal: controller.signal })).rejects.toThrow(
      kind
    )
    await repository.executeSessionCommand('a', { type: 'header', updater: { name: 'after failure' } })
    expect((await repository.getSessionHeader('a'))?.header.name).toBe('after failure')
  })

  it('does not read queued bodies after cancellation', async () => {
    const repository = await fixture(),
      controller = new AbortController()
    const entered = deferred(),
      release = deferred()
    const blocker = repository.projectLatestSession('a', async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise
    const reads = vi.spyOn(repository.rowStore, 'readTranscriptWindow')
    const pending = repository.readSessionSearchWindow({ sessionId: 'a', signal: controller.signal })
    controller.abort(new Error('canceled'))
    release.resolve()
    await blocker
    await expect(pending).rejects.toThrow('canceled')
    expect(reads).not.toHaveBeenCalled()
  })

  it('rejects a moved or deselected cursor and returns no body for a missing candidate', async () => {
    const repository = await fixture()
    const first = await repository.readSessionSearchWindow({ sessionId: 'a' })
    const cursor = first?.page?.older
    if (!cursor) throw new Error('Expected cursor')
    await expect(
      repository.readSessionSearchWindow({ sessionId: 'a', cursor: { ...cursor, threadSeq: 999 } })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
    await expect(
      repository.readSessionSearchWindow({ sessionId: 'a', cursor: { ...cursor, sessionId: 'b' } })
    ).rejects.toThrow('Invalid search continuation')
    expect((await repository.readSessionSearchWindow({ sessionId: 'a', messageId: 'absent' }))?.page).toBeNull()
    expect(() => repository.readSessionSearchCandidates({ sessionId: 'a', messageIds: Array(101).fill('a0') })).toThrow(
      'Too many'
    )
  })
})
