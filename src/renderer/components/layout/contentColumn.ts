import { cn } from '@/lib/utils'

/**
 * Full-width column: grows with the main area at 45% of the space past 960px, up to 1600px, and fills areas narrower
 * than 960px. The width resolves against the main-area query container (`100cqw`), not the parent box, so the
 * transcript (inside a scroller that reserves scrollbar gutters) and the composer get the same width.
 */
const WIDE_CONTENT_COLUMN_CLASS_NAME = 'w-[min(1600px,calc(960px_+_(100cqw_-_960px)_*_0.45))] max-w-full mx-auto'

/**
 * Main-area wrapper that every full-width content column on the page measures against. Apply it to the element
 * spanning the chat area (messages and composer); no other query container may sit between it and the columns.
 */
export function contentColumnContainerClassName(widthFull: boolean) {
  return widthFull ? '[container-type:inline-size]' : ''
}

/**
 * Chat content column. Messages, the composer and the cards around the composer share it so that
 * avatars, message bodies and the input box line up on both edges.
 */
export function contentColumnClassName(widthFull: boolean) {
  return widthFull ? WIDE_CONTENT_COLUMN_CLASS_NAME : 'w-full max-w-4xl mx-auto'
}

/** Content column with the same 16px inset a message row applies to itself. */
export function paddedContentColumnClassName(widthFull: boolean) {
  return cn(contentColumnClassName(widthFull), 'px-md')
}
