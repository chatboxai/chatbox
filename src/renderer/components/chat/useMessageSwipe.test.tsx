// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageSwipeStartContext } from './message-swipe-start'
import { useMessageLongPress } from './useMessageLongPress'
import { type MessageSwipeMode, useMessageSwipe } from './useMessageSwipe'
import { useSingleFlightAction } from './useSingleFlightAction'

const haptic = vi.hoisted(() => ({ arm: vi.fn(), longPress: vi.fn() }))
vi.mock('@/utils/long-press-haptic', () => ({
  triggerSwipeArmHaptic: haptic.arm,
  triggerLongPressHaptic: haptic.longPress,
}))

function Harness({
  mode,
  onRetry,
  onLongPress = () => undefined,
}: {
  mode: MessageSwipeMode
  onRetry(): void
  onLongPress?(): void
}) {
  const targetRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  useMessageSwipe({ mode, onRetry, targetRef, rowRef, surfaceRef })
  const longPress = useMessageLongPress({ enabled: true, onLongPress })
  return (
    <div data-testid="scroller" style={{ overflowY: 'auto' }}>
      <div data-testid="message" ref={targetRef} {...longPress}>
        <div data-testid="row" ref={rowRef}>
          <p data-testid="text" ref={surfaceRef}>
            reply
          </p>
          <pre data-testid="code" style={{ overflowX: 'auto' }}>
            <code data-testid="code-line">const x = 1</code>
          </pre>
        </div>
      </div>
    </div>
  )
}

/** Swipe and the long-press menu's "Reply Again" share one run, wired as in Message. */
function ReplyAgainHarness({ replyAgain }: { replyAgain(): Promise<void> }) {
  const { pending, run } = useSingleFlightAction()
  return (
    <>
      <Harness mode={pending ? 'unavailable' : 'retry'} onRetry={() => void run(replyAgain)} />
      <button type="button" data-testid="menu-reply-again" onClick={() => void run(replyAgain)} />
    </>
  )
}

const point = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] })

/** Drags from (x, y) by `dx` / `dy` in small steps, painting each frame. */
function drag(target: Element, x: number, y: number, dx: number, dy = 0) {
  fireEvent.touchStart(target, point(x, y))
  const steps = 8
  for (let step = 1; step <= steps; step++) {
    fireEvent.touchMove(target, point(x + (dx * step) / steps, y + (dy * step) / steps))
    vi.advanceTimersByTime(16)
  }
}

const release = (target: Element) => fireEvent.touchEnd(target, { touches: [] })
const stateOf = () => screen.getByTestId('row').dataset.swipeState
const turnOf = () => screen.getByTestId('row').style.getPropertyValue('--message-swipe-turn')
const pinOf = (name: string) => screen.getByTestId('row').style.getPropertyValue(`--message-swipe-${name}`)

function placeRect(testId: string, rect: { top: number; height: number; left?: number; width?: number }) {
  const { top, height, left = 0, width = 390 } = rect
  vi.spyOn(screen.getByTestId(testId), 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: left, y: top, width, height })
  )
}

const offsetOf = (element: HTMLElement) => Number(/translateX\(([\d.]+)px\)/.exec(element.style.transform)?.[1] ?? 0)

