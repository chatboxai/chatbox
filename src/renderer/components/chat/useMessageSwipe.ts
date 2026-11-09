import {
  getMessageSwipeCuePin,
  getMessageSwipeCuePinProgress,
  getMessageSwipeOffset,
  getMessageSwipeProgress,
  getMessageSwipeState,
  isMessageSwipeArmed,
  MESSAGE_SWIPE,
  type MessageSwipeMode,
  type MessageSwipeState,
  resolveMessageSwipeAxis,
  resolveMessageSwipeDistance,
} from '@chatbox/core/session/message-swipe'
import { type RefObject, useContext, useEffect, useRef } from 'react'
import { triggerSwipeArmHaptic } from '@/utils/long-press-haptic'
import { MessageSwipeStartContext } from './message-swipe-start'
import { useTranscriptScrollInertia } from './useMessageLongPress'

export type { MessageSwipeMode, MessageSwipeState }

/**
 * Whether a touch starting at `target` belongs to something inside the message that scrolls sideways (a code block,
 * a formula, a wide table): those keep the swipe for their own scrolling.
 */
function startsInHorizontalScroller(target: EventTarget | null, root: HTMLElement): boolean {
  let node = target instanceof Element ? target : null
  while (node && node !== root) {
    if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1) {
      const overflowX = getComputedStyle(node).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    node = node.parentElement
  }
  return false
}

/** Top of the area the row is visible in: the nearest scrolling ancestor's top, or the window's. */
function visibleTopOf(row: HTMLElement): number {
  for (let node = row.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
      return Math.max(0, node.getBoundingClientRect().top)
    }
  }
  return 0
}

/** Where the cue goes for this gesture; the transcript cannot scroll while the swipe holds the touch. */
type CuePin = { offset: number; progress: number; bandLeft: number; bandWidth: number }

function measureCuePin(row: HTMLElement, surface: HTMLElement | null): CuePin {
  const rowRect = row.getBoundingClientRect()
  const offset = getMessageSwipeCuePin(visibleTopOf(row) - rowRect.top, rowRect.height)
  const surfaceRect = surface?.getBoundingClientRect()
  return {
    offset,
    progress: getMessageSwipeCuePinProgress(offset),
    bandLeft: surfaceRect ? surfaceRect.left - rowRect.left : 0,
    bandWidth: surfaceRect ? surfaceRect.width : rowRect.width,
  }
}

const NO_PIN: CuePin = { offset: 0, progress: 0, bandLeft: 0, bandWidth: 0 }

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Swipe a message to the right to reply again (small screens, touch only). The row under `rowRef` follows a fifth of
 * the finger's travel and carries the swipe state in `data-swipe-state` (`MessageSwipeState`) and the retry icon's
 * rotation in `--message-swipe-turn`, which the avatar slot and name row style themselves from. Releasing past the
 * threshold springs the row back and then calls `onRetry`, the same handler as the long-press menu's "Reply Again". In
 * `unavailable` mode the row only gives a short nudge and never arms.
 *
 * When the row's top is scrolled out of view, the cue is pinned to the top of the row's visible part: the gesture writes
 * `--message-swipe-pin` (how far down the cue moves), `--message-swipe-pin-progress` (how strongly its band shows) and
 * the band's horizontal extent, `--message-swipe-band-left` / `--message-swipe-band-width`, matching `surfaceRef`.
 *
 * Touches that start in the left edge zone, inside a horizontally scrollable element, or on a transcript still coasting
 * from a scroll are left alone. Once the gesture locks horizontally the page stops scrolling until the finger lifts;
 * the long-press timer has already been cancelled by then, since the lock distance exceeds its move tolerance.
 */
