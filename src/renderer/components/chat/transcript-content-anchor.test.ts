// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTranscriptContentAnchor } from './transcript-content-anchor'

let resize: ResizeObserverCallback
const observed = new Set<Element>()
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
const rect = (top: number, height = 20): DOMRect => ({
  top,
  bottom: top + height,
  left: 0,
  right: 600,
  width: 600,
  height,
  x: 0,
  y: top,
  toJSON: () => ({}),
})
function flushFrames() {
  for (let count = 0; count < 15 && frames.size; count++) {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback(count * 16))
  }
}
function resizeBlock(element: HTMLElement) {
  resize(
    [
      {
        target: element,
        contentRect: element.getBoundingClientRect(),
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      },
    ],
    {} as ResizeObserver
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  if (!Range.prototype.getBoundingClientRect)
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: () => rect(0, 0),
    })
  frames.clear()
  observed.clear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }
      observe(element: Element) {
        observed.add(element)
      }
      unobserve(element: Element) {
        observed.delete(element)
      }
      disconnect() {
        observed.clear()
      }
    }
  )
})
afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'caretRangeFromPoint')
})

function fixture() {
  const viewport = document.createElement('div')
  const message = document.createElement('div')
  message.dataset.transcriptMessage = 'message'
  const image = document.createElement('p')
  image.dataset.transcriptBlock = 'part:0'
  const block = document.createElement('p')
  block.dataset.transcriptBlock = 'part:12'
  block.textContent = 'A stable visible paragraph'
  message.append(image, block)
  viewport.append(message)
  document.body.append(viewport)
  let imageHeight = 180
  let scroll = 200
  let suspended = false
  const scrollBy = vi.fn((delta: number) => {
    scroll += delta
  })
  viewport.getBoundingClientRect = () => rect(0, 400)
  Object.defineProperty(viewport, 'scrollTop', {
    get: () => scroll,
    set: (value: number) => {
      scroll = value
    },
  })
  message.getBoundingClientRect = () => rect(-scroll, imageHeight + 800)
  image.getBoundingClientRect = () => rect(-scroll, imageHeight)
  block.getBoundingClientRect = () => rect(imageHeight + 40 - scroll, 80)
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() => rect(imageHeight + 40 - scroll, 16))
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: () => {
      const range = document.createRange()
      range.setStart(block.firstChild!, 2)
      range.collapse(true)
      return range
    },
  })
  const anchor = createTranscriptContentAnchor({ viewport: () => viewport, suspended: () => suspended, scrollBy })
  anchor.connect(viewport)
  return {
    viewport,
    message,
    image,
    block,
    anchor,
    scrollBy,
    height(value: number) {
      imageHeight = value
    },
    scroll(value: number) {
      scroll = value
    },
    suspend(value: boolean) {
      suspended = value
    },
  }
}

