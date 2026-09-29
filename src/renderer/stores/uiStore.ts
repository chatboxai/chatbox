import type { LocalWorkCapabilityId } from '@shared/mobile-work/capabilities'
import type {
  AgentModeEntry,
  AgentModeValue,
  CommandApprovalMode,
  KnowledgeBase,
  MessagePicture,
  Toast,
} from '@shared/types'
import type { RefObject } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { createStore, useStore } from 'zustand'
import { combine, persist } from 'zustand/middleware'
import platform from '@/platform'
import { safeStorage } from './safeStorage'

export interface TranscriptNavigation {
  readonly owner: symbol
  readonly sessionId: string
  readonly view: 'window' | 'complete'
  scrollToIndex(location: {
    index: number | 'LAST'
    align: 'start' | 'center' | 'end'
    behavior: 'auto' | 'smooth'
  }): boolean
}

/** Tabs of the conversation side panel: pinned tools first, then the built-in browser's pages. */
export type SessionPanelTab = 'settings' | 'threads' | 'web'

export interface SessionPanelState {
  open: boolean
  tab: SessionPanelTab
  /** Browser tab shown while `tab` is `web`. */
  webTab?: string
  /** Browser tabs the model read while another tab was showing. */
  unseenWebTabs: string[]
}

export const DEFAULT_SESSION_PANEL: SessionPanelState = {
  open: false,
  tab: 'settings',
  unseenWebTabs: [],
}

const isSmallScreenViewport = () => {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 599.95px)').matches
  )
}

function updateSessionWebBrowsingMap(
  current: Record<string, boolean | undefined>,
  sessionId: string,
  enabled: boolean
) {
  const next = { ...current, [sessionId]: enabled }
  if (sessionId !== 'new') {
    delete next.new
  }
  return next
}

