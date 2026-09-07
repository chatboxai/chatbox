import type { SessionType } from '../types'

/**
 * Chat is the only persisted Session type that can start generation. Legacy
 * picture sessions remain viewable after generation moved to Image Creator;
 * guide and unknown persisted values use the safe read-only default.
 */
export function supportsSessionGeneration(sessionType?: SessionType): boolean {
  switch (sessionType) {
    case undefined:
    case 'chat':
      return true
    case 'picture':
    case 'guide':
      return false
    default:
      return false
  }
}
