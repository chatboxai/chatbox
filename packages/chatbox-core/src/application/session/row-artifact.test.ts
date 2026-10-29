import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { Message } from '../../types'

const message = (id: string, text: string): Message => ({
  id,
  role: 'assistant',
  contentParts: [{ type: 'text', text }],
})
async function collect(source: AsyncIterable<string>) {
  const result: string[] = []
  for await (const value of source) result.push(value)
  return result
}

describe('artifact causal markdown stream', () => {
  it('reads only the target ancestry on an inactive branch, excluding its live target', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession({
      id: 's',
      name: 'Artifact',
      messages: [{ ...message('pivot', 'shared'), role: 'user' }, message('selected', 'wrong branch')],
      messageForksHash: {
        pivot: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'selected-branch', messages: [] },
            {
              id: 'other-branch',
              messages: [message('style', '```css\nbody {}\n```'), message('target', 'durable target')],
            },
          ],
        },
      },
      threads: [{ id: 'archive', name: 'Archive', createdAt: 1, messages: [message('unrelated', 'wrong thread')] }],
    })
    const read = vi.spyOn(repository.rowStore, 'readMessages')
    expect(await collect(repository.iterateSessionArtifactMarkdown({ sessionId: 's', messageId: 'target' }))).toEqual([
      'shared',
      '```css\nbody {}\n```',
    ])
    expect(read.mock.calls.map(([request]) => request.messageIds)).toEqual([['pivot'], ['style']])
    expect(new Set(read.mock.calls.map(([request]) => request.expectedRevision)).size).toBe(1)
  })

  it('pages causal identities while reading one payload at a time', async () => {
    const repository = new InMemorySessionRepository()
    await repository.createSessionRows(
      { id: 's', name: 'Artifact' },
      Array.from({ length: 205 }, (_, index) => message(`m${index}`, `text ${index}`))
    )
    const relations = vi.spyOn(repository.rowStore, 'readMessageRelationsPage')
    const read = vi.spyOn(repository.rowStore, 'readMessages')
    let count = 0
    for await (const text of repository.iterateSessionArtifactMarkdown({ sessionId: 's', messageId: 'm204' })) {
      expect(text).toBe(`text ${count++}`)
    }
    expect(count).toBe(204)
    expect(relations.mock.calls).toHaveLength(2)
    expect(read.mock.calls.every(([request]) => request.messageIds.length === 1)).toBe(true)
  })

  it('stops before the next body on cancellation', async () => {
    const repository = new InMemorySessionRepository()
    await repository.createSessionRows({ id: 's', name: 'Artifact' }, [
      message('a', 'a'),
      message('b', 'b'),
      message('target', 'target'),
    ])
    const abort = new AbortController()
    const read = vi.spyOn(repository.rowStore, 'readMessages')
    const stream = repository
      .iterateSessionArtifactMarkdown({ sessionId: 's', messageId: 'target', signal: abort.signal })
      [Symbol.asyncIterator]()
    expect((await stream.next()).value).toBe('a')
    abort.abort()
    await expect(stream.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('rejects a changed revision rather than mixing history', async () => {
    const repository = new InMemorySessionRepository()
    await repository.createSessionRows({ id: 's', name: 'Artifact' }, [
      message('a', 'a'),
      message('b', 'b'),
      message('target', 'target'),
    ])
    const stream = repository
      .iterateSessionArtifactMarkdown({ sessionId: 's', messageId: 'target' })
      [Symbol.asyncIterator]()
    await stream.next()
    await repository.executeSessionCommand('s', { type: 'header', updater: { name: 'Changed' } })
    await expect(stream.next()).rejects.toMatchObject({ name: 'SessionRowConflictError' })
  })
})
