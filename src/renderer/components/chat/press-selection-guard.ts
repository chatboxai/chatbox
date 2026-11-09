/** Set on <html> while a message press is held; `globals.css` turns selection and the callout off page-wide. */
export const PRESS_SELECTION_GUARD_CLASS = 'message-press-selection-guard'
/** The guard outlives the lifted finger briefly, so the system's selection gesture cannot finish on the menu. */
export const PRESS_SELECTION_GUARD_RELEASE_MS = 300
/** Upper bound on one engagement, so a press whose end is never delivered cannot leave selection disabled. */
export const PRESS_SELECTION_GUARD_MAX_MS = 5_000

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable]'

function isEditable(node: EventTarget | null): boolean {
  const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null
  return element?.closest(EDITABLE_SELECTOR) != null
}

/**
 * Keeps the system text selection out of a message long-press. iOS WebKit starts its selection gesture about when the
 * menu opens and picks the nearest selectable text, including the sheet that just appeared under the finger. While a
 * press is held (and shortly after the finger lifts) every non-editable element is unselectable, `selectstart` is
 * cancelled, and any selection that still formed is cleared. Inputs and editable fields are left alone.
 *
 * Each engagement belongs to the press that started it. It ends when the last finger lifts, when its owner releases
 * it, when the page loses focus or is hidden, when a new gesture starts, or at the latest after `maxMs`.
 */
export function createPressSelectionGuard({
  doc = document,
  releaseMs = PRESS_SELECTION_GUARD_RELEASE_MS,
  maxMs = PRESS_SELECTION_GUARD_MAX_MS,
}: {
  doc?: Document
  releaseMs?: number
  maxMs?: number
} = {}) {
  const win = doc.defaultView
  let owner: object | null = null
  let releaseTimer: ReturnType<typeof setTimeout> | null = null
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null

  const clearSelection = () => {
    if (isEditable(doc.activeElement)) return
    const selection = doc.getSelection()
    if (selection && selection.rangeCount > 0) selection.removeAllRanges()
  }
  const cancelRelease = () => {
    if (releaseTimer) clearTimeout(releaseTimer)
    releaseTimer = null
  }
  const onSelectStart = (event: Event) => {
    if (!isEditable(event.target)) event.preventDefault()
  }
  const releaseNow = () => {
    cancelRelease()
    if (deadlineTimer) clearTimeout(deadlineTimer)
    deadlineTimer = null
    if (!owner) return
    owner = null
    doc.documentElement.classList.remove(PRESS_SELECTION_GUARD_CLASS)
    doc.removeEventListener('selectstart', onSelectStart, { capture: true })
    doc.removeEventListener('touchstart', onTouchStart, { capture: true })
    doc.removeEventListener('touchend', onTouchEnd, { capture: true })
    doc.removeEventListener('touchcancel', onTouchEnd, { capture: true })
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    win?.removeEventListener('blur', releaseNow)
    win?.removeEventListener('pagehide', releaseNow)
    clearSelection()
  }
  // Document-level, so the release is seen even when the pressed node was replaced or the sheet is under the finger.
  function onTouchEnd(event: TouchEvent) {
    if (event.touches.length > 0) return
    cancelRelease()
    releaseTimer = setTimeout(releaseNow, releaseMs)
  }
  // A single-finger touchstart begins a new gesture, so the previous press is over even if its end was never seen.
  // It runs in the capture phase, before a message that is pressed again engages its own guard.
  function onTouchStart(event: TouchEvent) {
    if (event.touches.length <= 1) releaseNow()
  }
  function onVisibilityChange() {
    if (doc.visibilityState === 'hidden') releaseNow()
  }

  return {
    /** A press started on a message; `pressOwner` identifies that press's message. */
    engage(pressOwner: object) {
      releaseNow()
      owner = pressOwner
      doc.documentElement.classList.add(PRESS_SELECTION_GUARD_CLASS)
      doc.addEventListener('selectstart', onSelectStart, { capture: true })
      doc.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
      doc.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
      doc.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true })
      doc.addEventListener('visibilitychange', onVisibilityChange)
      win?.addEventListener('blur', releaseNow)
      win?.addEventListener('pagehide', releaseNow)
      deadlineTimer = setTimeout(releaseNow, maxMs)
    },
    /**
     * The owner's press became a scroll or was cancelled, or the owner was unmounted or disabled: selection behaves
     * normally again right away. Another owner's engagement is left alone.
     */
    release(pressOwner: object) {
      if (owner === pressOwner) releaseNow()
    },
    /** The menu opened: drop any selection the system made under the finger. */
    clearSelection,
    isActive: () => owner !== null,
  }
}

export type PressSelectionGuard = ReturnType<typeof createPressSelectionGuard>
