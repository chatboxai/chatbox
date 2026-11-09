/**
 * Remembers whether the user wants the transcript to stay at its tail, so a send can honour the intent the user
 * had when pressing Send rather than whatever state the list is in once the asynchronous send commits.
 *
 * A request for the tail (the scroll-to-bottom arrow, the generating shortcut, the bottom navigation button) counts
 * as tail intent immediately, before the list has finished moving there. Any later user browsing away from the tail
 * withdraws it. Programmatic layout changes, such as a window rebase pausing follow, are not user intent and are
 * deliberately not reported here.
 */
export function createSendFollowIntent() {
  let epoch = 0
  let tailRequestedAt: number | null = null
  return {
    /** The user asked to go to the tail. */
    requestTail() {
      tailRequestedAt = epoch
    },
    /** The user browsed away from the tail. */
    leaveTail() {
      epoch++
      tailRequestedAt = null
    },
    /**
     * Captures the intent at send time. Returns null when the user is reading history; otherwise a check that stays
     * true until the user next browses away.
     */
    capture(atTail: boolean): (() => boolean) | null {
      if (!atTail && tailRequestedAt !== epoch) return null
      const captured = epoch
      return () => epoch === captured
    },
  }
}
