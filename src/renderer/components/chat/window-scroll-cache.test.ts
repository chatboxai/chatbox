import { describe, expect, it } from 'vitest'
import { buildMessageRenderItems } from './message-render-items'
import {
  boundedWindowSnapshot,
  createWindowScrollKey,
  getWindowScrollPosition,
  resolveWindowScrollPosition,
  saveWindowScrollPosition,
  type WindowScrollEntry,
} from './window-scroll-cache'

const header = { id: 'session', name: 'Chat' }
const items = buildMessageRenderItems(
  Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, role: 'assistant', contentParts: [] }))
)
const identity = { threadId: 'thread', revision: 1 }
function fixtureKey() {
  const result = createWindowScrollKey(header, identity, items, 1000)
  if (!result) throw new Error('Missing test window identity')
  return result
}
const key = fixtureKey()

function entry(): WindowScrollEntry {
  return {
    version: 1,
    key,
    layout: 'layout',
    following: false,
    anchor: { messageId: 'm20', offset: 12 },
    snapshot: { ranges: [{ startIndex: 0, endIndex: Infinity, size: 100 }], scrollTop: 2012 },
  }
}

describe('window scroll cache', () => {
  it('restores only the measured range of the identical window', () => {
    expect(resolveWindowScrollPosition(entry(), key, 'layout', items)).toEqual({
      following: false,
      snapshot: { ranges: [{ startIndex: 0, endIndex: 49, size: 100 }], scrollTop: 2012 },
    })
  })

  it.each(['revision', 'layout', 'range', 'object', 'group'])(
    'rejects %s geometry but keeps a present reading anchor',
    (change) => {
      const changedItems =
        change === 'range'
          ? items.slice(10)
          : change === 'object'
            ? buildMessageRenderItems(items.flatMap((item) => item.messages.map((message) => ({ ...message }))))
            : change === 'group'
              ? buildMessageRenderItems(
                  items.flatMap((item, i) =>
                    item.messages.map((message) => ({ ...message, role: i === 30 ? 'user' : message.role }))
                  )
                )
              : items
      const changedKey = createWindowScrollKey(
        header,
        { ...identity, revision: change === 'revision' ? 2 : 1 },
        changedItems,
        1050 - changedItems.length
      )
      const result = resolveWindowScrollPosition(
        entry(),
        changedKey,
        change === 'layout' ? 'other' : 'layout',
        changedItems
      )
      expect(result).toEqual({ anchorIndex: change === 'range' ? 10 : 20 })
    }
  )

  it('does not move a tail reader to an earlier message after a revision change', () => {
    expect(
      resolveWindowScrollPosition({ ...entry(), following: true }, { ...key, revision: 2 }, 'layout', items)
    ).toBeNull()
  })

  it('rejects another thread, schema, or a missing anchor', () => {
    expect(resolveWindowScrollPosition(entry(), { ...key, threadId: 'other' }, 'layout', items)).toBeNull()
    expect(resolveWindowScrollPosition({ ...entry(), version: 2 }, key, 'layout', items)).toEqual({ anchorIndex: 20 })
    expect(resolveWindowScrollPosition(entry(), { ...key, revision: 2 }, 'layout', items.slice(-5))).toBeNull()
  })

  it('requires a known revision and bounds cache identity size', () => {
    expect(createWindowScrollKey(header, undefined, items, 1000)).toBeNull()
    expect(createWindowScrollKey(header, { ...identity, revision: NaN }, items, 1000)).toBeNull()
    expect(
      createWindowScrollKey(
        header,
        identity,
        Array.from({ length: 201 }, () => items[0]),
        1000
      )?.signature
    ).toBeNull()
    const oversized = [{ ...items[0], key: 'x'.repeat(16000) }]
    expect(createWindowScrollKey(header, identity, oversized, 1000)?.signature).toBeNull()
  })

  it('bounds stored windows independently of conversation size', () => {
    for (let i = 0; i <= 100; i++) saveWindowScrollPosition({ ...entry(), key: { ...key, sessionId: `bounded-${i}` } })
    expect(getWindowScrollPosition('bounded-0')).toBeUndefined()
    expect(getWindowScrollPosition('bounded-100')).toBeDefined()
  })

  it.each([
    { ranges: [], scrollTop: 0 },
    { ranges: [{ startIndex: 0, endIndex: 49, size: 0 }], scrollTop: 0 },
    { ranges: [{ startIndex: 1, endIndex: 49, size: 100 }], scrollTop: 0 },
    { ranges: [{ startIndex: 0, endIndex: 10, size: 100 }], scrollTop: 0 },
    { ranges: [{ startIndex: 0, endIndex: 49, size: 100 }], scrollTop: NaN },
  ])('rejects incomplete or invalid measurements %j', (snapshot) => {
    expect(boundedWindowSnapshot(snapshot, 50)).toBeNull()
  })
})
