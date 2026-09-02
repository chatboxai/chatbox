import type { Message } from '../types'

/**
 * Index of the first message of the `rounds`-th most recent conversation round.
 * A round is a user message followed (eventually) by an assistant message,
 * counted from the end of the list. Messages at or after the returned index are
 * "within the recent window"; messages before it are older history.
 *
 * Returns `messages.length` when `rounds` is 0 (empty window) and 0 when the
 * list has fewer than `rounds` complete rounds (whole list is recent).
 */
export function findRecentRoundsStartIndex(messages: Message[], rounds: number): number {
  if (rounds <= 0) {
    return messages.length
  }

  let roundCount = 0
  let inRound = false

  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role

    if (role === 'assistant') {
      inRound = true
    } else if (role === 'user' && inRound) {
      roundCount++
      inRound = false

      if (roundCount >= rounds) {
        return i
      }
    }
  }

  return 0
}
