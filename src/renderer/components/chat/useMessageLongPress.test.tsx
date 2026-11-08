// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PRESS_SELECTION_GUARD_CLASS } from './press-selection-guard'
import { useMessageLongPress } from './useMessageLongPress'

function Harness({
  enabled,
  onLongPress,
  onLinkClick,
}: {
  enabled: boolean
  onLongPress(): void
  onLinkClick(): void
}) {
  const handlers = useMessageLongPress({ enabled, onLongPress })
  return (
    <div data-testid="message" {...handlers}>
      <button type="button" onClick={onLinkClick}>
        link
      </button>
    </div>
  )
}

// The transcript scroll tracker is shared by every message, so each test starts later than the last one ended.
let clock = Date.UTC(2030, 0, 1)
beforeEach(() => {
  vi.useFakeTimers()
  clock += 3_600_000
  vi.setSystemTime(clock)
})
afterEach(() => {
  cleanup()
  // Unmounting every message releases any press a test left held.
  expect(guarded()).toBe(false)
  vi.useRealTimers()
})

const guarded = () => document.documentElement.classList.contains(PRESS_SELECTION_GUARD_CLASS)

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] })

it('opens the menu on a held press and swallows the release so the link under the finger stays inert', () => {
  const onLongPress = vi.fn()
  const onLinkClick = vi.fn()
  render(<Harness enabled onLongPress={onLongPress} onLinkClick={onLinkClick} />)
  const link = screen.getByText('link')
  fireEvent.touchStart(link, touch(5, 5))
  vi.advanceTimersByTime(500)
  expect(onLongPress).toHaveBeenCalledWith({ x: 5, y: 5 })
  const release = fireEvent.touchEnd(link, { touches: [] })
  expect(release).toBe(false)
})

it('swallows the stray click of a release that never reached the message', () => {
  const onLongPress = vi.fn()
  const onLinkClick = vi.fn()
  render(<Harness enabled onLongPress={onLongPress} onLinkClick={onLinkClick} />)
  const link = screen.getByText('link')
  fireEvent.touchStart(link, touch(5, 5))
  vi.advanceTimersByTime(500)
  // The release is lost (its target was replaced), and the browser clicks what is under the finger now.
  fireEvent.click(link)
  expect(onLinkClick).not.toHaveBeenCalled()
  // Touches on the open menu (a portal) are not presses on the message.
  expect(fireEvent.touchEnd(document.body.lastElementChild as Element, { touches: [] })).toBe(true)
  // A new press clicks normally.
  fireEvent.pointerDown(link)
  fireEvent.click(link)
  expect(onLinkClick).toHaveBeenCalledTimes(1)
})

it('leaves short taps alone', () => {
  const onLongPress = vi.fn()
  const onLinkClick = vi.fn()
  render(<Harness enabled onLongPress={onLongPress} onLinkClick={onLinkClick} />)
  const link = screen.getByText('link')
  fireEvent.touchStart(link, touch(5, 5))
  vi.advanceTimersByTime(200)
  expect(fireEvent.touchEnd(link, { touches: [] })).toBe(true)
  fireEvent.click(link)
  expect(onLinkClick).toHaveBeenCalledTimes(1)
  expect(onLongPress).not.toHaveBeenCalled()
})

it('cancels when the finger moves to scroll', () => {
  const onLongPress = vi.fn()
  render(<Harness enabled onLongPress={onLongPress} onLinkClick={vi.fn()} />)
  const link = screen.getByText('link')
  fireEvent.touchStart(link, touch(5, 5))
  fireEvent.touchMove(link, touch(5, 40))
  vi.advanceTimersByTime(1_000)
  expect(onLongPress).not.toHaveBeenCalled()
})

/** Two messages inside a transcript scroller, the way the message list renders them. */
function renderTranscript(onFirst: () => void, onSecond: () => void) {
  render(
    <div data-testid="scroller">
      <div data-transcript-message="a">
        <Harness enabled onLongPress={onFirst} onLinkClick={vi.fn()} />
      </div>
      <div data-transcript-message="b">
        <Harness enabled onLongPress={onSecond} onLinkClick={vi.fn()} />
      </div>
    </div>
  )
  const [first, second] = screen.getAllByText('link')
  if (!first || !second) throw new Error('missing messages')
  return { first, second, scroller: screen.getByTestId('scroller') }
}

/** A drag on `target` that scrolls the transcript and keeps it coasting for a moment after the finger lifts. */
function fling(target: Element, scroller: Element) {
  fireEvent.touchStart(target, touch(5, 400))
  fireEvent.touchMove(target, touch(5, 300))
  fireEvent.scroll(scroller)
  fireEvent.touchEnd(target, { touches: [] })
  vi.advanceTimersByTime(40)
  fireEvent.scroll(scroller)
}

it('only stops the list when a fling started on one message is caught on another', () => {
  const onFirst = vi.fn()
  const onSecond = vi.fn()
  const { first, second, scroller } = renderTranscript(onFirst, onSecond)
  fling(first, scroller)
  vi.advanceTimersByTime(40)
  fireEvent.touchStart(second, touch(5, 200))
  vi.advanceTimersByTime(1_000)
  expect(onSecond).not.toHaveBeenCalled()
  fireEvent.touchEnd(second, { touches: [] })

  vi.advanceTimersByTime(500)
  fireEvent.touchStart(second, touch(5, 200))
  vi.advanceTimersByTime(500)
  expect(onSecond).toHaveBeenCalledTimes(1)
  expect(onFirst).not.toHaveBeenCalled()
})

