import { useEffect, useMemo, useState } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import { getOS } from '@/packages/navigator'

/**
 * How long the switch modifier has to be held before the conversation list
 * reveals the digit that opens each conversation: short enough to feel like a
 * peek, long enough that a plain ⌘1-9 or ⌘Tab never flashes the digits.
 */
export const SESSION_SWITCH_HINT_DELAY_MS = 400

/** `Digit1`-`Digit9` reach the first nine conversations (`switchToIndex`). */
const MAX_SESSION_SWITCH_SHORTCUTS = 9

const NO_DIGITS: ReadonlyMap<string, number> = new Map()

/**
 * Tracks the modifier the conversation switch keys are bound to — `⌘` on macOS,
 * `Ctrl` everywhere else, matching the `mod` handling in `useShortcut` — and
 * reports it held once the peek delay has elapsed. Holding the key alone is not
 * enough to keep the peek: another key press, the release, a window blur or a
 * hidden document all end it, so the hint cannot outlive the gesture.
 */
function useSwitchModifierHeld(): boolean {
  const isMac = getOS() === 'Mac'
  const [held, setHeld] = useState(false)

  useEffect(() => {
    const modifierKey = isMac ? 'Meta' : 'Control'
    let peekTimer: ReturnType<typeof setTimeout> | null = null
    let peeking = false

    const endPeek = () => {
      if (peekTimer !== null) {
        clearTimeout(peekTimer)
        peekTimer = null
      }
      if (peeking) {
        peeking = false
        setHeld(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== modifierKey) {
        // Any other key means the user is performing a shortcut, not reading
        // the list.
        endPeek()
        return
      }
      if (peekTimer !== null || peeking) {
        return
      }
      peekTimer = setTimeout(() => {
        peekTimer = null
        peeking = true
        setHeld(true)
      }, SESSION_SWITCH_HINT_DELAY_MS)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === modifierKey) {
        endPeek()
      }
    }
    const onVisibilityChange = () => {
      if (document.hidden) {
        endPeek()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', endPeek)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      endPeek()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', endPeek)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isMac])

  return held
}

/**
 * Digit each conversation answers to while the switch modifier is held, keyed
 * by session id; empty until the peek delay elapses. The digits follow the list
 * order `switchToIndex` reads, so the key shown next to a row is the one that
 * opens it.
 */
export function useSessionSwitchHintDigits(): ReadonlyMap<string, number> {
  const { sessionMetaList } = rendererApplication.sessionHooks.useSessionList()
  const modifierHeld = useSwitchModifierHeld()

  return useMemo(() => {
    if (!modifierHeld || !sessionMetaList) {
      return NO_DIGITS
    }
    const digits = new Map<string, number>()
    sessionMetaList.slice(0, MAX_SESSION_SWITCH_SHORTCUTS).forEach((session, index) => {
      digits.set(session.id, index + 1)
    })
    return digits
  }, [modifierHeld, sessionMetaList])
}
