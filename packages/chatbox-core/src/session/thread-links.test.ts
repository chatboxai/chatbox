import { describe, expect, it } from 'vitest'
import { relationFixture } from '../ports/testing/session-row-relations-contract'
import { ThreadLinks, type ThreadLink } from './thread-links'

function fixture() {
  const snapshot = relationFixture()
  const thread = snapshot.rows.threads.find((row) => row.threadId === 'old')!
  const links = snapshot.rows.messages
    .filter((row) => row.threadId === thread.threadId)
    .map(({ message, selected, ...row }) => {
      if (!row.facts) throw new Error('Fixture facts are missing')
      return { ...row, facts: row.facts }
    })
  return { thread, links, graph: ThreadLinks.from(thread.threadId, links) }
}

describe('thread links', () => {
  it('derives membership and summary from edges, including inactive branches', async () => {
    const { graph, thread } = fixture()
    expect(graph.activePath(thread.rootMessageId).map((row) => row.messageId)).toEqual(['old-0', 'old-1', 'old-2'])
    expect(graph.isOnPath('old-2', thread.rootMessageId)).toBe(true)
    expect(graph.isOnPath('inactive', thread.rootMessageId)).toBe(false)
    expect((await graph.summarize(thread.rootMessageId)).summary?.messageCount).toBe(3)
    const point = graph.get('old-0')!
    const switched = graph.withChanges([{ ...point, activeChildId: 'inactive' }])
    expect(switched.activePath(thread.rootMessageId).map((row) => row.messageId)).toEqual(['old-0', 'inactive'])
    expect(switched.isOnPath('old-2', thread.rootMessageId)).toBe(false)
    expect((await switched.summarize(thread.rootMessageId)).summary?.messageCount).toBe(2)
    expect(graph.isOnPath('old-2', thread.rootMessageId)).toBe(true)
  })

  it('preserves descendants when inserting a compaction parent or promoting direct children', () => {
    const { graph, thread } = fixture()
    const point = graph.get('old-0')!
    const summary: ThreadLink = {
      ...point,
      messageId: 'summary',
      parentMessageId: point.messageId,
      kind: 'summary',
      activeChildId: point.activeChildId,
    }
    const inserted = graph.withChanges([
      { ...point, activeChildId: summary.messageId },
      summary,
      ...graph.children(point.messageId).map((row) => ({ ...row, parentMessageId: summary.messageId })),
    ])
    expect(inserted.activePath(thread.rootMessageId).map((row) => row.messageId)).toEqual([
      'old-0',
      'summary',
      'old-1',
      'old-2',
    ])
    expect(inserted.get('old-2')).toBe(graph.get('old-2'))
    const promoted = inserted.withChanges(
      [
        { ...point, activeChildId: summary.activeChildId },
        ...inserted.children(summary.messageId).map((row) => ({ ...row, parentMessageId: point.messageId })),
      ],
      [summary.messageId]
    )
    expect(promoted.activePath(thread.rootMessageId)).toEqual(graph.activePath(thread.rootMessageId))
    expect(promoted.get('inactive')?.parentMessageId).toBe(point.messageId)
  })

  it('rejects a broken parent connection and cyclic ancestry', () => {
    const { graph, thread } = fixture()
    const row = graph.get('old-1')!
    expect(() => graph.withChanges([{ ...row, parentMessageId: 'missing' }]).activePath(thread.rootMessageId)).toThrow()
    const cycle = graph.withChanges([{ ...row, parentMessageId: row.messageId, activeChildId: row.messageId }])
    expect(() => cycle.isOnPath(row.messageId, thread.rootMessageId)).toThrow('Cyclic')
  })
})
