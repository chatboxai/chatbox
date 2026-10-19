export interface SessionSearchTarget {
  sessionId: string
  messageId: string
}

let target: SessionSearchTarget | null = null

/** Set before changing the route so its first body read starts at the search result. */
export function prepareSessionSearchTarget(sessionId: string, messageId: string) {
  target = { sessionId, messageId }
}

export function getSessionSearchTarget(sessionId: string) {
  return target?.sessionId === sessionId ? target : null
}

export function clearSessionSearchTarget(expected: SessionSearchTarget) {
  if (target === expected) target = null
}
