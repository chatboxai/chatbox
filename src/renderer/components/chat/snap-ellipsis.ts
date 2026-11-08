import { type RefObject, useLayoutEffect } from 'react'

const ELLIPSIS = '…'

/**
 * Width that a text of `charCount` characters takes when truncated with a trailing ellipsis inside `available`
 * pixels: the longest prefix that fits together with the ellipsis. Text that fits is returned at its own width.
 */
export function getEllipsizedWidth(
  charCount: number,
  available: number,
  prefixWidth: (chars: number) => number,
  ellipsisWidth: number
): number {
  const full = prefixWidth(charCount)
  if (full <= available) return full
  let low = 0
  let high = charCount - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (prefixWidth(mid) + ellipsisWidth <= available) low = mid
    else high = mid - 1
  }
  return prefixWidth(low) + ellipsisWidth
}

/**
 * Ellipsis widths by computed font. A web font replacing its fallback keeps the same font string, so the cache is
 * cleared whenever fonts finish loading.
 */
const ellipsisWidths = new Map<string, number>()

/** Width of the ellipsis in `element`'s font, measured once per font through a hidden span. */
function measureEllipsis(element: HTMLElement): number {
  const style = getComputedStyle(element)
  const key = `${style.font}|${style.letterSpacing}`
  const cached = ellipsisWidths.get(key)
  if (cached !== undefined) return cached
  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;pointer-events:none;'
  probe.textContent = ELLIPSIS
  element.appendChild(probe)
  const width = probe.getBoundingClientRect().width
  probe.remove()
  ellipsisWidths.set(key, width)
  return width
}

/**
 * Target width of one overflowing element, read from the laid-out text without changing the DOM; undefined when the
 * element does not overflow or does not hold a single text node.
 */
function readSnapWidth(element: HTMLElement, range: Range): number | undefined {
  if (element.scrollWidth <= element.clientWidth) return undefined
  const node = element.firstChild
  if (!(node instanceof Text) || node.nextSibling) return undefined
  // Character boundaries in UTF-16 offsets, so a prefix never splits a surrogate pair.
  const offsets = [0]
  for (const char of Array.from(node.data)) offsets.push(offsets[offsets.length - 1] + char.length)
  const prefixWidth = (chars: number) => {
    range.setStart(node, 0)
    range.setEnd(node, offsets[chars])
    return range.getBoundingClientRect().width
  }
  return getEllipsizedWidth(
    offsets.length - 1,
    element.getBoundingClientRect().width,
    prefixWidth,
    measureEllipsis(element)
  )
}

/**
 * A truncated element keeps its flex width, so the space between the ellipsis and the box end shows up as a wider gap
 * before the next item. This narrows every overflowing `[data-snap-ellipsis]` element inside `rowRef` to the width
 * its ellipsized text takes, leaving the spare space at the end of the row. It re-runs, at most once per frame, when
 * the row resizes or web fonts finish loading. Right-to-left rows keep the plain CSS ellipsis.
 */
export function useSnapEllipsis(rowRef: RefObject<HTMLElement | null>, contentKey: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the row's text changes
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row || typeof ResizeObserver === 'undefined') return
    const snap = () => {
      const items = Array.from(row.querySelectorAll<HTMLElement>('[data-snap-ellipsis]'))
      for (const item of items) item.style.maxWidth = ''
      if (getComputedStyle(row).direction === 'rtl') return
      const range = document.createRange()
      const widths = items.map((item) => readSnapWidth(item, range))
      items.forEach((item, index) => {
        const width = widths[index]
        // Half a pixel of room absorbs layout rounding without a visible gap.
        if (width !== undefined) item.style.maxWidth = `${width + 0.5}px`
      })
    }
    let frame: number | undefined
    const schedule = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        snap()
      })
    }
    snap()
    const observer = new ResizeObserver(schedule)
    observer.observe(row)
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    let active = true
    const remeasureFonts = () => {
      ellipsisWidths.clear()
      schedule()
    }
    void fonts?.ready.then(() => {
      if (active) remeasureFonts()
    })
    fonts?.addEventListener('loadingdone', remeasureFonts)
    return () => {
      active = false
      observer.disconnect()
      fonts?.removeEventListener('loadingdone', remeasureFonts)
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [rowRef, contentKey])
}
