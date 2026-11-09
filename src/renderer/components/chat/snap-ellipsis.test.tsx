// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getEllipsizedWidth, useSnapEllipsis } from './snap-ellipsis'

// Monospace stand-in: every character, the ellipsis included, is 7px wide.
const CHAR = 7

describe('getEllipsizedWidth', () => {
  const prefix = (chars: number) => chars * CHAR

  test('keeps text that fits at its own width', () => {
    expect(getEllipsizedWidth(5, 100, prefix, CHAR)).toBe(35)
  })

  test('returns the width of the longest prefix that fits with the ellipsis', () => {
    // 13 characters are 91px; 60px fits 7 characters plus the ellipsis (56px), not 8 (63px).
    expect(getEllipsizedWidth(13, 60, prefix, CHAR)).toBe(56)
  })

  test('falls back to the ellipsis alone when nothing else fits', () => {
    expect(getEllipsizedWidth(13, 3, prefix, CHAR)).toBe(7)
  })
})

describe('useSnapEllipsis', () => {
  let boxWidth = 60
  let ellipsisWidth = CHAR
  let fontListeners: (() => void)[] = []
  let resolveFonts: () => void = () => undefined
  let frames: FrameRequestCallback[] = []

  function Row({ text, dir }: { text: string; dir?: 'rtl' }) {
    const ref = useRef<HTMLDivElement>(null)
    useSnapEllipsis(ref, text)
    return (
      <div ref={ref} style={dir ? { direction: dir } : undefined}>
        <span data-snap-ellipsis>{text}</span>
      </div>
    )
  }

  function segment(container: HTMLElement) {
    return container.querySelector<HTMLElement>('[data-snap-ellipsis]') as HTMLElement
  }

  function flushFrames() {
    const pending = frames
    frames = []
    for (const callback of pending) callback(0)
  }

  beforeEach(() => {
    boxWidth = 60
    ellipsisWidth = CHAR
    fontListeners = []
    frames = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const ready = new Promise<void>((resolve) => {
      resolveFonts = resolve
    })
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        ready,
        addEventListener: (_type: string, listener: () => void) => fontListeners.push(listener),
        removeEventListener: (_type: string, listener: () => void) => {
          fontListeners = fontListeners.filter((item) => item !== listener)
        },
      },
    })
    // Layout stand-ins: the segment box is `boxWidth` wide and its text is 7px per character.
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return (this.textContent?.length ?? 0) * CHAR
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => boxWidth)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-snap-ellipsis')) return { width: boxWidth } as DOMRect
      const width = this.textContent === '…' ? ellipsisWidth : (this.textContent?.length ?? 0) * CHAR
      return { width } as DOMRect
    })
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let end = 0
      return {
        setStart: () => undefined,
        setEnd: (_node: Node, offset: number) => {
          end = offset
        },
        getBoundingClientRect: () => ({ width: end * CHAR }) as DOMRect,
      } as unknown as Range
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'fonts')
  })

  test('narrows an overflowing segment to its ellipsized text and leaves fitting text alone', () => {
    const { container } = render(<Row text="deepseek-chat" />)
    expect(segment(container).style.maxWidth).toBe('56.5px')
    cleanup()
    const fitting = render(<Row text="13:25" />)
    expect(segment(fitting.container).style.maxWidth).toBe('')
  })

  test('measures again once web fonts finish loading, at most once per frame', async () => {
    const { container } = render(<Row text="deepseek-chat" />)
    boxWidth = 80
    for (const listener of fontListeners) listener()
    await act(async () => resolveFonts())
    expect(frames).toHaveLength(1)
    flushFrames()
    // 80px fits 10 characters plus the ellipsis (77px).
    expect(segment(container).style.maxWidth).toBe('77.5px')
  })

  test('measures the ellipsis again when a web font replaces its fallback under the same font name', () => {
    boxWidth = 80
    const { container } = render(<Row text="deepseek-chat" />)
    // 10 characters (70px) plus a 7px ellipsis.
    expect(segment(container).style.maxWidth).toBe('77.5px')
    ellipsisWidth = 10
    for (const listener of fontListeners) listener()
    flushFrames()
    // Still 10 characters, now with a 10px ellipsis.
    expect(segment(container).style.maxWidth).toBe('80.5px')
  })

  test('stops listening for fonts after unmount', () => {
    const { unmount } = render(<Row text="deepseek-chat" />)
    expect(fontListeners).toHaveLength(1)
    unmount()
    expect(fontListeners).toHaveLength(0)
  })

  test('keeps the plain CSS ellipsis in right-to-left rows', () => {
    const { container } = render(<Row text="deepseek-chat" dir="rtl" />)
    expect(segment(container).style.maxWidth).toBe('')
  })
})
