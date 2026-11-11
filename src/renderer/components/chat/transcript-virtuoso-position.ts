import type { SessionTranscriptLayoutRequest } from '@chatbox/react/query'
import type { FlatIndexLocationWithAlign } from 'react-virtuoso'
import type { MessageRenderItem } from './message-render-items'

export function getTranscriptFirstItemIndex(
  previous: readonly Pick<MessageRenderItem, 'key'>[],
  next: readonly Pick<MessageRenderItem, 'key'>[],
  firstItemIndex: number
): number {
  if (!previous.length || !next.length || previous[0].key === next[0].key) return firstItemIndex
  const prepended = next.findIndex((item) => item.key === previous[0].key)
  if (prepended >= 0) return firstItemIndex - prepended
  const removed = previous.findIndex((item) => item.key === next[0].key)
  return removed >= 0 ? firstItemIndex + removed : firstItemIndex
}

/**
 * Where an explicit layout lands. Start-aligned targets move down by `topInset`, the height of a header
 * overlaying the top of the list, so they land below it.
 */
export function getTranscriptItemLocation(
  items: readonly MessageRenderItem[],
  layout: SessionTranscriptLayoutRequest | null,
  topInset = 0
): FlatIndexLocationWithAlign {
  if (!layout || layout.kind === 'tail') return { index: 'LAST', align: 'end' }
  const index = items.findIndex((item) => item.messages.some((message) => message.id === layout.anchor.messageId))
  return withTopInset({ index: layout.kind === 'head' ? 0 : Math.max(0, index), align: 'start' }, topInset)
}

/** Moves a start-aligned location down by `topInset`; other alignments are unaffected. */
export function withTopInset<T extends { align?: 'start' | 'center' | 'end'; offset?: number }>(
  location: T,
  topInset: number
): T {
  if (!topInset || (location.align ?? 'start') !== 'start') return location
  return { ...location, offset: (location.offset ?? 0) - topInset }
}
