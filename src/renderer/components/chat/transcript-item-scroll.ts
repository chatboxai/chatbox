import type { VirtuosoHandle } from 'react-virtuoso'

/** Uses virtual measurements to mount a target; the caller confirms its actual DOM geometry. */
export function scrollToTranscriptItem(
  list: Pick<VirtuosoHandle, 'scrollIntoView' | 'scrollTo'>,
  viewport: HTMLElement,
  index: number,
  align: 'start' | 'end' | 'center' = 'start',
  behavior: 'auto' | 'smooth' = 'auto',
  isCurrent: () => boolean = () => true
) {
  list.scrollIntoView({
    index,
    calculateViewLocation: ({ itemTop, itemBottom, viewportTop, viewportBottom }) => {
      if (!isCurrent()) return null
      const delta =
        align === 'end'
          ? itemBottom - viewportBottom
          : align === 'center'
            ? (itemTop + itemBottom - viewportTop - viewportBottom) / 2
            : itemTop - viewportTop
      if (Number.isFinite(delta)) list.scrollTo({ top: Math.max(0, viewport.scrollTop + delta), behavior })
      // Layout ownership stays with the host instead of an independently retrying index seek.
      return null
    },
  })
}

/** A visible target may be constrained by the start or end of the loaded window. */
export function transcriptAnchorLayoutSettled(
  viewport: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  correction: number,
  targetVisible: boolean
): boolean {
  if (Math.abs(correction) <= 0.5) return true
  if (!targetVisible || !Number.isFinite(correction)) return false
  const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  const achievableTop = Math.max(0, Math.min(maxTop, viewport.scrollTop + correction))
  return Math.abs(achievableTop - viewport.scrollTop) <= 0.5
}
