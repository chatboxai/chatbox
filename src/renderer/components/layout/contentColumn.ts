import { cn } from '@/lib/utils'

/**
 * Chat content column. Messages, the composer and the cards around the composer share it so that
 * avatars, message bodies and the input box line up on both edges.
 */
export function contentColumnClassName(widthFull: boolean) {
  return widthFull ? 'w-full' : 'w-full max-w-4xl mx-auto'
}

/** Content column with the same 16px inset a message row applies to itself. */
export function paddedContentColumnClassName(widthFull: boolean) {
  return cn(contentColumnClassName(widthFull), 'px-md')
}
