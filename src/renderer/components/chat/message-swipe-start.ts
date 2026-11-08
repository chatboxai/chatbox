import { createContext } from 'react'

/**
 * Called by the transcript's rows when a swipe locks horizontally, so overlays at the top of the transcript can step
 * aside for a pinned cue.
 */
export const MessageSwipeStartContext = createContext<(() => void) | null>(null)
