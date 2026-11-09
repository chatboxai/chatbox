import {
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import {
  createLongPressController,
  createScrollInertiaTracker,
  type LongPressPoint,
  type ScrollInertiaTracker,
} from './message-long-press'
import { createPressSelectionGuard } from './press-selection-guard'

/** One tracker for the whole transcript, fed by document-level listeners while any message uses long-press. */
const transcriptInertia = createScrollInertiaTracker()
let inertiaListenerUsers = 0
/** At most one message is pressed at a time, so one guard serves them all; each press owns it via its controller. */
const pressSelectionGuard = createPressSelectionGuard()
const firstTouchPoint = (event: TouchEvent): LongPressPoint | null => {
  const touch = event.touches[0]
  return touch ? { x: touch.clientX, y: touch.clientY } : null
}
const onDocumentTouchStart = (event: TouchEvent) => {
  const point = firstTouchPoint(event)
  if (point) transcriptInertia.touchStart(point)
}
const onDocumentTouchMove = (event: TouchEvent) => {
  const point = firstTouchPoint(event)
  if (point) transcriptInertia.touchMove(point)
}
/** The transcript scroller is the scrolled element that holds message rows; code blocks and other panes are not. */
const isTranscriptScroller = (target: EventTarget | null) =>
  target instanceof Element && target.querySelector('[data-transcript-message]') !== null
const onDocumentScroll = (event: Event) => {
  if (isTranscriptScroller(event.target)) transcriptInertia.scroll()
}

export function useTranscriptScrollInertia(enabled: boolean): ScrollInertiaTracker {
  useEffect(() => {
    if (!enabled) return
    if (inertiaListenerUsers++ === 0) {
      // Capture on the document runs before any message sees the touch, so every message reads the same state.
      document.addEventListener('touchstart', onDocumentTouchStart, { capture: true, passive: true })
      document.addEventListener('touchmove', onDocumentTouchMove, { capture: true, passive: true })
      document.addEventListener('scroll', onDocumentScroll, { capture: true, passive: true })
    }
    return () => {
      if (--inertiaListenerUsers === 0) {
        document.removeEventListener('touchstart', onDocumentTouchStart, { capture: true })
        document.removeEventListener('touchmove', onDocumentTouchMove, { capture: true })
        document.removeEventListener('scroll', onDocumentScroll, { capture: true })
      }
    }
  }, [enabled])
  return transcriptInertia
}

/**
 * React bubbles events from portals (the menu sheet, the select-text page) through the message; only presses on the
 * message's own DOM count.
 */
function isOwnDomEvent(event: { currentTarget: EventTarget; target: EventTarget }): boolean {
  return (
    event.currentTarget instanceof Node && event.target instanceof Node && event.currentTarget.contains(event.target)
  )
}

function touchPoint(event: ReactTouchEvent<HTMLElement>): LongPressPoint | null {
  const touch = event.touches[0]
  return touch ? { x: touch.clientX, y: touch.clientY } : null
}

/** Touch browsers emit contextmenu and a compatibility click shortly after a long press. */
const TOUCH_FOLLOW_UP_WINDOW_MS = 800

export interface MessageLongPressHandlers {
  onTouchStart(event: ReactTouchEvent<HTMLElement>): void
  onTouchMove(event: ReactTouchEvent<HTMLElement>): void
  onTouchEnd(event: ReactTouchEvent<HTMLElement>): void
  onTouchCancel(): void
  onContextMenu(event: ReactMouseEvent<HTMLElement>): void
}

/**
 * Long-press gesture for a message on small screens. `onLongPress` receives the press point; a mouse right-click
 * (narrow desktop windows) opens the same menu. While enabled, the system context menu is suppressed and the tap that
 * ends a long press is swallowed so links and images under the finger do not also activate.
 */
export function useMessageLongPress({
  enabled,
  onLongPress,
}: {
  enabled: boolean
  onLongPress(point: LongPressPoint): void
}): MessageLongPressHandlers | undefined {
  const onLongPressRef = useRef(onLongPress)
  onLongPressRef.current = onLongPress
  const lastTouchAtRef = useRef(Number.NEGATIVE_INFINITY)
  const strayClickGuardRef = useRef(false)
  const inertia = useTranscriptScrollInertia(enabled)
  const controller = useMemo(
    () =>
      createLongPressController({
        inertia,
        onLongPress: (point) => {
          strayClickGuardRef.current = true
          pressSelectionGuard.clearSelection()
          onLongPressRef.current(point)
        },
      }),
    [inertia]
  )

  useEffect(() => {
    if (!enabled) return
    // A streaming reply can replace the node under the finger, so the release never reaches the message and its
    // click lands on whatever is under the finger by then (an item of the menu that just opened). Until a new press
    // starts, that click is swallowed.
    const onPointerDown = () => {
      strayClickGuardRef.current = false
    }
    const onClick = (event: MouseEvent) => {
      if (!strayClickGuardRef.current) return
      strayClickGuardRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    document.addEventListener('click', onClick, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('click', onClick, { capture: true })
      controller.cancel()
      // An unmounted or disabled message must not leave its press guarding the page.
      pressSelectionGuard.release(controller)
    }
  }, [controller, enabled])

  const onTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      if (!isOwnDomEvent(event)) return
      lastTouchAtRef.current = Date.now()
      const point = touchPoint(event)
      if (event.touches.length !== 1 || !point) {
        controller.cancel()
        return
      }
      if (controller.start(point)) pressSelectionGuard.engage(controller)
    },
    [controller]
  )

  const onTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      if (!isOwnDomEvent(event)) return
      const point = touchPoint(event)
      if (!point) return
      const wasPressing = controller.isPressing()
      controller.move(point)
      // Moving past the tolerance turned the press into a scroll.
      if (wasPressing && !controller.isPressing()) pressSelectionGuard.release(controller)
    },
    [controller]
  )

  const onTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      if (!isOwnDomEvent(event)) return
      lastTouchAtRef.current = Date.now()
      if (controller.end() && event.cancelable) event.preventDefault()
    },
    [controller]
  )

  const onTouchCancel = useCallback(() => {
    controller.cancel()
    pressSelectionGuard.release(controller)
  }, [controller])

  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!isOwnDomEvent(event)) return
    event.preventDefault()
    if (Date.now() - lastTouchAtRef.current < TOUCH_FOLLOW_UP_WINDOW_MS) return
    onLongPressRef.current({ x: event.clientX, y: event.clientY })
  }, [])

  return useMemo(
    () => (enabled ? { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu } : undefined),
    [enabled, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu]
  )
}
