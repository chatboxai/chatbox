export const MESSAGE_LONG_PRESS_DELAY_MS = 500
export const MESSAGE_LONG_PRESS_MOVE_TOLERANCE = 10
/** A press this soon after the transcript scrolled only stops the inertial scroll. */
export const MESSAGE_LONG_PRESS_SCROLL_SETTLE_MS = 120

export interface LongPressPoint {
  x: number
  y: number
}

export interface ScrollInertiaTrackerOptions {
  moveTolerance?: number
  scrollSettleMs?: number
  now?: () => number
}

/**
 * Transcript-wide record of user scrolling, shared by every message. A finger that travels past `moveTolerance`
 * starts a user scroll sequence; transcript scrolls that follow it without a pause longer than `scrollSettleMs`
 * (while dragging, then coasting) continue it. Once the transcript rests that long, the sequence is over, so later
 * scrolls the app makes on its own, such as following a streaming reply, are never taken for inertia. A touch that
 * lands within `scrollSettleMs` of a user scroll only stops the inertia, whichever message it lands on.
 */
export function createScrollInertiaTracker({
  moveTolerance = MESSAGE_LONG_PRESS_MOVE_TOLERANCE,
  scrollSettleMs = MESSAGE_LONG_PRESS_SCROLL_SETTLE_MS,
  now = () => Date.now(),
}: ScrollInertiaTrackerOptions = {}) {
  let origin: LongPressPoint | null = null
  let dragging = false
  let lastActivityAt = Number.NEGATIVE_INFINITY
  let lastUserScrollAt = Number.NEGATIVE_INFINITY
  let touchStopsInertia = false

  return {
    /** Call before any message handles the touch. */
    touchStart(point: LongPressPoint) {
      touchStopsInertia = dragging && now() - lastUserScrollAt < scrollSettleMs
      dragging = false
      origin = point
    },
    touchMove(point: LongPressPoint) {
      if (!origin) return
      if (dragging) {
        lastActivityAt = now()
        return
      }
      if (Math.abs(point.x - origin.x) > moveTolerance || Math.abs(point.y - origin.y) > moveTolerance) {
        dragging = true
        lastActivityAt = now()
      }
    },
    /** Records a scroll of the transcript itself; other scrollers never count. */
    scroll() {
      if (!dragging) return
      if (now() - lastActivityAt > scrollSettleMs) {
        // The list rested since the user's last scroll: this one is the app's.
        dragging = false
        return
      }
      lastActivityAt = now()
      lastUserScrollAt = lastActivityAt
    },
    /** Whether the current touch landed on a list still coasting from the user's previous drag. */
    stopsInertia() {
      return touchStopsInertia
    },
  }
}

export type ScrollInertiaTracker = ReturnType<typeof createScrollInertiaTracker>

export interface LongPressControllerOptions {
  delayMs?: number
  moveTolerance?: number
  /** Shared transcript scroll state; a press that only stops inertia never starts the timer. */
  inertia: Pick<ScrollInertiaTracker, 'stopsInertia'>
  onLongPress(point: LongPressPoint): void
}

/**
 * Gesture state for long-pressing a message: a press that stays within `moveTolerance` for `delayMs` fires once.
 * Moving further (scrolling the list or a code block) or releasing early cancels it, and a press that lands while
 * the transcript coasts from a user fling only stops the scroll. Scrolls the app makes on its own, such as following a
 * streaming reply, do not cancel a press.
 */
export function createLongPressController({
  delayMs = MESSAGE_LONG_PRESS_DELAY_MS,
  moveTolerance = MESSAGE_LONG_PRESS_MOVE_TOLERANCE,
  inertia,
  onLongPress,
}: LongPressControllerOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let origin: LongPressPoint | null = null
  let fired = false

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
    origin = null
  }

  return {
    /** Starts a press; returns false when the press only stops an inertial scroll. */
    start(point: LongPressPoint): boolean {
      clear()
      fired = false
      if (inertia.stopsInertia()) return false
      origin = point
      timer = setTimeout(() => {
        timer = null
        origin = null
        fired = true
        onLongPress(point)
      }, delayMs)
      return true
    },
    move(point: LongPressPoint) {
      if (!origin) return
      if (Math.abs(point.x - origin.x) > moveTolerance || Math.abs(point.y - origin.y) > moveTolerance) clear()
    },
    /** Ends the press; returns true when it fired, so the release must not act as a tap. */
    end(): boolean {
      clear()
      const value = fired
      fired = false
      return value
    },
    cancel() {
      clear()
    },
    isPressing() {
      return timer !== null
    },
  }
}

export type LongPressController = ReturnType<typeof createLongPressController>
