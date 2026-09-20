import { buildContext } from '@shared/context'
import type { Message, Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { getCompactionContext } from './compaction-context'

const pending: Message = { id: 'pending', role: 'user', contentParts: [{ type: 'text', text: 'Next question' }] }
const text = (id: string, role: Message['role'] = 'user'): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
})
function session(messages: Message[], maxContextMessageCount?: number): Session {
  return { id: 'session', name: 'Test', type: 'chat', messages, settings: { maxContextMessageCount } }
}
const attachments = { read: async () => null }

describe('getCompactionContext', () => {
  it.each([0, 1, 4, 8, undefined])('matches the send history window for limit %s', async (limit) => {
    const current = session([text('system', 'system'), ...Array.from({ length: 20 }, (_, i) => text(`m${i}`))], limit)
    const snapshot = structuredClone(current)
    const sending = await buildContext([...current.messages, pending], {
      attachmentResolver: attachments,
      maxContextMessageCount: limit,
    })
    const compacting = getCompactionContext(current, current.settings ?? {})
    expect(compacting).toEqual(sending.filter((message) => message.id !== pending.id))
    expect(compacting[0].id).toBe('system')
    expect(current).toEqual(snapshot)
  })

  it('uses the pending input for window selection without summarizing that input', async () => {
    const current = session([text('u1'), text('a1', 'assistant'), text('u2'), text('a2', 'assistant')], 2)
    const largePending: Message = { ...pending, tokenCountMap: { default: 100_000 } }
    const sending = await buildContext([...current.messages, largePending], {
      attachmentResolver: attachments,
      maxContextMessageCount: 2,
    })
    const compacting = getCompactionContext(current, current.settings ?? {}, largePending)
    expect(compacting).toEqual(sending.filter((message) => message.id !== largePending.id))
    expect(compacting.some((message) => message.id === largePending.id)).toBe(false)
  })

  it('keeps the latest applicable summary only when it fits in the send window', async () => {
    const current = session(
      [
        text('u1'),
        text('a1', 'assistant'),
        { ...text('summary', 'assistant'), isSummary: true },
        text('u2'),
        text('a2', 'assistant'),
      ],
      2
    )
    current.compactionPoints = [{ boundaryMessageId: 'a1', summaryMessageId: 'summary', createdAt: 1 }]
    const sending = await buildContext([...current.messages, pending], {
      attachmentResolver: attachments,
      compactionPoints: current.compactionPoints,
      maxContextMessageCount: 2,
    })
    const compacting = getCompactionContext(current, current.settings ?? {})
    expect(compacting).toEqual(sending.filter((message) => message.id !== pending.id))
    expect(compacting.map((message) => message.id)).toEqual(['u2', 'a2'])
  })
})
