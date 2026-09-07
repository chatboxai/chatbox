import type { Session } from '../types'
import { hasContentForAutoTitle } from './message-success'

export type AutoTitleAction = 'session-and-thread' | 'thread'

export const UNTITLED_SESSION_NAME = 'Untitled'
export const DEFAULT_INBOX_SESSION_ID = 'justchat-b612-406a-985b-3ab4d2c482ff'
export const DEFAULT_INBOX_SESSION_NAME = 'Just chat'

export type AutoTitleSession = Pick<Session, 'id' | 'messages' | 'name' | 'threadName'>
export type ThreadNamingIdentitySession = Pick<Session, 'messages'>
export type NameGenerationKind = 'name' | 'thread'

export function isDefaultInboxSession(session: Pick<Session, 'id' | 'name'>): boolean {
  return session.id === DEFAULT_INBOX_SESSION_ID || session.name === DEFAULT_INBOX_SESSION_NAME
}

/**
 * Identifies the live conversation for auto-title write-back. The first user
 * message id stays stable while the current turn streams, and changes when
 * the current thread is created, switched, or cleared. Archived-thread
 * mutations are ignored so deleting history cannot invalidate an in-flight title.
 */
export function getCurrentThreadNamingIdentity(session: ThreadNamingIdentitySession): string {
  return session.messages.find((message) => message.role === 'user')?.id ?? ''
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
export function shouldBackfillThreadName(session: Pick<Session, 'id' | 'name' | 'threadName'>): boolean {
  if (session.threadName !== undefined) return false
  if (!session.name || session.name === UNTITLED_SESSION_NAME) return false
  return !isDefaultInboxSession(session)
}

/**
 * Migrates `threadName: undefined` once. A historical conversation with real
 * content keeps its session name as the thread title (no model call). A
 * session without title-worthy content — cleared under the old semantics
 * (which used `undefined` as "pending") or never chatted in — becomes `''`
 * so the next successful reply still gets first-turn AI naming instead of
 * resurrecting the old session name.
 */
export function backfillMissingThreadName<T extends Pick<Session, 'id' | 'name' | 'threadName' | 'messages'>>(
  session: T
): { session: T; changed: boolean } {
  if (!shouldBackfillThreadName(session)) {
    return { session, changed: false }
  }
  const threadName = hasContentForAutoTitle(session.messages) ? session.name : ''
  return { session: { ...session, threadName }, changed: true }
}

/**
 * Runtime naming only. Assumes missing-field backfill already ran or will
 * run separately — this function never copies `name`.
 */
export function resolveAutoTitleAction(session: AutoTitleSession): AutoTitleAction | null {
  // Cheap field guards first: this runs on every persisted session update and
  // hasContentForAutoTitle walks all messages.
  if (shouldBackfillThreadName(session)) return null
  const wantsSessionName = session.name === UNTITLED_SESSION_NAME
  if (!wantsSessionName && session.threadName) return null
  if (!hasContentForAutoTitle(session.messages)) return null
  return wantsSessionName ? 'session-and-thread' : 'thread'
}
