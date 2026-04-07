import { create } from 'zustand'
import type { PluginManifest } from '../../shared/types/chatbridge'
import type { ChatBridgeWsClient } from '../packages/chatbridge/ws-client'

type AppEntry = {
  context: Record<string, unknown> // last state_update from this app
  status: 'active' | 'suspended'
}

type SessionState = {
  active: boolean
  activeApp: string | null
  apps: Record<string, AppEntry>
  failureCounts: Record<string, number> // circuit breaker counts per app name
}

type PendingToolCall = {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export type ToolInvoker = (toolCallId: string, toolName: string, params: unknown) => Promise<unknown>

type ChatBridgeState = {
  registry: PluginManifest[]
  sessions: Record<string, SessionState>
  wsClient: ChatBridgeWsClient | null
  pendingToolCalls: Record<string, PendingToolCall>
  toolInvokers: Record<string, ToolInvoker | null>

  setRegistry: (apps: PluginManifest[]) => void
  activateSession: (sessionId: string) => void
  activateApp: (sessionId: string, appName: string) => void
  deactivateApp: (sessionId: string, appName: string) => void
  suspendApp: (sessionId: string, appName: string) => void
  updateAppState: (sessionId: string, appName: string, state: unknown) => void
  isActive: (sessionId: string) => boolean
  getActiveApp: (sessionId: string) => string | null
  getAppContext: (sessionId: string) => Record<string, unknown>
  getWsClient: () => ChatBridgeWsClient | null
  setWsClient: (client: ChatBridgeWsClient) => void
  recordFailure: (sessionId: string, appName: string) => number
  resetFailures: (sessionId: string, appName: string) => void
  addPendingToolCall: (toolCallId: string, pending: PendingToolCall) => void
  removePendingToolCall: (toolCallId: string) => void
  setToolInvoker: (sessionId: string, fn: ToolInvoker | null) => void
  getToolInvoker: (sessionId: string) => ToolInvoker | null
}

const makeEmptySession = (): SessionState => ({
  active: false,
  activeApp: null,
  apps: {},
  failureCounts: {},
})

export const chatBridgeStore = create<ChatBridgeState>()((set, get) => ({
  registry: [],
  sessions: {},
  wsClient: null,
  pendingToolCalls: {},
  toolInvokers: {},

  setRegistry: (apps) => set({ registry: apps }),

  activateSession: (sessionId) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...(state.sessions[sessionId] ?? makeEmptySession()),
          active: true,
        },
      },
    }))
  },

  activateApp: (sessionId, appName) => {
    set((state) => {
      const existing = state.sessions[sessionId] ?? makeEmptySession()
      // No-op if already the active app
      if (existing.activeApp === appName) return state
      // Suspend the currently active app if there is one
      const updatedApps = { ...existing.apps }
      if (existing.activeApp && updatedApps[existing.activeApp]) {
        updatedApps[existing.activeApp] = { ...updatedApps[existing.activeApp], status: 'suspended' }
      }
      // Activate or restore the requested app
      updatedApps[appName] = {
        context: updatedApps[appName]?.context ?? {},
        status: 'active',
      }
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            active: true,
            activeApp: appName,
            apps: updatedApps,
          },
        },
      }
    })
  },

  deactivateApp: (sessionId, appName) => {
    set((state) => {
      const existing = state.sessions[sessionId]
      if (!existing) return state
      const updatedApps = { ...existing.apps }
      delete updatedApps[appName]
      const hasApps = Object.keys(updatedApps).length > 0
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            apps: updatedApps,
            activeApp: existing.activeApp === appName ? null : existing.activeApp,
            active: hasApps,
          },
        },
      }
    })
  },

  suspendApp: (sessionId, appName) => {
    set((state) => {
      const existing = state.sessions[sessionId]
      if (!existing || !existing.apps[appName]) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            apps: {
              ...existing.apps,
              [appName]: { ...existing.apps[appName], status: 'suspended' },
            },
            activeApp: existing.activeApp === appName ? null : existing.activeApp,
          },
        },
      }
    })
  },

  updateAppState: (sessionId, appName, appState) => {
    set((state) => {
      const existing = state.sessions[sessionId] ?? makeEmptySession()
      const currentEntry = existing.apps[appName]
      if (!currentEntry) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            apps: {
              ...existing.apps,
              [appName]: { ...currentEntry, context: appState as Record<string, unknown> },
            },
          },
        },
      }
    })
  },

  isActive: (sessionId) => {
    return get().sessions[sessionId]?.active === true
  },

  getActiveApp: (sessionId) => {
    return get().sessions[sessionId]?.activeApp ?? null
  },

  getAppContext: (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session) return {}
    const activeApp = session.activeApp
    const previousApps = Object.entries(session.apps)
      .filter(([name, entry]) => name !== activeApp && entry.status === 'suspended')
      .map(([name]) => name)
    if (!activeApp || !session.apps[activeApp]) {
      return { activeApps: [], states: {}, previousApps }
    }
    return {
      activeApps: [activeApp],
      states: { [activeApp]: session.apps[activeApp].context },
      previousApps,
    }
  },

  getWsClient: () => get().wsClient,

  setWsClient: (client) => set({ wsClient: client }),

  recordFailure: (sessionId, appName) => {
    const existing = get().sessions[sessionId] ?? makeEmptySession()
    const newCount = (existing.failureCounts[appName] ?? 0) + 1
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...(state.sessions[sessionId] ?? makeEmptySession()),
          failureCounts: {
            ...(state.sessions[sessionId]?.failureCounts ?? {}),
            [appName]: newCount,
          },
        },
      },
    }))
    if (newCount >= 3) {
      console.error(`[ChatBridge] Circuit breaker: ${appName} deactivated after ${newCount} consecutive failures`)
      get().deactivateApp(sessionId, appName)
    }
    return newCount
  },

  resetFailures: (sessionId, appName) => {
    set((state) => {
      const existing = state.sessions[sessionId]
      if (!existing) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            failureCounts: { ...existing.failureCounts, [appName]: 0 },
          },
        },
      }
    })
  },

  addPendingToolCall: (toolCallId, pending) => {
    set((state) => ({
      pendingToolCalls: { ...state.pendingToolCalls, [toolCallId]: pending },
    }))
  },

  removePendingToolCall: (toolCallId) => {
    set((state) => {
      const next = { ...state.pendingToolCalls }
      delete next[toolCallId]
      return { pendingToolCalls: next }
    })
  },

  setToolInvoker: (sessionId, fn) => {
    set((state) => ({
      toolInvokers: { ...state.toolInvokers, [sessionId]: fn },
    }))
  },

  getToolInvoker: (sessionId) => {
    return get().toolInvokers[sessionId] ?? null
  },
}))
