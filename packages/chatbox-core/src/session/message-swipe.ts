/**
 * Swipe-right-to-reply-again on small screens, shared by the React Native app and small-screen Web/Capacitor.
 * Distances are in CSS px / dp. Thresholds are measured in finger travel; the message itself only follows the finger
 * a little, and the avatar slot and name row carry the feedback. The helpers carry the `'worklet'` directive so
 * Reanimated can run them on the UI thread; elsewhere the directive is an inert string.
 */
export const MESSAGE_SWIPE = {
  /** Horizontal travel that locks the gesture to a swipe. Larger than the long-press move tolerance (10). */
  activateDistance: 12,
  /** Leftward travel that gives the touch back to other gestures. */
  failLeftDistance: 8,
  /** Finger travel at which releasing replies again. */
  armDistance: 96,
  /** Furthest finger travel that counts while retry is available. */
  maxDistance: 144,
  /** Furthest finger travel that counts while retry is unavailable (a reply is streaming, the session is busy). */
  disabledMaxDistance: 16,
  /** Share of the finger's travel the message follows. */
  follow: 0.2,
  /** Furthest the message moves; stays inside the gutter on its right, so nothing is clipped. */
  maxOffset: 14,
  /** Rotation of the retry icon, in degrees, once the swipe is armed. */
  iconTurn: -180,
  /** Touches that start this close to the left screen edge belong to system back and the sessions drawer. */
  edgeZone: 32,
  /** Duration of the spring back after release; the retry runs once the message has settled. */
  settleMs: 180,
} as const

/** `retry`: swiping replies again; `unavailable`: a short resisted nudge that never arms; `none`: no swipe. */
export type MessageSwipeMode = 'retry' | 'unavailable' | 'none'

/** What the avatar slot and name row show: the message at rest, a swipe short of the threshold, armed, or refused. */
export type MessageSwipeState = 'idle' | 'dragging' | 'armed' | 'unavailable'

export type MessageSwipeAxis = 'pending' | 'horizontal' | 'cancel'

/**
 * Direction lock from the travel since the touch began: a rightward move past `activateDistance` that is at least
 * twice as wide as it is tall becomes a swipe; a leftward move, or a move that turns vertical first, gives the touch
 * back to scrolling and other gestures.
 */
export function resolveMessageSwipeAxis(dx: number, dy: number): MessageSwipeAxis {
  'worklet'
  if (dx <= -MESSAGE_SWIPE.failLeftDistance) return 'cancel'
  if (Math.abs(dy) > Math.max(Math.abs(dx) / 2, MESSAGE_SWIPE.failLeftDistance)) return 'cancel'
  if (dx >= MESSAGE_SWIPE.activateDistance) return 'horizontal'
  return 'pending'
}

/** Finger travel `dx` to the right, capped at the furthest travel that counts. */
export function resolveMessageSwipeDistance(dx: number, canRetry: boolean): number {
  'worklet'
  if (!(dx > 0)) return 0
  return Math.min(dx, canRetry ? MESSAGE_SWIPE.maxDistance : MESSAGE_SWIPE.disabledMaxDistance)
}

/** How far the message moves for a swipe `distance`. */
export function getMessageSwipeOffset(distance: number): number {
  'worklet'
  return Math.min(MESSAGE_SWIPE.maxOffset, Math.max(0, distance) * MESSAGE_SWIPE.follow)
}

/** Whether releasing at `distance` replies again. Dragging back under the threshold disarms. */
export function isMessageSwipeArmed(distance: number, canRetry: boolean): boolean {
  'worklet'
  return canRetry && distance >= MESSAGE_SWIPE.armDistance
}

/** Progress toward the threshold, 0 at rest and 1 once armed. Drives the rotation of the retry icon. */
export function getMessageSwipeProgress(distance: number, canRetry: boolean): number {
  'worklet'
  if (!canRetry) return 0
  return Math.max(0, Math.min(1, distance / MESSAGE_SWIPE.armDistance))
}

export function getMessageSwipeState(distance: number, canRetry: boolean): MessageSwipeState {
  'worklet'
  if (!(distance > 0)) return 'idle'
  if (!canRetry) return 'unavailable'
  return isMessageSwipeArmed(distance, canRetry) ? 'armed' : 'dragging'
}

/**
 * The swipe cue (retry ring and hint line) sits on the reply's avatar and name row. When a long reply's top is scrolled
 * out of view, the cue is pinned to the top of the reply's visible part instead, on a band of the surface colour that
 * fades out below it.
 */
export const MESSAGE_SWIPE_CUE = {
  /** Height of the cue line: the avatar ring. */
  height: 24,
  /** Space kept above a pinned cue. */
  gap: 8,
  /** Fade below a pinned cue's band. */
  fade: 20,
} as const

/**
 * How far to move the cue down so it stays in view. `hidden` is how much of the reply's top lies above the visible
 * area; `rowHeight` is the reply's height, which the pinned cue and its fade never leave. 0 while the top is in view.
 * The gap above the cue grows with the first `gap` px hidden, so the cue starts moving without a jump.
 */
export function getMessageSwipeCuePin(hidden: number, rowHeight: number): number {
  'worklet'
  if (!(hidden > 0)) return 0
  const { fade, gap, height } = MESSAGE_SWIPE_CUE
  return Math.max(0, Math.min(hidden + Math.min(hidden, gap), rowHeight - height - fade))
}

/** How strongly the pinned band shows: 0 in place, 1 once the cue has moved a full line down. */
export function getMessageSwipeCuePinProgress(pin: number): number {
  'worklet'
  return Math.max(0, Math.min(1, pin / MESSAGE_SWIPE_CUE.height))
}

/**
 * A message can be swiped when its long-press menu entries (ids of `MessageMenuEntryId`) offer "Reply Again"; any
 * other assistant reply with a menu shows the swipe as unavailable. User and system messages have no swipe.
 */
export function getMessageSwipeMode(role: string, entries: readonly string[]): MessageSwipeMode {
  if (role !== 'assistant' || entries.length === 0) return 'none'
  return entries.includes('retry') ? 'retry' : 'unavailable'
}
