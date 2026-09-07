import { hasConversationStarted, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import type {
  AgentModeEntry,
  AgentModeLockReason,
  AgentModeValue,
  Session,
  SessionPromptContextSnapshot,
} from '@shared/types'
import { useMemo } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import { uiStore, useUIStore } from '../uiStore'

export function createDefaultAgentModeEntry(smartSwitchingDefault = uiStore.getState().agentModeSmartSwitchingDefault) {
  return {
    value: smartSwitchingDefault ? 'auto' : 'off',
    locked: false,
    lockReason: null,
  } satisfies AgentModeEntry
}

/**
 * Default entry for a brand-new chat ('new'): starts from the mode the user last
 * explicitly selected in the mode panel, so Work Mode users don't have to re-select
 * it for every conversation. Chat Mode keeps the smart switching preference.
 *
 * Existing sessions without a stored agentMode must NOT use this fallback —
 * createDefaultAgentModeEntry keeps them in chat mode.
 */
export function createNewChatAgentModeEntry(
  lastSelected = uiStore.getState().agentModeLastSelected,
  smartSwitchingDefault = uiStore.getState().agentModeSmartSwitchingDefault
): AgentModeEntry {
  if (lastSelected === 'on') {
    return { value: 'on', locked: false, lockReason: null }
  }
  return createDefaultAgentModeEntry(smartSwitchingDefault)
}

export function getSessionAgentModeFromSession(
  session: Pick<Session, 'settings'> | null | undefined
): AgentModeEntry | undefined {
  return session?.settings?.agentMode
}

export function getSessionAgentModeEntry(
  sessionId: string,
  session?: Pick<Session, 'settings'> | null,
  legacyMap = uiStore.getState().sessionAgentModeMap
): AgentModeEntry {
  return (
    getSessionAgentModeFromSession(session) ??
    legacyMap[sessionId] ??
    (sessionId === 'new' ? createNewChatAgentModeEntry() : createDefaultAgentModeEntry())
  )
}

export function useSessionAgentMode(sessionId: string): AgentModeEntry {
  const legacyMap = useUIStore((state) => state.sessionAgentModeMap)
  const smartSwitchingDefault = useUIStore((state) => state.agentModeSmartSwitchingDefault)
  const lastSelected = useUIStore((state) => state.agentModeLastSelected)
  const { session } = rendererApplication.sessionHooks.useSession(sessionId === 'new' ? null : sessionId)

  return useMemo(() => {
    return (
      getSessionAgentModeFromSession(session) ??
      legacyMap[sessionId] ??
      (sessionId === 'new'
        ? createNewChatAgentModeEntry(lastSelected, smartSwitchingDefault)
        : createDefaultAgentModeEntry(smartSwitchingDefault))
    )
  }, [legacyMap, session, sessionId, smartSwitchingDefault, lastSelected])
}

function setNewSessionAgentMode(value: AgentModeValue): AgentModeEntry {
  const current = uiStore.getState().sessionAgentModeMap.new
  if (current?.locked && value !== 'on') return current
  const next: AgentModeEntry = { value, locked: current?.locked ?? false, lockReason: current?.lockReason ?? null }
  uiStore.setState((state) => ({
    sessionAgentModeMap: {
      ...state.sessionAgentModeMap,
      new: next,
    },
  }))
  return next
}

function lockNewSessionAgentMode(reason: Exclude<AgentModeLockReason, null>): AgentModeEntry {
  const next: AgentModeEntry = { value: 'on', locked: true, lockReason: reason }
  uiStore.setState((state) => ({
    sessionAgentModeMap: {
      ...state.sessionAgentModeMap,
      new: next,
    },
  }))
  return next
}

function requireSession<T extends Pick<Session, 'settings'>>(session: T | null | undefined): T {
  if (!session) {
    throw new Error('Session not found')
  }
  return session
}

function applyAgentMode<T extends Pick<Session, 'settings'>>(
  session: T | null | undefined,
  agentMode: AgentModeEntry
): T {
  const current = requireSession(session)
  return {
    ...current,
    settings: {
      ...(current.settings || {}),
      agentMode,
    },
  } as T
}

function resolveSetAgentMode<T extends Pick<Session, 'settings'>>(
  sessionId: string,
  session: T | null | undefined,
  value: AgentModeValue
): { session: T; entry: AgentModeEntry } {
  const currentSession = requireSession(session)
  const current = getSessionAgentModeEntry(sessionId, currentSession)
  if (current.locked && value !== 'on') {
    return { session: currentSession, entry: current }
  }
  const entry: AgentModeEntry = { value, locked: current.locked, lockReason: current.lockReason }
  return { session: applyAgentMode(currentSession, entry), entry }
}

/**
 * Persist a freshly captured prompt-context snapshot with a compare-and-swap guard.
 * Snapshot capture awaits disk I/O; a thread switch or new-thread action during
 * that window re-owns the session's snapshot slot, so the write is skipped when
 * the stored snapshot no longer matches what the capturing generation observed
 * — stale prompt context is never attached to a different conversation.
 */
export function persistSessionPromptContextSnapshotGuarded(
  sessionId: string,
  snapshot: SessionPromptContextSnapshot,
  expectedCapturedAt: number | undefined
): void {
  const applySnapshot = <T extends Pick<Session, 'settings'>>(current: T | null | undefined): T => {
    const session = requireSession(current)
    if (session.settings?.sessionPromptContextSnapshot?.capturedAt !== expectedCapturedAt) return session
    return {
      ...session,
      settings: { ...(session.settings || {}), sessionPromptContextSnapshot: snapshot },
    } as T
  }
  rendererApplication.sessionQueryBridge.updateSessionCache(sessionId, (current) => applySnapshot(current))
  void rendererApplication.sessions.updateSession(sessionId, (current) => applySnapshot(current))
}

export type SetAgentModeSource =
  /** An explicit user choice in the mode panel. */
  | 'user'
  /** Suggestion resolution and other generation-flow adjustments. */
  | 'system'

export async function setSessionAgentMode(
  sessionId: string,
  value: AgentModeValue,
  options: { source?: SetAgentModeSource } = {}
): Promise<AgentModeEntry> {
  if (sessionId === 'new') {
    return setNewSessionAgentMode(value)
  }

  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  if (!session) {
    return createDefaultAgentModeEntry()
  }

  let next = getSessionAgentModeEntry(sessionId, session)
  if (next.locked && value !== 'on') return next
  // Manual cross-mode switching is only offered before the conversation
  // starts; afterwards the modes have diverged too far (structural freedom vs
  // queue/steering) to swap in place — the user starts a new chat instead.
  // Smart-switching resolution ('system') is exempt, and 'auto' ↔ 'off' is a
  // chat-internal preference, not a mode change.
  if (
    (options.source ?? 'user') === 'user' &&
    resolveSessionMode(value) !== resolveSessionMode(next.value) &&
    hasConversationStarted(session)
  ) {
    return next
  }

  rendererApplication.sessionQueryBridge.updateSessionCache(sessionId, (currentSession) => {
    const resolved = resolveSetAgentMode(sessionId, currentSession, value)
    next = resolved.entry
    return resolved.session
  })

  await rendererApplication.sessions.updateSession(sessionId, (currentSession) => {
    const resolved = resolveSetAgentMode(sessionId, currentSession, value)
    next = resolved.entry
    return resolved.session
  })
  uiStore.getState().clearSessionAgentMode(sessionId)
  return next
}

export async function lockSessionAgentMode(
  sessionId: string,
  reason: Exclude<AgentModeLockReason, null>
): Promise<AgentModeEntry> {
  if (sessionId === 'new') {
    return lockNewSessionAgentMode(reason)
  }

  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  if (!session) {
    return { value: 'on', locked: true, lockReason: reason }
  }

  const next: AgentModeEntry = { value: 'on', locked: true, lockReason: reason }
  rendererApplication.sessionQueryBridge.updateSessionCache(sessionId, (currentSession) =>
    applyAgentMode(currentSession, next)
  )
  await rendererApplication.sessions.updateSession(sessionId, (currentSession) => applyAgentMode(currentSession, next))
  uiStore.getState().clearSessionAgentMode(sessionId)
  return next
}
