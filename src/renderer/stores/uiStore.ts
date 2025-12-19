import type { RefObject } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import type { KnowledgeBase, MessagePicture, Toast } from 'src/shared/types'
import { v4 as uuidv4 } from 'uuid'
import { createStore, useStore } from 'zustand'
import { combine, persist } from 'zustand/middleware'
import platform from '@/platform'
import { safeStorage } from './safeStorage'

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
        messageScrolling: null as RefObject<VirtuosoHandle> | null,
        messageScrollingAtTop: false,
        messageScrollingAtBottom: false,
        showSidebar: platform.type !== 'mobile',
        openSearchDialog: false,
        openAboutDialog: false, // 是否展示相关信息的窗口
        inputBoxWebBrowsingMode: false,
        sessionKnowledgeBaseMap: {} as Record<string, Pick<KnowledgeBase, 'id' | 'name'> | undefined>,
        newSessionState: {} as {
          knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
          webBrowsing?: boolean
        },
        pictureShow: null as {
          picture: MessagePicture
          extraButtons?: {
            onClick: () => void
            icon: React.ReactNode
          }[]
          onSave?: () => void
        } | null,
        widthFull: false, // Stored UI preference
        showCopilotsInNewSession: false,
        sidebarWidth: null as number | null, // Custom sidebar width, null means use default
      },
      (set, get) => ({
        addToast: (content: string, duration?: number) => {
          const newToast = { id: `toast:${uuidv4()}`, content, duration }
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
          console.log('setShowSidebar:', showSidebar)
          set({ showSidebar })
        },

        setOpenSearchDialog: (openSearchDialog: boolean) => {
          set({ openSearchDialog })
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

        setMessageScrolling: (messageScrolling: RefObject<VirtuosoHandle> | null) => {
          set({ messageScrolling })
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

        setShowCopilotsInNewSession: (showCopilotsInNewSession: boolean) => {
          set({ showCopilotsInNewSession })
        },

        setSidebarWidth: (sidebarWidth: number | null) => {
          set({ sidebarWidth })
        },
      })
    ),
    {
      name: 'ui-store',
      version: 0,
      partialize: (state) => ({
        widthFull: state.widthFull,
        showCopilotsInNewSession: state.showCopilotsInNewSession,
        inputBoxWebBrowsingMode: state.inputBoxWebBrowsingMode,
        sidebarWidth: state.sidebarWidth,
      }),
      storage: safeStorage,
    }
  )
)

export function useUIStore<U>(selector: Parameters<typeof useStore<typeof uiStore, U>>[1]) {
  return useStore<typeof uiStore, U>(uiStore, selector)
}