export function useMessageSwipe({
  mode,
  onRetry,
  targetRef,
  rowRef,
  surfaceRef,
}: {
  mode: MessageSwipeMode
  onRetry(): void
  /** Receives the touches; the whole message. */
  targetRef: RefObject<HTMLElement | null>
  /** Moves with the finger and carries the swipe state. */
  rowRef: RefObject<HTMLElement | null>
  /** The surface the reply's text sits on; a pinned cue's band spans it. The whole row when absent. */
  surfaceRef?: RefObject<HTMLElement | null>
}): void {
  const enabled = mode !== 'none'
  const inertia = useTranscriptScrollInertia(enabled)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const onRetryRef = useRef(onRetry)
  onRetryRef.current = onRetry
  const onStart = useContext(MessageSwipeStartContext)
  const onStartRef = useRef(onStart)
  onStartRef.current = onStart

  useEffect(() => {
    const target = targetRef.current
    if (!enabled || !target) return
    if (rowRef.current) rowRef.current.dataset.swipeState = 'idle'

    let phase: 'idle' | 'pending' | 'active' = 'idle'
    let start = { x: 0, y: 0 }
    let distance = 0
    let armed = false
    /** The arm haptic plays at most once per gesture, even if the row is dragged back and re-armed. */
    let hapticPlayed = false
    let pin = NO_PIN
    let frame = 0
    let settleTimer: ReturnType<typeof setTimeout> | undefined

    const paint = (animate: boolean) => {
      frame = 0
      const row = rowRef.current
      if (!row) return
      const canRetry = modeRef.current === 'retry'
      const offset = getMessageSwipeOffset(distance)
      const turn = prefersReducedMotion() ? 0 : MESSAGE_SWIPE.iconTurn * getMessageSwipeProgress(distance, canRetry)
      row.style.transition = animate ? `transform ${MESSAGE_SWIPE.settleMs}ms ease-out` : 'none'
      row.style.transform = offset ? `translateX(${offset}px)` : ''
      row.style.setProperty('--message-swipe-turn', `${turn}deg`)
      const state = getMessageSwipeState(distance, canRetry)
      const shown = state === 'idle' ? NO_PIN : pin
      row.style.setProperty('--message-swipe-pin', `${shown.offset}px`)
      row.style.setProperty('--message-swipe-pin-progress', String(shown.progress))
      row.style.setProperty('--message-swipe-band-left', `${shown.bandLeft}px`)
      row.style.setProperty('--message-swipe-band-width', `${shown.bandWidth}px`)
      row.dataset.swipeState = state
    }
    const schedulePaint = () => {
      if (!frame) frame = requestAnimationFrame(() => paint(false))
    }
    const settle = () => {
      if (frame) cancelAnimationFrame(frame)
      const fire = phase === 'active' && armed && modeRef.current === 'retry'
      phase = 'idle'
      distance = 0
      armed = false
      paint(true)
      if (fire) {
        clearTimeout(settleTimer)
        settleTimer = setTimeout(() => onRetryRef.current(), MESSAGE_SWIPE.settleMs)
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (event.touches.length !== 1 || !touch) {
        // A second finger cancels the swipe without replying again.
        if (phase === 'active') {
          armed = false
          settle()
        }
        phase = 'idle'
        return
      }
      phase = 'idle'
      if (touch.clientX < MESSAGE_SWIPE.edgeZone) return
      if (inertia.stopsInertia()) return
      if (startsInHorizontalScroller(event.target, target)) return
      start = { x: touch.clientX, y: touch.clientY }
      hapticPlayed = false
      phase = 'pending'
    }

    const onTouchMove = (event: TouchEvent) => {
      if (phase === 'idle') return
      const touch = event.touches[0]
      if (!touch) return
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (phase === 'pending') {
        const axis = resolveMessageSwipeAxis(dx, dy)
        if (axis === 'cancel') {
          phase = 'idle'
          return
        }
        if (axis === 'pending') return
        phase = 'active'
        onStartRef.current?.()
        const row = rowRef.current
        pin = row ? measureCuePin(row, surfaceRef?.current ?? null) : NO_PIN
      }
      if (event.cancelable) event.preventDefault()
      const canRetry = modeRef.current === 'retry'
      distance = resolveMessageSwipeDistance(dx, canRetry)
      const nextArmed = isMessageSwipeArmed(distance, canRetry)
      if (nextArmed && !hapticPlayed) {
        hapticPlayed = true
        triggerSwipeArmHaptic()
      }
      armed = nextArmed
      schedulePaint()
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (phase === 'active' && event.cancelable) event.preventDefault()
      if (phase === 'active') settle()
      phase = 'idle'
    }

    const onTouchCancel = () => {
      if (phase === 'active') {
        armed = false
        settle()
      }
      phase = 'idle'
    }

    target.addEventListener('touchstart', onTouchStart, { passive: true })
    target.addEventListener('touchmove', onTouchMove, { passive: false })
    target.addEventListener('touchend', onTouchEnd, { passive: false })
    target.addEventListener('touchcancel', onTouchCancel, { passive: true })
    return () => {
      target.removeEventListener('touchstart', onTouchStart)
      target.removeEventListener('touchmove', onTouchMove)
      target.removeEventListener('touchend', onTouchEnd)
      target.removeEventListener('touchcancel', onTouchCancel)
      if (frame) cancelAnimationFrame(frame)
      clearTimeout(settleTimer)
      distance = 0
      armed = false
      paint(false)
      if (rowRef.current) delete rowRef.current.dataset.swipeState
    }
  }, [enabled, inertia, targetRef, rowRef, surfaceRef])
}
