import type { SessionHeader } from '@chatbox/core/ports'
import {
  getSessionActionGate,
  type SessionAction,
  type SessionActionContext,
  type SessionLockState,
} from '@chatbox/core/session/action-gates'
import { resolveSessionMode } from '@chatbox/core/session/mode-policy'
import { supportsSessionGeneration } from '@shared/session/capabilities'
import { t } from 'i18next'
import { rendererApplication } from '@/app/renderer-application'
import { notifySessionLockBlocked } from '@/utils/session-lock-copy'
import { getCompactionUIState } from '../atoms/compactionAtoms'
import { getSessionAgentModeEntry } from './agent-mode'

/**
 * Derive the lock snapshot for a session from its current stored state plus
 * the compaction runtime flag. Imperative counterpart to useSessionLockState
 * for call sites that must not hold a subscription (store actions, modal
 * click handlers). Only control metadata is needed for the lock state.
 */
export async function getSessionLockStateNow(sessionId: string): Promise<SessionLockState | null> {
  const control = await rendererApplication.sessions.readSessionGenerationControl({
    sessionId,
    activeGenerationMessageIds: [...rendererApplication.generationRuntime.getActiveMessageIds(sessionId)],
  })
  return control
    ? {
        generatingReplyCount: control.generatingReplyCount,
        anyReplyGenerating: control.anyReplyGenerating,
        awaitingPauseDecision: control.awaitingPauseDecision,
        compactionRunning: getCompactionUIState(sessionId).status === 'running',
      }
    : null
}

async function readLockSnapshot(
  sessionId: string,
  preloadedSession?: SessionHeader | null
): Promise<{ session: SessionHeader; locks: SessionLockState } | null> {
  const locks = await getSessionLockStateNow(sessionId)
  if (!locks) return null
  const session = preloadedSession ?? (await rendererApplication.sessions.getSessionHeader(sessionId))?.header
  if (!session) return null
  return {
    session,
    locks,
  }
}

/**
 * Store-side enforcement of the shared session action gates. UI entry points
 * pre-check the gate for immediate feedback (disabled controls, tooltips), but
 * the check that actually protects session state lives here, next to the
 * action — a caller that forgets to pre-check (a new surface, a stale modal, a
 * future CLI wiring) gets blocked with the standard notice instead of racing a
 * streaming reply.
 *
 * Returns true when the action may proceed. On block it shows the standard
 * lock notice and returns false, so `void`-called actions stay rejection-free.
 */
export async function guardSessionAction(
  sessionId: string,
  action: SessionAction,
  context: SessionActionContext = {},
  preloadedSession?: SessionHeader | null
): Promise<boolean> {
  let session: SessionHeader | null
  let locks: SessionLockState | null
  try {
    const snapshot = await readLockSnapshot(sessionId, preloadedSession)
    session = snapshot?.session ?? null
    locks = snapshot?.locks ?? null
  } catch {
    // A failed session read must not turn a void-called action into an
    // unhandled rejection; fall back to the action's own error handling.
    return true
  }
  if (!locks) {
    // Let the action surface its own "session not found" handling.
    return true
  }
  if (session && !supportsSessionGeneration(session.type) && action !== 'switch-fork') {
    await notifySessionLockBlocked('read-only', t)
    return false
  }
  // Store-side calls resolve the session mode here so every guarded action
  // sees the same mode-aware policy as the UI pre-checks; an explicitly
  // passed context.sessionMode wins.
  const gate = getSessionActionGate(action, locks, {
    sessionMode: resolveSessionMode(getSessionAgentModeEntry(sessionId, session).value),
    ...context,
  })
  if (gate.allowed) {
    return true
  }
  await notifySessionLockBlocked(gate.reason, t)
  return false
}
