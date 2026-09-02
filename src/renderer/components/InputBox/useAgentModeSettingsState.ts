import { type CommandApprovalMode, resolveCommandApprovalMode } from '@shared/types'
import { useCallback, useMemo } from 'react'
import { trackCodeExecutionClick } from '@/analytics/agent-mode'
import { rendererApplication } from '@/app/renderer-application'
import platform from '@/platform'
import { recentDirectoriesStore, useRecentDirectories } from '@/stores/recentDirectoriesStore'
import { useSessionSettings } from '@/stores/session/session-settings'
import { useUIStore } from '@/stores/uiStore'

// The working-directory feature needs the desktop filesystem and directory picker. Windows
// uses the native execution backend; bound directory writes are validated in the main process.
export function supportsWorkingDirectories() {
  return platform.isDesktopLike && !!platform.openDirectoryDialog
}

export function getDirectoryName(directory: string) {
  return directory.split(/[\\/]/).filter(Boolean).pop() || directory
}

export interface AgentModeTrackingContext {
  providerId?: string
  modelId?: string
}

// Monotonic tickets ordering explicit choices across all hook instances: a slow
// persisted-session write may commit its value as the new-chat default only while
// it is still the latest choice — an older full_access finishing late must not
// overwrite a newer 'smart' picked elsewhere in the meantime.
let approvalDefaultTicket = 0
let directoriesDefaultTicket = 0

/**
 * Session command-approval policy shared by the Work Mode panel and the composer
 * status row — one store, two entry points, so both stay in sync. Every explicit
 * choice is also remembered as the default for future new chats.
 */
export function useCommandApprovalModeState(sessionId: string, tracking: AgentModeTrackingContext = {}) {
  const isNewSession = sessionId === 'new'
  const newSessionState = useUIStore((s) => s.newSessionState)
  const setNewSessionState = useUIStore((s) => s.setNewSessionState)
  const rememberedMode = useUIStore((s) => s.newSessionCommandApprovalModeDefault)
  const setNewSessionCommandApprovalModeDefault = useUIStore((s) => s.setNewSessionCommandApprovalModeDefault)
  const { sessionSettings } = useSessionSettings(sessionId)

  const commandApprovalMode = resolveCommandApprovalMode(
    isNewSession
      ? {
          commandApprovalMode: newSessionState.commandApprovalMode ?? rememberedMode,
          agentFullAccess: newSessionState.agentFullAccess,
        }
      : sessionSettings
  )

  const { providerId, modelId } = tracking
  const updateCommandApprovalMode = useCallback(
    async (mode: CommandApprovalMode) => {
      if (mode === commandApprovalMode) {
        // Reaffirming the active mode writes nothing to the session, but new chats
        // still keep the latest explicit choice, no matter which chat it was made in.
        approvalDefaultTicket += 1
        setNewSessionCommandApprovalModeDefault(mode)
        return
      }
      trackCodeExecutionClick(
        {
          sessionId,
          mode: 'work_mode',
          provider: providerId,
          model: modelId,
        },
        mode === 'full_access' ? 'full_access' : 'approval'
      )
      const legacyFullAccess = mode === 'full_access' || undefined
      if (isNewSession) {
        approvalDefaultTicket += 1
        setNewSessionCommandApprovalModeDefault(mode)
        setNewSessionState((prev) => ({
          ...prev,
          agentFullAccess: legacyFullAccess,
          commandApprovalMode: mode,
        }))
        return
      }
      const ticket = ++approvalDefaultTicket
      try {
        await rendererApplication.sessions.updateSession(sessionId, (session) => {
          if (!session) {
            throw new Error('Session not found')
          }
          return {
            ...session,
            settings: {
              ...session.settings,
              agentFullAccess: legacyFullAccess,
              commandApprovalMode: mode,
            },
          }
        })
        // Recorded only once the write lands (a failed write must not let future chats
        // silently inherit the new policy) and only while still the latest choice.
        if (ticket === approvalDefaultTicket) {
          setNewSessionCommandApprovalModeDefault(mode)
        }
      } catch (err) {
        console.error('Failed to update command approval mode:', err)
      }
    },
    [
      commandApprovalMode,
      isNewSession,
      modelId,
      providerId,
      sessionId,
      setNewSessionCommandApprovalModeDefault,
      setNewSessionState,
    ]
  )

  return { commandApprovalMode, updateCommandApprovalMode }
}

