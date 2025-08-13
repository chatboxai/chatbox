import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type React from 'react'
import type { RefObject } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import platform from '@/platform'
import type { KnowledgeBase, MessagePicture, Toast } from '../../../shared/types'

// toasts
export const toastsAtom = atom<Toast[]>([])

// quote 消息引用
export const quoteAtom = atom<string>('')

// theme
export const realThemeAtom = atom<'light' | 'dark'>(localStorage.getItem('initial-theme') === 'dark' ? 'dark' : 'light') // This might relate more to settings? Re-evaluating. -> Keep here for now as it might be derived/runtime theme.

// message scrolling
export const messageListElementAtom = atom<null | RefObject<HTMLDivElement>>(null)
export const messageScrollingAtom = atom<null | RefObject<VirtuosoHandle>>(null)
export const messageScrollingAtTopAtom = atom(false)
export const messageScrollingAtBottomAtom = atom(false)
export const messageScrollingScrollPositionAtom = atom<number>(0) // 当前视图高度位置（包含了视图的高度+视图距离顶部的偏移）

// Sidebar visibility
export const showSidebarAtom = atom(platform.type !== 'mobile')

// Dialog states (excluding settings, session clean, copilot which were moved)
export const openSearchDialogAtom = atom(false)
export const openWelcomeDialogAtom = atom(false)
export const openAboutDialogAtom = atom(false) // 是否展示相关信息的窗口

// Input box related state
export const inputBoxLinksAtom = atom<{ url: string }[]>([])
export const inputBoxWebBrowsingModeAtom = atom(false)

// Session-specific knowledge base selections (sessionId -> knowledge base)
export const sessionKnowledgeBaseMapAtom = atom<Record<string, Pick<KnowledgeBase, 'id' | 'name'> | undefined>>({})

// Temporary state for new sessions (before they are created)
export const newSessionStateAtom = atom<{
  knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
  webBrowsing?: boolean
}>({})

// Picture viewer state
export const pictureShowAtom = atom<{
  picture: MessagePicture
  extraButtons?: {
    onClick: () => void
    icon: React.ReactNode
  }[]
  onSave?: () => void
} | null>(null)

// Layout state
export const widthFullAtom = atomWithStorage<boolean>('widthFull', false) // Stored UI preference
export const showCopilotsInNewSessionAtom = atomWithStorage<boolean>('showCopilotsInNewSession', false)
