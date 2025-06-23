import { RefObject } from 'react'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { Toast, MessagePicture } from '../../../shared/types' // Need this import
import { VirtuosoHandle } from 'react-virtuoso'
import React from 'react' // Need React for React.ReactNode

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
export const showSidebarAtom = atom(true)

// Dialog states (excluding settings, session clean, copilot which were moved)
export const openSearchDialogAtom = atom(false)
export const openWelcomeDialogAtom = atom(false)
export const openAboutDialogAtom = atom(false) // 是否展示相关信息的窗口

// Input box related state
export const inputBoxLinksAtom = atom<{ url: string }[]>([])
export const inputBoxWebBrowsingModeAtom = atom(false)

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