it('opens the menu when the app scrolls the transcript after a settled fling', () => {
  const onFirst = vi.fn()
  const onSecond = vi.fn()
  const { first, second, scroller } = renderTranscript(onFirst, onSecond)
  fling(first, scroller)
  // The list rests, then a streaming reply scrolls it just before the next press.
  vi.advanceTimersByTime(5_000)
  fireEvent.scroll(scroller)
  vi.advanceTimersByTime(10)
  fireEvent.touchStart(second, touch(5, 200))
  vi.advanceTimersByTime(500)
  expect(onSecond).toHaveBeenCalledTimes(1)
})

it('ignores scrolling outside the transcript, such as a code block swiped sideways', () => {
  const onFirst = vi.fn()
  const onSecond = vi.fn()
  const { first, second } = renderTranscript(onFirst, onSecond)
  fireEvent.touchStart(first, touch(5, 5))
  fireEvent.touchMove(first, touch(80, 5))
  fireEvent.scroll(first)
  fireEvent.touchEnd(first, { touches: [] })
  vi.advanceTimersByTime(30)
  fireEvent.touchStart(second, touch(5, 200))
  vi.advanceTimersByTime(500)
  expect(onSecond).toHaveBeenCalledTimes(1)
})

it('blocks the system context menu and opens the message menu from a mouse right-click', () => {
  const onLongPress = vi.fn()
  render(<Harness enabled onLongPress={onLongPress} onLinkClick={vi.fn()} />)
  const notPrevented = fireEvent.contextMenu(screen.getByText('link'), { clientX: 3, clientY: 4 })
  expect(notPrevented).toBe(false)
  expect(onLongPress).toHaveBeenCalledWith({ x: 3, y: 4 })
})

it('ignores the touch-generated context menu that follows a long press', () => {
  const onLongPress = vi.fn()
  render(<Harness enabled onLongPress={onLongPress} onLinkClick={vi.fn()} />)
  const link = screen.getByText('link')
  fireEvent.touchStart(link, touch(5, 5))
  vi.advanceTimersByTime(500)
  expect(fireEvent.contextMenu(link)).toBe(false)
  expect(onLongPress).toHaveBeenCalledTimes(1)
})

it('attaches nothing when disabled', () => {
  const onLongPress = vi.fn()
  render(<Harness enabled={false} onLongPress={onLongPress} onLinkClick={vi.fn()} />)
  const link = screen.getByText('link')
  fireEvent.touchStart(link, touch(5, 5))
  vi.advanceTimersByTime(1_000)
  expect(fireEvent.contextMenu(link)).toBe(true)
  expect(onLongPress).not.toHaveBeenCalled()
})

it('keeps system selection off the page while a message is pressed', () => {
  const onLongPress = vi.fn()
  render(<Harness enabled onLongPress={onLongPress} onLinkClick={vi.fn()} />)
  const message = screen.getByTestId('message')

  fireEvent.touchStart(message, touch(5, 5))
  expect(guarded()).toBe(true)
  vi.advanceTimersByTime(500)
  expect(onLongPress).toHaveBeenCalled()
  expect(guarded()).toBe(true)
  fireEvent.touchEnd(message, { touches: [] })
  vi.advanceTimersByTime(1_000)
  expect(guarded()).toBe(false)

  // A press that becomes a scroll gives selection back immediately.
  fireEvent.touchStart(message, touch(5, 5))
  expect(guarded()).toBe(true)
  fireEvent.touchMove(message, touch(5, 40))
  expect(guarded()).toBe(false)
  fireEvent.touchEnd(message, { touches: [] })
})

it('releases the guard when the pressed message unmounts or is disabled', () => {
  const props = { onLongPress: vi.fn(), onLinkClick: vi.fn() }
  const { rerender, unmount } = render(<Harness enabled {...props} />)
  fireEvent.touchStart(screen.getByTestId('message'), touch(5, 5))
  expect(guarded()).toBe(true)
  rerender(<Harness enabled={false} {...props} />)
  expect(guarded()).toBe(false)

  rerender(<Harness enabled {...props} />)
  fireEvent.touchStart(screen.getByTestId('message'), touch(5, 5))
  expect(guarded()).toBe(true)
  unmount()
  expect(guarded()).toBe(false)
})

it("another message unmounting leaves the pressed message's guard in place", () => {
  function Two({ showSecond }: { showSecond: boolean }) {
    return (
      <>
        <Harness enabled onLongPress={vi.fn()} onLinkClick={vi.fn()} />
        {showSecond && <Harness enabled onLongPress={vi.fn()} onLinkClick={vi.fn()} />}
      </>
    )
  }
  const { rerender } = render(<Two showSecond />)
  const [first] = screen.getAllByTestId('message')
  if (!first) throw new Error('missing message')
  fireEvent.touchStart(first, touch(5, 5))
  rerender(<Two showSecond={false} />)
  expect(guarded()).toBe(true)
  fireEvent.touchEnd(first, { touches: [] })
  vi.advanceTimersByTime(1_000)
  expect(guarded()).toBe(false)
})

it('releases the guard when the app is backgrounded before the finger lifts', () => {
  render(<Harness enabled onLongPress={vi.fn()} onLinkClick={vi.fn()} />)
  fireEvent.touchStart(screen.getByTestId('message'), touch(5, 5))
  vi.advanceTimersByTime(500)
  expect(guarded()).toBe(true)
  // The touch end is never delivered.
  window.dispatchEvent(new Event('blur'))
  expect(guarded()).toBe(false)
})

it('recovers on the next touch when a press lost its end', () => {
  render(<Harness enabled onLongPress={vi.fn()} onLinkClick={vi.fn()} />)
  fireEvent.touchStart(screen.getByTestId('message'), touch(5, 5))
  vi.advanceTimersByTime(500)
  fireEvent.touchStart(document.body, touch(50, 50))
  expect(guarded()).toBe(false)
})
