import { getDefaultStore } from 'jotai'
import { currentSessionIdAtom } from '@/stores/atoms/sessionAtoms'

const INFLIGHT_KEY = 'chatbox.sessionStartupInflight'
const FAILED_KEY = 'chatbox.sessionStartupFailed'

type InflightAttempt = {
  sessionId: string
  startedAt: number
}

type RecoverySnapshot = {
  retrySessionId: string | null
  revision: number
}

type Listener = () => void

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

function readJson<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    storage()?.setItem(key, JSON.stringify(value))
  } catch {
    // Recovery state is best effort and must never stop the renderer from starting.
  }
}

function removeKey(key: string) {
  try {
    storage()?.removeItem(key)
  } catch {
    // Recovery state is best effort and must never stop the renderer from starting.
  }
}

function isRecoverableSessionId(sessionId: string | null | undefined): sessionId is string {
  return Boolean(sessionId && sessionId !== 'new')
}

export class SessionStartupRecoveryCoordinator {
  private activeAttemptSessionId: string | null = null
  private listeners = new Set<Listener>()
  private snapshot: RecoverySnapshot = { retrySessionId: null, revision: 0 }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  private publish(retrySessionId = this.snapshot.retrySessionId) {
    this.snapshot = { retrySessionId, revision: this.snapshot.revision + 1 }
    for (const listener of this.listeners) listener()
  }

  private readFailedSessionIds(): string[] {
    const value = readJson<unknown>(FAILED_KEY)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  }

  private readInflightAttempt(): InflightAttempt | null {
    const value = readJson<InflightAttempt>(INFLIGHT_KEY)
    return isRecoverableSessionId(value?.sessionId) ? value : null
  }

  private clearRetry(sessionId: string): boolean {
    if (this.snapshot.retrySessionId !== sessionId) return false
    this.publish(null)
    return true
  }

  begin(sessionId: string) {
    if (!isRecoverableSessionId(sessionId)) return
    this.activeAttemptSessionId = sessionId
    writeJson(INFLIGHT_KEY, { sessionId, startedAt: Date.now() } satisfies InflightAttempt)
  }

  abandon(sessionId: string) {
    if (this.activeAttemptSessionId === sessionId) {
      this.activeAttemptSessionId = null
    }
    if (this.readInflightAttempt()?.sessionId === sessionId) {
      removeKey(INFLIGHT_KEY)
    }
  }

  settle(sessionId: string) {
    if (!isRecoverableSessionId(sessionId)) return
    this.abandon(sessionId)
    writeJson(
      FAILED_KEY,
      this.readFailedSessionIds().filter((id) => id !== sessionId)
    )
    if (!this.clearRetry(sessionId)) this.publish()
  }

  fail(sessionId: string) {
    if (!isRecoverableSessionId(sessionId)) return
    this.abandon(sessionId)
    const failed = new Set(this.readFailedSessionIds())
    failed.add(sessionId)
    writeJson(FAILED_KEY, [...failed])
    if (!this.clearRetry(sessionId)) this.publish()
  }

  isRecoveryRequired(sessionId: string | null | undefined): boolean {
    if (!isRecoverableSessionId(sessionId)) return false
    if (this.readFailedSessionIds().includes(sessionId)) return true
    const inflight = this.readInflightAttempt()
    return inflight?.sessionId === sessionId && this.activeAttemptSessionId !== sessionId
  }

  shouldSkipAutoRestore(sessionId: string | null | undefined): boolean {
    if (!isRecoverableSessionId(sessionId)) return false
    if (!this.isRecoveryRequired(sessionId)) return false
    this.fail(sessionId)
    return true
  }

  promotePreviousAttempt() {
    const inflight = this.readInflightAttempt()
    if (!inflight || this.activeAttemptSessionId === inflight.sessionId) return
    this.fail(inflight.sessionId)
  }

  retry(sessionId: string) {
    if (!isRecoverableSessionId(sessionId)) return
    this.publish(sessionId)
  }

  leave(sessionId: string) {
    this.clearRetry(sessionId)
  }

  getLoadTarget(sessionId: string | null): string | null {
    if (!sessionId) return null
    return this.isRecoveryRequired(sessionId) && this.snapshot.retrySessionId !== sessionId ? null : sessionId
  }

  completeArchive(sessionId: string) {
    const atomStore = getDefaultStore()
    if (atomStore.get(currentSessionIdAtom) === sessionId) {
      atomStore.set(currentSessionIdAtom, null)
    }
    this.settle(sessionId)
  }

  forget(sessionIds: Iterable<string>) {
    const ids = new Set(sessionIds)
    if (ids.size === 0) return
    if (this.activeAttemptSessionId && ids.has(this.activeAttemptSessionId)) {
      this.activeAttemptSessionId = null
    }
    const inflight = this.readInflightAttempt()
    if (inflight && ids.has(inflight.sessionId)) {
      removeKey(INFLIGHT_KEY)
    }
    writeJson(
      FAILED_KEY,
      this.readFailedSessionIds().filter((id) => !ids.has(id))
    )
    this.publish(
      this.snapshot.retrySessionId && ids.has(this.snapshot.retrySessionId) ? null : this.snapshot.retrySessionId
    )
  }

  clearForTests() {
    removeKey(INFLIGHT_KEY)
    removeKey(FAILED_KEY)
    this.activeAttemptSessionId = null
    this.snapshot = { retrySessionId: null, revision: 0 }
    for (const listener of this.listeners) listener()
  }
}

export const sessionStartupRecovery = new SessionStartupRecoveryCoordinator()
