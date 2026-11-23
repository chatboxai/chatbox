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

  test('offsets start-aligned targets by the top inset and leaves the tail at the bottom', () => {
    const items = buildMessageRenderItems([
      { id: 'u', role: 'user', contentParts: [] },
      { id: 'a', role: 'assistant', contentParts: [] },
      { id: 'u2', role: 'user', contentParts: [] },
    ])
    const anchor = { threadId: 't', messageId: 'u2' }
    expect(getTranscriptItemLocation(items, { requestId: 1, kind: 'anchor', anchor }, 95)).toEqual({
      index: 2,
      align: 'start',
      offset: -95,
    })
    expect(getTranscriptItemLocation(items, { requestId: 2, kind: 'head', anchor }, 95)).toEqual({
      index: 0,
      align: 'start',
      offset: -95,
    })
    expect(getTranscriptItemLocation(items, { requestId: 3, kind: 'tail', anchor }, 95)).toEqual({
      index: 'LAST',
      align: 'end',
    })
    expect(getTranscriptItemLocation(items, null, 95)).toEqual({ index: 'LAST', align: 'end' })
  })
})
