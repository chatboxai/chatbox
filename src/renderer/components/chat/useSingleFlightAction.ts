import { useCallback, useRef, useState } from 'react'

/**
 * Runs actions one at a time: an action started while an earlier one is still
 * running is ignored. `pending` is true from the start until it settles, so the
 * surface can show the action as under way before its effects are visible.
 */
export function useSingleFlightAction() {
  const [pending, setPending] = useState(false)
  const running = useRef(false)
  const run = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return
    running.current = true
    setPending(true)
    try {
      await action()
    } finally {
      running.current = false
      setPending(false)
    }
  }, [])
  return { pending, run }
}
