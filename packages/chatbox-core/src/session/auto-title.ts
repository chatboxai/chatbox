import type { SessionHeader } from '../types'

export const UNTITLED_SESSION_NAME = 'Untitled'
export const DEFAULT_INBOX_SESSION_ID = 'justchat-b612-406a-985b-3ab4d2c482ff'
export const DEFAULT_INBOX_SESSION_NAME = 'Just chat'

export type NameGenerationKind = 'name' | 'thread'

export function isDefaultInboxSession(session: Pick<SessionHeader, 'id' | 'name'>): boolean {
  return session.id === DEFAULT_INBOX_SESSION_ID || session.name === DEFAULT_INBOX_SESSION_NAME
}

export function buildNameGenerationAttemptKey(
  kind: NameGenerationKind,
  sessionId: string,
  threadIdentity?: string
): string {
  return threadIdentity ? `${kind}:${sessionId}:${threadIdentity}` : `${kind}:${sessionId}`
}

export function isNameGenerationAttemptKeyForSession(key: string, sessionId: string): boolean {
  return (
    key === `name:${sessionId}` ||
    key.startsWith(`name:${sessionId}:`) ||
    key === `thread:${sessionId}` ||
    key.startsWith(`thread:${sessionId}:`)
  )
}

export function sanitizeGeneratedSessionName(raw: string): string {
  return raw
    .replace(/['"\u201C\u201D]/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
}

/**
 * Historical sessions predate `threadName` (`undefined`). New conversations
 * persist `threadName: ''` so a copilot or other preset name is not copied
 * onto the thread and first-reply naming can still run. Inbox and Untitled
 * also stay unset.
 */
export function shouldBackfillThreadName(session: Pick<SessionHeader, 'id' | 'name' | 'threadName'>): boolean {
  if (session.threadName !== undefined) return false
  if (!session.name || session.name === UNTITLED_SESSION_NAME) return false
  return !isDefaultInboxSession(session)
}