describe('mounted transcript content anchors', () => {
  it('lets the virtual list measure newly mounted rows without a second reading-position correction', async () => {
    const f = fixture()
    f.anchor.remember()
    f.anchor.onUserInput()
    const earlier = document.createElement('div')
    earlier.dataset.transcriptMessage = 'earlier'
    const block = document.createElement('p')
    block.dataset.transcriptBlock = 'part:0'
    block.textContent = 'A newly mounted row'
    block.getBoundingClientRect = () => rect(-400, 100)
    earlier.append(block)
    f.viewport.prepend(earlier)
    await Promise.resolve()
    resizeBlock(block)
    expect(frames.size).toBe(0)

    // Row measurements and the virtual list's compensation can change scrollTop within the gesture.
    f.scroll(240)
    f.anchor.onScroll()
    resizeBlock(block)
    flushFrames()
    vi.advanceTimersByTime(120)
    flushFrames()
    expect(f.scrollBy).not.toHaveBeenCalled()
    f.anchor.disconnect()
  })

  it('waits for the host measurement before correcting a real content reflow', () => {
    const f = fixture()
    f.anchor.remember()
    f.height(360)
    resizeBlock(f.image)
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback(16))
    expect(f.scrollBy).not.toHaveBeenCalled()
    f.scroll(380)
    f.anchor.onScroll()
    flushFrames()
    expect(f.scrollBy).not.toHaveBeenCalled()
    f.anchor.disconnect()
  })

  it('preserves the visible text when an earlier image changes height inside the same message', () => {
    const f = fixture()
    const before = f.anchor.capture()!
    expect(before.messageId).toBe('message')
    expect(JSON.parse(before.blockId!)).toMatchObject({ id: 'part:12', path: [0], character: 2 })
    f.anchor.remember()
    f.height(360)
    resizeBlock(f.image)
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledWith(180)
    expect(f.anchor.correction(before)).toBe(0)
    expect(frames.size).toBe(0)
    f.anchor.disconnect()
  })

  it('adopts the transaction anchor before later image measurements settle', () => {
    const f = fixture()
    const before = f.anchor.capture()!
    f.height(240)
    f.anchor.adopt(before)
    resizeBlock(f.image)
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledWith(60)
    expect(f.anchor.correction(before)).toBe(0)
    f.anchor.disconnect()
  })

  it('restores a character within a block after text reflow even when the block top does not move', () => {
    const f = fixture()
    let characterTop = 20
    vi.mocked(Range.prototype.getBoundingClientRect).mockImplementation(() => rect(characterTop, 16))
    const before = f.anchor.capture()!
    characterTop = 76
    expect(f.anchor.correction(before)).toBe(56)
    f.anchor.disconnect()
  })

  it('keeps the same visible character across successive width measurements', () => {
    const f = fixture()
    let blockWidth = 600
    f.block.getBoundingClientRect = () => ({ ...rect(220 - f.viewport.scrollTop, 80), width: blockWidth })
    let character = 12
    let earlierCharacterY = 220
    let originalCharacterY = 220
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: () => {
        const range = document.createRange()
        range.setStart(f.block.firstChild!, character)
        range.collapse(true)
        return range
      },
    })
    vi.mocked(Range.prototype.getBoundingClientRect).mockImplementation(function (this: Range) {
      return rect((this.startOffset === 12 ? originalCharacterY : earlierCharacterY) - f.viewport.scrollTop, 21)
    })
    const before = f.anchor.capture()!
    f.anchor.remember()
    earlierCharacterY += 60
    originalCharacterY += 60
    blockWidth = 540
    // The first measurement now places an earlier character under the same viewport coordinate.
    character = 2
    resizeBlock(f.block)
    flushFrames()
    expect(f.anchor.correction(before)).toBe(0)
    expect(f.scrollBy).toHaveBeenCalledExactlyOnceWith(60)

    // A later wrapping boundary moves the original character to the following text line.
    originalCharacterY += 21
    blockWidth = 500
    resizeBlock(f.block)
    flushFrames()
    expect(f.scrollBy).toHaveBeenLastCalledWith(21)
    expect(f.anchor.correction(before)).toBe(0)
    expect(frames.size).toBe(0)
    f.anchor.disconnect()
  })

  it.each(['scroll-before-resize', 'resize-before-scroll'] as const)(
    'keeps the original character through native zoom rounding: %s',
    (order) => {
      const f = fixture()
      let character = 12
      let originalCharacterY = 220
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: () => {
          const range = document.createRange()
          range.setStart(f.block.firstChild!, character)
          range.collapse(true)
          return range
        },
      })
      vi.mocked(Range.prototype.getBoundingClientRect).mockImplementation(function (this: Range) {
        return rect((this.startOffset === 12 ? originalCharacterY : 220) - f.viewport.scrollTop, 21)
      })
      const before = f.anchor.capture()!
      f.anchor.remember()
      originalCharacterY += 1600
      character = 2
      f.viewport.getBoundingClientRect = () => ({ ...rect(0, 350), width: 500, right: 500 })
      f.scroll(199.75)
      if (order === 'resize-before-scroll') resizeBlock(f.viewport)
      f.anchor.onScroll()
      if (order === 'scroll-before-resize') resizeBlock(f.viewport)
      flushFrames()
      expect(f.scrollBy).toHaveBeenCalledExactlyOnceWith(1600.25)
      expect(f.anchor.correction(before)).toBe(0)
      expect(frames.size).toBe(0)
      f.anchor.disconnect()
    }
  )

  it('accepts focus scrolling after viewport reflow has restored its reading point', () => {
    const f = fixture()
    f.anchor.remember()
    f.viewport.getBoundingClientRect = () => ({ ...rect(0, 350), width: 500, right: 500 })
    f.height(360)
    f.scroll(199.75)
    f.anchor.onScroll()
    resizeBlock(f.viewport)
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledExactlyOnceWith(180.25)
    f.scroll(420)
    f.anchor.onScroll()
    const focusedTop = f.block.getBoundingClientRect().top
    f.height(420)
    resizeBlock(f.image)
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledTimes(2)
    expect(f.scrollBy).toHaveBeenLastCalledWith(60)
    expect(f.block.getBoundingClientRect().top).toBe(focusedTop)
    f.anchor.disconnect()
  })

  it('accepts focus scrolling while a completed resize is waiting for its stable frame', () => {
    const f = fixture()
    f.anchor.remember()
    f.height(360)
    resizeBlock(f.image)
    for (let index = 0; index < 2; index++) {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((callback) => callback(index * 16))
    }
    expect(f.scrollBy).toHaveBeenCalledExactlyOnceWith(180)
    expect(frames.size).toBe(1)
    f.scroll(420)
    f.anchor.onScroll()
    const focusedTop = f.block.getBoundingClientRect().top
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledTimes(1)
    expect(f.block.getBoundingClientRect().top).toBe(focusedTop)
    f.anchor.disconnect()
  })

  it('keeps real user scroll displacement during a viewport resize', () => {
    const f = fixture()
    f.anchor.remember()
    f.anchor.onUserInput()
    f.viewport.getBoundingClientRect = () => ({ ...rect(0, 350), width: 500, right: 500 })
    f.height(360)
    f.scroll(230)
    f.anchor.onScroll()
    resizeBlock(f.viewport)
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledExactlyOnceWith(180)
    expect(f.block.getBoundingClientRect().top).toBe(-10)
    f.anchor.disconnect()
  })

  it('does not double compensate host layout and preserves the user delta during an image resize', () => {
    const f = fixture()
    f.anchor.remember()
    f.height(360)
    f.scroll(380)
    resizeBlock(f.image)
    flushFrames()
    expect(f.scrollBy).not.toHaveBeenCalled()
    f.anchor.onUserInput()
    f.height(480)
    f.scroll(400)
    resizeBlock(f.image)
    f.anchor.onScroll()
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledExactlyOnceWith(120)
    expect(f.block.getBoundingClientRect().top).toBe(0)
    vi.advanceTimersByTime(120)
    f.anchor.disconnect()
  })

  it('uses the new visible point after focus or text-selection scrolling without a wheel event', () => {
    const f = fixture()
    f.anchor.remember()
    f.scroll(240)
    f.anchor.onScroll()
    const visibleTop = f.block.getBoundingClientRect().top
    f.height(360)
    resizeBlock(f.image)
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledExactlyOnceWith(180)
    expect(f.block.getBoundingClientRect().top).toBe(visibleTop)
    f.anchor.onScroll()
    resizeBlock(f.image)
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledTimes(1)
    f.anchor.disconnect()
  })

  it.each(['wheel', 'touch'] as const)('captures the visible point when %s takes over from following', (gesture) => {
    const f = fixture()
    const tail = document.createElement('p')
    tail.dataset.transcriptBlock = 'part:1000'
    tail.textContent = 'Tail paragraph'
    tail.getBoundingClientRect = () => rect(880 - f.viewport.scrollTop, 80)
    f.message.append(tail)
    f.anchor.connect(f.viewport)
    f.scroll(800)
    f.anchor.adopt(f.anchor.capture())
    f.suspend(true)
    // Focus or selection can move inside a mounted message while tail following owns scrolling.
    f.scroll(200)
    f.anchor.onScroll()
    f.anchor.onUserInput()
    if (gesture === 'wheel') {
      f.scroll(220)
      f.anchor.onScroll()
      vi.advanceTimersByTime(120)
    }
    f.suspend(false)
    f.anchor.onUserInput()
    const before = f.block.getBoundingClientRect().top
    f.scroll(f.viewport.scrollTop - 10)
    f.anchor.onScroll()
    flushFrames()
    expect(f.scrollBy).not.toHaveBeenCalled()
    expect(f.block.getBoundingClientRect().top).toBe(before + 10)
    // The new reading point still receives local height compensation during the same gesture.
    f.height(240)
    resizeBlock(f.image)
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledExactlyOnceWith(60)
    expect(f.block.getBoundingClientRect().top).toBe(before + 10)
    f.anchor.disconnect()
  })

  it('cancels a queued correction when another scroll owner takes control', () => {
    const f = fixture()
    f.anchor.remember()
    f.height(240)
    resizeBlock(f.image)
    expect(frames.size).toBe(1)
    f.suspend(true)
    f.scroll(260)
    f.anchor.onScroll()
    expect(frames.size).toBe(0)
    f.suspend(false)
    f.anchor.onUserInput()
    const before = f.block.getBoundingClientRect().top
    f.height(300)
    resizeBlock(f.image)
    flushFrames()
    expect(f.scrollBy).toHaveBeenCalledExactlyOnceWith(60)
    expect(f.block.getBoundingClientRect().top).toBe(before)
    f.anchor.disconnect()
  })

  it('takes the current visible point after a suspended height change', () => {
    const f = fixture()
    f.anchor.remember()
    f.suspend(true)
    f.height(240)
    resizeBlock(f.image)
    f.suspend(false)
    f.anchor.onUserInput()
    const before = f.block.getBoundingClientRect().top
    f.scroll(210)
    f.anchor.onScroll()
    flushFrames()
    expect(f.scrollBy).not.toHaveBeenCalled()
    expect(f.block.getBoundingClientRect().top).toBe(before - 10)
    f.anchor.disconnect()
  })

  it('leaves navigation transactions in charge and releases removed blocks', async () => {
    const f = fixture()
    const before = f.anchor.capture()!
    f.anchor.remember()
    f.suspend(true)
    f.height(360)
    resizeBlock(f.image)
    flushFrames()
    expect(f.scrollBy).not.toHaveBeenCalled()
    f.block.remove()
    await Promise.resolve()
    expect(observed.has(f.block)).toBe(false)
    expect(f.anchor.correction(before)).toBe(0)
    expect(f.anchor.messageOffset(before)).toBe(-200)
    f.anchor.disconnect()
    expect(observed.size).toBe(0)
    expect(f.anchor.capture()).toBeNull()
  })

  it('does logarithmic block geometry reads during capture and discards its index on unmount', () => {
    const viewport = document.createElement('div')
    viewport.dataset.transcriptMessage = 'large'
    viewport.getBoundingClientRect = () => rect(0, 400)
    const measure = vi.fn((index: number) => rect((index - 700) * 20))
    for (let index = 0; index < 1024; index++) {
      const block = document.createElement('p')
      block.dataset.transcriptBlock = `part:${index}`
      block.textContent = 'fixture'
      block.getBoundingClientRect = () => measure(index)
      viewport.append(block)
    }
    document.body.append(viewport)
    const anchor = createTranscriptContentAnchor({
      viewport: () => viewport,
      suspended: () => false,
      scrollBy: vi.fn(),
    })
    anchor.connect(viewport)
    measure.mockClear()
    expect(JSON.parse(anchor.capture()!.blockId!).id).toBe('part:700')
    expect(measure.mock.calls.length).toBeLessThanOrEqual(12)
    anchor.disconnect()
    expect(observed.size).toBe(0)
  })
})