/**
 * Working directories (desktop only): real local dirs the sandbox may read/write freely.
 * A brand-new chat (sessionId === 'new') is not yet persisted, so its binding is held in
 * newSessionState and transferred into the created session's settings on first submit
 * (see routes/index.tsx) — mirroring how knowledge base / web browsing are handled.
 * Shared by the Work Mode panel and the composer status row; every change is remembered
 * as the default for future new chats.
 */
export function useWorkingDirectoriesState(sessionId: string) {
  const isNewSession = sessionId === 'new'
  const newSessionState = useUIStore((s) => s.newSessionState)
  const setNewSessionState = useUIStore((s) => s.setNewSessionState)
  const rememberedDirectories = useUIStore((s) => s.newSessionWorkingDirectoriesDefault)
  const setNewSessionWorkingDirectoriesDefault = useUIStore((s) => s.setNewSessionWorkingDirectoriesDefault)
  const { sessionSettings } = useSessionSettings(sessionId)

  const workingDirectories = useMemo(
    () =>
      isNewSession
        ? (newSessionState.workingDirectories ?? rememberedDirectories ?? [])
        : (sessionSettings.workingDirectories ?? []),
    [isNewSession, newSessionState.workingDirectories, rememberedDirectories, sessionSettings]
  )
  const recentDirectories = useRecentDirectories()
  const availableRecentDirectories = useMemo(
    () => recentDirectories.filter((dir) => !workingDirectories.includes(dir)),
    [recentDirectories, workingDirectories]
  )

  const updateWorkingDirectories = useCallback(
    async (next: string[]) => {
      const value = next.length ? next : undefined
      if (isNewSession) {
        // New chats keep the latest list, no matter which chat it was edited in.
        directoriesDefaultTicket += 1
        setNewSessionWorkingDirectoriesDefault(next)
        setNewSessionState((prev) => ({ ...prev, workingDirectories: value }))
        return
      }
      const ticket = ++directoriesDefaultTicket
      try {
        await rendererApplication.sessions.updateSession(sessionId, (session) => {
          if (!session) {
            throw new Error('Session not found')
          }
          return { ...session, settings: { ...session.settings, workingDirectories: value } }
        })
        // Recorded only once the write lands and only while still the latest choice,
        // mirroring the approval mode above.
        if (ticket === directoriesDefaultTicket) {
          setNewSessionWorkingDirectoriesDefault(next)
        }
      } catch (err) {
        console.error('Failed to update working directories:', err)
      }
    },
    [isNewSession, sessionId, setNewSessionState, setNewSessionWorkingDirectoriesDefault]
  )

  const addWorkingDirectory = useCallback(async () => {
    if (!platform.openDirectoryDialog) return
    const result = await platform.openDirectoryDialog()
    if (result.canceled || !result.path) return
    recentDirectoriesStore.getState().addDirectory(result.path)
    if (workingDirectories.includes(result.path)) return
    await updateWorkingDirectories([...workingDirectories, result.path])
  }, [workingDirectories, updateWorkingDirectories])

  const selectRecentDirectory = useCallback(
    async (dir: string) => {
      recentDirectoriesStore.getState().addDirectory(dir)
      if (workingDirectories.includes(dir)) return
      await updateWorkingDirectories([...workingDirectories, dir])
    },
    [workingDirectories, updateWorkingDirectories]
  )

  const removeWorkingDirectory = useCallback(
    async (dir: string) => {
      await updateWorkingDirectories(workingDirectories.filter((item) => item !== dir))
    },
    [workingDirectories, updateWorkingDirectories]
  )

  return {
    workingDirectories,
    availableRecentDirectories,
    addWorkingDirectory,
    selectRecentDirectory,
    removeWorkingDirectory,
  }
}
