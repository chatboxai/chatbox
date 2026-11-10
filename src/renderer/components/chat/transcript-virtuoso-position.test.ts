import { describe, expect, test } from 'vitest'
import { buildMessageRenderItems } from './message-render-items'
import { getTranscriptFirstItemIndex, getTranscriptItemLocation } from './transcript-virtuoso-position'

describe('Virtuoso transcript positions', () => {
  test('counts prepended render items while keeping the grouped last turn at its absolute index', () => {
    const tail = buildMessageRenderItems([
      { id: 'u', role: 'user', contentParts: [] },
      { id: 'a', role: 'assistant', contentParts: [] },
    ])
    const expanded = buildMessageRenderItems([
      { id: 'older-u', role: 'user', contentParts: [] },
      { id: 'older-a', role: 'assistant', contentParts: [] },
      { id: 'u', role: 'user', contentParts: [] },
      { id: 'a', role: 'assistant', contentParts: [] },
    ])
    expect(tail).toHaveLength(1)
    expect(getTranscriptFirstItemIndex(tail, expanded, 1000)).toBe(998)
    expect(getTranscriptFirstItemIndex(expanded, tail, 998)).toBe(1000)
  })

  test('counts thread heading items and leaves appended data at the same first index', () => {
    const previous = [{ key: 'm1' }, { key: 'm2' }]
    expect(getTranscriptFirstItemIndex(previous, [{ key: 'thread' }, ...previous], 1000)).toBe(999)
    expect(getTranscriptFirstItemIndex(previous, [...previous, { key: 'm3' }], 1000)).toBe(1000)
    expect(getTranscriptFirstItemIndex(previous, [{ key: 'other' }], 1000)).toBe(1000)
  })

  test('uses local indexes for explicit message navigation, including the grouped assistant', () => {
    const items = buildMessageRenderItems([
      { id: 'system', role: 'system', contentParts: [] },
      { id: 'u', role: 'user', contentParts: [] },
      { id: 'a', role: 'assistant', contentParts: [] },
    ])
    expect(
      getTranscriptItemLocation(items, { requestId: 1, kind: 'anchor', anchor: { threadId: 't', messageId: 'a' } })
    ).toEqual({ index: 1, align: 'start' })
    expect(
      getTranscriptItemLocation(items, { requestId: 2, kind: 'tail', anchor: { threadId: 't', messageId: 'a' } })
    ).toEqual({ index: 'LAST', align: 'end' })
  })
})