// UI store for managing UI-related state
// 不能使用immer middleware，会导致RefObject出问题
export const uiStore = createStore(
  persist(
    combine(
      {
        toasts: [] as Toast[],
        quote: '',
        realTheme: localStorage.getItem('initial-theme') === 'dark' ? 'dark' : ('light' as 'light' | 'dark'),
        messageListElement: null as RefObject<HTMLDivElement> | null,
        transcriptNavigation: null as TranscriptNavigation | null,
        messageScrollingAtTop: false,
        messageScrollingAtBottom: false,
        showSidebar: platform.type !== 'mobile' && !isSmallScreenViewport(),
        openSearchDialog: false,
        searchDialogGlobalOnly: false, // 是否只显示全局搜索（用于对话列表）
        openAboutDialog: false, // 是否展示相关信息的窗口
        inputBoxWebBrowsingMode: false,
        sessionWebBrowsingMap: {} as Record<string, boolean | undefined>,
        // Explicit Web Search preference for future new chats. Undefined keeps
        // the provider-specific default for users who have never changed it.
        newSessionWebBrowsingDefault: undefined as boolean | undefined,
        // Cache for current session's computed web browsing state (for keyboard shortcut)
        currentWebBrowsingDisplay: { sessionId: '', value: false } as { sessionId: string; value: boolean },
        sessionKnowledgeBaseMap: {} as Record<string, Pick<KnowledgeBase, 'id' | 'name'> | undefined>,
        newSessionState: {} as {
          knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
          webBrowsing?: boolean
          localWorkCapabilities?: LocalWorkCapabilityId[]
          // Working directories bound before the session is persisted; transferred into the
          // created session's settings on first submit (see routes/index.tsx).
          workingDirectories?: string[]
          agentFullAccess?: boolean
          commandApprovalMode?: CommandApprovalMode
        },
        // Last explicit command-approval / working-directory choices (from any chat).
        // New chats start from these so users don't re-configure every conversation.
        // Undefined = never chosen, so resolveCommandApprovalMode keeps its own default.
        newSessionCommandApprovalModeDefault: undefined as CommandApprovalMode | undefined,
        newSessionWorkingDirectoriesDefault: undefined as string[] | undefined,
        pictureShow: null as {
          picture: MessagePicture
          extraButtons?: {
            onClick: () => void
            icon: React.ReactNode
          }[]
          onSave?: () => void
        } | null,
        widthFull: false, // Stored UI preference
        modelSelectorTab: 'all' as 'all' | 'favorite',
        showCopilotsInNewSession: false,
        sidebarWidth: null as number | null, // Custom sidebar width, null means use default
        collapsedSessionFolderIds: [] as string[],
        agentModeSmartSwitchingDefault: true,
        // Last mode the user explicitly picked in the mode panel; new chats start in this
        // mode so users don't have to re-select Work Mode for every conversation.
        agentModeLastSelected: 'off' as Extract<AgentModeValue, 'on' | 'off'>,
        sessionAgentModeMap: {} as Record<string, AgentModeEntry>,
        promptCacheBreakConfirmDismissed: {} as Record<string, boolean>,
        sessionPanels: {} as Record<string, SessionPanelState | undefined>,
        // Width of the conversation side panel in px; null uses min(560px, 45%).
        sessionPanelWidth: null as number | null,
      },
      (set, get) => ({
        addToast: (content: string, duration?: number, action?: Toast['action']) => {
          const newToast = { id: `toast:${uuidv4()}`, content, duration, action }
          set((state) => ({
            ...state,
            toasts: [...state.toasts, newToast],
          }))
        },
        removeToast: (id: string) => {
          set((state) => ({
            ...state,
            toasts: state.toasts.filter((toast) => toast.id !== id),
          }))
        },

        setQuote: (quote: string) => {
          set({ quote })
        },

        setShowSidebar: (showSidebar: boolean) => {
          set({ showSidebar })
        },

        clearSessionPanel: (sessionId: string) => {
          set((state) => {
            const sessionPanels = { ...state.sessionPanels }
            delete sessionPanels[sessionId]
            return { sessionPanels }
          })
        },

        /**
         * Opens the conversation side panel (a bottom sheet on small screens), on `tab` when given;
         * `webTab` picks the browser tab of the `web` tab.
         */
        openSessionPanel: (sessionId: string, tab?: SessionPanelTab, webTab?: string) => {
          set((state) => {
            const current = state.sessionPanels[sessionId] ?? DEFAULT_SESSION_PANEL
            const nextTab = tab ?? current.tab
            const nextWebTab = webTab ?? current.webTab
            return {
              sessionPanels: {
                ...state.sessionPanels,
                [sessionId]: {
                  ...current,
                  open: true,
                  tab: nextTab,
                  webTab: nextWebTab,
                  unseenWebTabs:
                    nextTab === 'web' ? current.unseenWebTabs.filter((id) => id !== nextWebTab) : current.unseenWebTabs,
                },
              },
            }
          })
        },

        closeSessionPanel: (sessionId: string) => {
          set((state) => {
            const current = state.sessionPanels[sessionId]
            if (!current?.open) return {}
            return { sessionPanels: { ...state.sessionPanels, [sessionId]: { ...current, open: false } } }
          })
        },

        /**
         * A browser tab the model is reading: brought forward when the panel is closed, marked
         * unseen when the panel shows something else.
         */
        revealSessionWebTab: (sessionId: string, webTab: string) => {
          set((state) => {
            const current = state.sessionPanels[sessionId] ?? DEFAULT_SESSION_PANEL
            if (!current.open) {
              const unseenWebTabs = current.unseenWebTabs.filter((id) => id !== webTab)
              return {
                sessionPanels: {
                  ...state.sessionPanels,
                  [sessionId]: { ...current, open: true, tab: 'web', webTab, unseenWebTabs },
                },
              }
            }
            const showing = current.tab === 'web' && current.webTab === webTab
            if (showing || current.unseenWebTabs.includes(webTab)) return {}
            return {
              sessionPanels: {
                ...state.sessionPanels,
                [sessionId]: { ...current, unseenWebTabs: [...current.unseenWebTabs, webTab] },
              },
            }
          })
        },

        /** Forgets a browser tab that closed; the panel moves to a neighbour or back to settings. */
        forgetSessionWebTab: (sessionId: string, webTab: string, neighbour?: string) => {
          set((state) => {
            const current = state.sessionPanels[sessionId]
            if (!current) return {}
            const showing = current.tab === 'web' && current.webTab === webTab
            return {
              sessionPanels: {
                ...state.sessionPanels,
                [sessionId]: {
                  ...current,
                  // The neighbour that comes into view is seen.
                  unseenWebTabs: current.unseenWebTabs.filter((id) => id !== webTab && !(showing && id === neighbour)),
                  ...(showing ? (neighbour ? { webTab: neighbour } : { tab: 'settings', webTab: undefined }) : {}),
                },
              },
            }
          })
        },

        setSessionPanelWidth: (sessionPanelWidth: number | null) => {
          set({ sessionPanelWidth })
        },

        setOpenSearchDialog: (openSearchDialog: boolean, globalOnly = false) => {
          set({ openSearchDialog, searchDialogGlobalOnly: globalOnly })
        },

        setOpenAboutDialog: (openAboutDialog: boolean) => {
          set({ openAboutDialog })
        },

        setInputBoxWebBrowsingMode: (inputBoxWebBrowsingMode: boolean) => {
          set({ inputBoxWebBrowsingMode })
        },

        setPictureShow: (pictureShow: ReturnType<typeof get>['pictureShow']) => {
          set({ pictureShow })
        },

        setWidthFull: (widthFull: boolean) => {
          set({ widthFull })
        },

        setMessageListElement: (messageListElement: RefObject<HTMLDivElement> | null) => {
          set({ messageListElement })
        },

        setTranscriptNavigation: (transcriptNavigation: TranscriptNavigation | null) => {
          set({ transcriptNavigation })
        },

        setMessageScrollingAtTop: (messageScrollingAtTop: boolean) => {
          set({ messageScrollingAtTop })
        },

        setMessageScrollingAtBottom: (messageScrollingAtBottom: boolean) => {
          set({ messageScrollingAtBottom })
        },

        addSessionKnowledgeBase: (sessionId: string, knowledgeBase: Pick<KnowledgeBase, 'id' | 'name'>) => {
          set((state) => ({
            sessionKnowledgeBaseMap: {
              ...state.sessionKnowledgeBaseMap,
              [sessionId]: knowledgeBase,
            },
          }))
        },

        removeSessionKnowledgeBase: (sessionId: string) => {
          set((state) => {
            const newMap = { ...state.sessionKnowledgeBaseMap }
            delete newMap[sessionId]
            return { sessionKnowledgeBaseMap: newMap }
          })
        },

        getSessionWebBrowsing: (sessionId: string) => {
          return get().sessionWebBrowsingMap[sessionId]
        },

        setSessionWebBrowsing: (sessionId: string, enabled: boolean) => {
          set((state) => ({
            sessionWebBrowsingMap: updateSessionWebBrowsingMap(state.sessionWebBrowsingMap, sessionId, enabled),
            newSessionWebBrowsingDefault: enabled,
            // Update cache if it's for the current session (avoid race condition with kbd shortcut)
            currentWebBrowsingDisplay:
              state.currentWebBrowsingDisplay.sessionId === sessionId
                ? { sessionId, value: enabled }
                : state.currentWebBrowsingDisplay,
          }))
        },

        clearSessionWebBrowsing: (sessionId: string = 'new') => {
          set((state) => {
            const newMap = { ...state.sessionWebBrowsingMap }
            delete newMap[sessionId]
            // Clear cache if it's for the cleared session
            const updates: {
              sessionWebBrowsingMap: typeof newMap
              currentWebBrowsingDisplay?: typeof state.currentWebBrowsingDisplay
            } = { sessionWebBrowsingMap: newMap }
            if (state.currentWebBrowsingDisplay.sessionId === sessionId) {
              updates.currentWebBrowsingDisplay = { sessionId: '', value: false }
            }
            return updates
          })
        },

        // Update the cached display value (for kbd shortcut to work)
        updateCurrentWebBrowsingDisplay: (sessionId: string, value: boolean) => {
          set({ currentWebBrowsingDisplay: { sessionId, value } })
        },

        // Toggle web browsing for a session using the cached display value
        toggleSessionWebBrowsing: (sessionId: string) => {
          const { currentWebBrowsingDisplay } = get()
          // Use cached display value if it matches the session, otherwise fallback to stored value
          const currentValue =
            currentWebBrowsingDisplay.sessionId === sessionId
              ? currentWebBrowsingDisplay.value
              : (get().sessionWebBrowsingMap[sessionId] ?? false)
          const newValue = !currentValue
          set((state) => ({
            sessionWebBrowsingMap: updateSessionWebBrowsingMap(state.sessionWebBrowsingMap, sessionId, newValue),
            newSessionWebBrowsingDefault: newValue,
            // Update cache to keep it in sync
            currentWebBrowsingDisplay: { sessionId, value: newValue },
          }))
        },

        setNewSessionState: (
          newSessionState:
            | ReturnType<typeof get>['newSessionState']
            | ((prev: ReturnType<typeof get>['newSessionState']) => ReturnType<typeof get>['newSessionState'])
        ) => {
          set({
            newSessionState:
              typeof newSessionState === 'function' ? newSessionState(get().newSessionState) : newSessionState,
          })
        },

        setNewSessionCommandApprovalModeDefault: (mode: CommandApprovalMode) => {
          set({ newSessionCommandApprovalModeDefault: mode })
        },

        setNewSessionWorkingDirectoriesDefault: (directories: string[]) => {
          set({ newSessionWorkingDirectoriesDefault: directories })
        },

        setShowCopilotsInNewSession: (showCopilotsInNewSession: boolean) => {
          set({ showCopilotsInNewSession })
        },

        setSidebarWidth: (sidebarWidth: number | null) => {
          set({ sidebarWidth })
        },

        setSessionFolderCollapsed: (folderId: string, collapsed: boolean) => {
          set((state) => {
            const others = state.collapsedSessionFolderIds.filter((id) => id !== folderId)
            return { collapsedSessionFolderIds: collapsed ? [...others, folderId] : others }
          })
        },

        setModelSelectorTab: (tab: string | null) => {
          if (tab === 'all' || tab === 'favorite') {
            set({ modelSelectorTab: tab })
          }
        },

        setAgentModeSmartSwitchingDefault: (enabled: boolean) => {
          set({ agentModeSmartSwitchingDefault: enabled })
        },

        setAgentModeLastSelected: (mode: Extract<AgentModeValue, 'on' | 'off'>) => {
          set({ agentModeLastSelected: mode })
        },

        clearSessionAgentMode: (sessionId?: string) => {
          if (sessionId) {
            set((state) => {
              const newMap = { ...state.sessionAgentModeMap }
              delete newMap[sessionId]
              return { sessionAgentModeMap: newMap }
            })
          } else {
            set({ sessionAgentModeMap: {} })
          }
        },
      })
    ),
    {
      name: 'ui-store',
      version: 0,
      partialize: (state) => ({
        widthFull: state.widthFull,
        modelSelectorTab: state.modelSelectorTab,
        showCopilotsInNewSession: state.showCopilotsInNewSession,
        sidebarWidth: state.sidebarWidth,
        collapsedSessionFolderIds: state.collapsedSessionFolderIds,
        agentModeSmartSwitchingDefault: state.agentModeSmartSwitchingDefault,
        agentModeLastSelected: state.agentModeLastSelected,
        newSessionWebBrowsingDefault: state.newSessionWebBrowsingDefault,
        newSessionCommandApprovalModeDefault: state.newSessionCommandApprovalModeDefault,
        newSessionWorkingDirectoriesDefault: state.newSessionWorkingDirectoriesDefault,
        sessionWebBrowsingMap: state.sessionWebBrowsingMap,
        sessionKnowledgeBaseMap: state.sessionKnowledgeBaseMap,
        promptCacheBreakConfirmDismissed: state.promptCacheBreakConfirmDismissed,
        sessionPanelWidth: state.sessionPanelWidth,
      }),
      storage: safeStorage,
    }
  )
)

export function useUIStore<U>(selector: Parameters<typeof useStore<typeof uiStore, U>>[1]) {
  return useStore<typeof uiStore, U>(uiStore, selector)
}