let clock = Date.UTC(2031, 0, 1)
beforeEach(() => {
  vi.useFakeTimers()
  clock += 3_600_000
  vi.setSystemTime(clock)
  haptic.arm.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('replies again once after releasing past the threshold and the row settling back', () => {
  const onRetry = vi.fn()
  render(<Harness mode="retry" onRetry={onRetry} />)
  const text = screen.getByTestId('text')
  expect(stateOf()).toBe('idle')
  drag(text, 100, 200, 120)
  // The message follows a fifth of the finger and stops at 14px; the threshold is the finger's 96px.
  expect(offsetOf(screen.getByTestId('row'))).toBe(14)
  expect(stateOf()).toBe('armed')
  expect(turnOf()).toBe('-180deg')
  expect(haptic.arm).toHaveBeenCalledTimes(1)

  release(text)
  expect(screen.getByTestId('row').style.transform).toBe('')
  expect(stateOf()).toBe('idle')
  expect(onRetry).not.toHaveBeenCalled()
  vi.advanceTimersByTime(180)
  expect(onRetry).toHaveBeenCalledTimes(1)
})

it('springs back without replying when released under the threshold', () => {
  const onRetry = vi.fn()
  render(<Harness mode="retry" onRetry={onRetry} />)
  const text = screen.getByTestId('text')
  drag(text, 100, 200, 80)
  expect(offsetOf(screen.getByTestId('row'))).toBe(14)
  expect(stateOf()).toBe('dragging')
  expect(turnOf()).toBe('-150deg')
  release(text)
  vi.advanceTimersByTime(500)
  expect(onRetry).not.toHaveBeenCalled()
  expect(haptic.arm).not.toHaveBeenCalled()
})

it('disarms when dragged back under the threshold before release', () => {
  const onRetry = vi.fn()
  render(<Harness mode="retry" onRetry={onRetry} />)
  const text = screen.getByTestId('text')
  drag(text, 100, 200, 120)
  fireEvent.touchMove(text, point(140, 200))
  vi.advanceTimersByTime(16)
  expect(stateOf()).toBe('dragging')
  release(text)
  vi.advanceTimersByTime(500)
  expect(onRetry).not.toHaveBeenCalled()
  expect(haptic.arm).toHaveBeenCalledTimes(1)
})

it('plays the arm haptic once per gesture even when re-armed after dragging back', () => {
  render(<Harness mode="retry" onRetry={vi.fn()} />)
  const text = screen.getByTestId('text')
  drag(text, 100, 200, 120)
  fireEvent.touchMove(text, point(140, 200))
  fireEvent.touchMove(text, point(260, 200))
  vi.advanceTimersByTime(16)
  expect(stateOf()).toBe('armed')
  expect(haptic.arm).toHaveBeenCalledTimes(1)
  release(text)
  vi.advanceTimersByTime(500)

  drag(text, 100, 200, 120)
  expect(haptic.arm).toHaveBeenCalledTimes(2)
})

it('ignores touches that start in the left edge zone', () => {
  const onRetry = vi.fn()
  render(<Harness mode="retry" onRetry={onRetry} />)
  const text = screen.getByTestId('text')
  drag(text, 20, 200, 150)
  expect(screen.getByTestId('row').style.transform).toBe('')
  release(text)
  vi.advanceTimersByTime(500)
  expect(onRetry).not.toHaveBeenCalled()
})

it('leaves touches inside a horizontally scrollable block to that block', () => {
  const onRetry = vi.fn()
  render(<Harness mode="retry" onRetry={onRetry} />)
  const code = screen.getByTestId('code')
  Object.defineProperty(code, 'scrollWidth', { configurable: true, value: 600 })
  Object.defineProperty(code, 'clientWidth', { configurable: true, value: 300 })
  const line = screen.getByTestId('code-line')
  drag(line, 100, 200, 150)
  expect(screen.getByTestId('row').style.transform).toBe('')
  release(line)
  vi.advanceTimersByTime(500)
  expect(onRetry).not.toHaveBeenCalled()
})

it('swipes from a code block that fits without scrolling', () => {
  const onRetry = vi.fn()
  render(<Harness mode="retry" onRetry={onRetry} />)
  const line = screen.getByTestId('code-line')
  drag(line, 100, 200, 120)
  release(line)
  vi.advanceTimersByTime(180)
  expect(onRetry).toHaveBeenCalledTimes(1)
})

it('gives a vertical drag back to scrolling', () => {
  const onRetry = vi.fn()
  render(<Harness mode="retry" onRetry={onRetry} />)
  const text = screen.getByTestId('text')
  fireEvent.touchStart(text, point(100, 200))
  const vertical = fireEvent.touchMove(text, point(104, 220))
  expect(vertical).toBe(true)
  drag(text, 104, 220, 150)
  // The vertical move ended this touch's swipe; a fresh touch starts a new one.
  expect(screen.getByTestId('row').style.transform).not.toBe('')
  release(text)
  vi.advanceTimersByTime(180)
  expect(onRetry).toHaveBeenCalledTimes(1)
})

it('stops the page from scrolling once the swipe locks horizontally', () => {
  render(<Harness mode="retry" onRetry={() => undefined} />)
  const text = screen.getByTestId('text')
  fireEvent.touchStart(text, point(100, 200))
  expect(fireEvent.touchMove(text, point(106, 200))).toBe(true)
  expect(fireEvent.touchMove(text, point(130, 204))).toBe(false)
  release(text)
})

it('nudges at most 16px and never arms while replying again is unavailable', () => {
  const onRetry = vi.fn()
  render(<Harness mode="unavailable" onRetry={onRetry} />)
  const text = screen.getByTestId('text')
  drag(text, 100, 200, 200)
  // Counts at most 16px of finger travel, so the message moves about 3px.
  expect(offsetOf(screen.getByTestId('row'))).toBeCloseTo(3.2)
  expect(stateOf()).toBe('unavailable')
  expect(turnOf()).toBe('0deg')
  release(text)
  vi.advanceTimersByTime(500)
  expect(onRetry).not.toHaveBeenCalled()
  expect(haptic.arm).not.toHaveBeenCalled()
})

it('cancels the long press once the swipe starts', () => {
  const onRetry = vi.fn()
  const onLongPress = vi.fn()
  render(<Harness mode="retry" onRetry={onRetry} onLongPress={onLongPress} />)
  const text = screen.getByTestId('text')
  drag(text, 100, 200, 30)
  vi.advanceTimersByTime(600)
  expect(onLongPress).not.toHaveBeenCalled()
  release(text)
})

it('does nothing when the message has no swipe', () => {
  const onRetry = vi.fn()
  render(<Harness mode="none" onRetry={onRetry} />)
  const text = screen.getByTestId('text')
  drag(text, 100, 200, 150)
  expect(screen.getByTestId('row').style.transform).toBe('')
  release(text)
  vi.advanceTimersByTime(500)
  expect(onRetry).not.toHaveBeenCalled()
})

it('cancels without replying when a second finger lands', () => {
  const onRetry = vi.fn()
  render(<Harness mode="retry" onRetry={onRetry} />)
  const text = screen.getByTestId('text')
  drag(text, 100, 200, 120)
  fireEvent.touchStart(text, {
    touches: [
      { clientX: 220, clientY: 200 },
      { clientX: 260, clientY: 300 },
    ],
  })
  release(text)
  vi.advanceTimersByTime(500)
  expect(onRetry).not.toHaveBeenCalled()
  expect(screen.getByTestId('row').style.transform).toBe('')
})

it("pins the cue to the visible top while a long reply's top is scrolled away, until release", () => {
  render(<Harness mode="retry" onRetry={vi.fn()} />)
  placeRect('scroller', { top: 90, height: 650 })
  placeRect('row', { top: -810, height: 2000 })
  placeRect('text', { top: -780, height: 1900, left: 32, width: 320 })
  const text = screen.getByTestId('text')
  drag(text, 100, 400, 120)
  expect(stateOf()).toBe('armed')
  // 900px of the row is above the transcript's top; the cue goes 8px below it.
  expect(pinOf('pin')).toBe('908px')
  expect(pinOf('pin-progress')).toBe('1')
  expect(pinOf('band-left')).toBe('32px')
  expect(pinOf('band-width')).toBe('320px')

  release(text)
  expect(stateOf()).toBe('idle')
  expect(pinOf('pin')).toBe('0px')
  expect(pinOf('pin-progress')).toBe('0')
})

it("leaves the cue in place while the reply's top is in view", () => {
  render(<Harness mode="retry" onRetry={vi.fn()} />)
  placeRect('scroller', { top: 90, height: 650 })
  placeRect('row', { top: 300, height: 400 })
  drag(screen.getByTestId('text'), 100, 400, 40)
  expect(stateOf()).toBe('dragging')
  expect(pinOf('pin')).toBe('0px')
  expect(pinOf('pin-progress')).toBe('0')
  release(screen.getByTestId('text'))
})

it('pins the cue while a swipe is refused, so the reason stays in view', () => {
  render(<Harness mode="unavailable" onRetry={vi.fn()} />)
  placeRect('scroller', { top: 90, height: 650 })
  placeRect('row', { top: -10, height: 2000 })
  drag(screen.getByTestId('text'), 100, 400, 60)
  expect(stateOf()).toBe('unavailable')
  // 100px hidden: the cue moves 108px down.
  expect(pinOf('pin')).toBe('108px')
  release(screen.getByTestId('text'))
})

it('tells the transcript once when a swipe locks horizontally', () => {
  const onStart = vi.fn()
  render(
    <MessageSwipeStartContext.Provider value={onStart}>
      <Harness mode="retry" onRetry={vi.fn()} />
    </MessageSwipeStartContext.Provider>
  )
  const text = screen.getByTestId('text')
  drag(text, 100, 200, 0, 120)
  expect(onStart).not.toHaveBeenCalled()
  release(text)
  drag(text, 100, 200, 120)
  expect(onStart).toHaveBeenCalledTimes(1)
  release(text)
})

describe('repeated Reply Again triggers', () => {
  function setup() {
    let finish = () => {}
    const replyAgain = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    render(<ReplyAgainHarness replyAgain={replyAgain} />)
    return { replyAgain, finish: () => act(async () => finish()) }
  }

  function swipe() {
    const text = screen.getByTestId('text')
    drag(text, 100, 200, 120)
    release(text)
    act(() => {
      vi.advanceTimersByTime(180)
    })
  }

  it('replies again once for rapid swipes and shows the swipe as unavailable until it settles', async () => {
    const { replyAgain, finish } = setup()
    const text = screen.getByTestId('text')
    drag(text, 100, 200, 120)
    release(text)
    // A second swipe released while the first is still settling back.
    drag(text, 100, 200, 120)
    release(text)
    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(replyAgain).toHaveBeenCalledTimes(1)

    drag(text, 100, 200, 120)
    expect(stateOf()).toBe('unavailable')
    release(text)
    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(replyAgain).toHaveBeenCalledTimes(1)

    await finish()
    swipe()
    expect(replyAgain).toHaveBeenCalledTimes(2)
  })

  it('replies again once for a swipe and a menu tap together', async () => {
    const { replyAgain, finish } = setup()
    swipe()
    fireEvent.click(screen.getByTestId('menu-reply-again'))
    expect(replyAgain).toHaveBeenCalledTimes(1)
    await finish()

    fireEvent.click(screen.getByTestId('menu-reply-again'))
    swipe()
    expect(replyAgain).toHaveBeenCalledTimes(2)
  })
})
