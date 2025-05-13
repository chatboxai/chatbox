import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

// 从其他文件导入所有 atom
export * from './atoms/uiAtoms'
export * from './atoms/settingsAtoms'
export * from './atoms/sessionAtoms'
export * from './atoms/configAtoms'
export * from './atoms/throttleWriteSessionAtom'

export interface Bookmark {
  messageId: string
  title: string
  timestamp: number
  sessionId: string
}

export const bookmarksAtom = atomWithStorage<Bookmark[]>('bookmarks', [])
export const bookmarkSidebarOpenAtom = atom<boolean>(false)

// Copilot 相关的 atom
export const openCopilotDialogAtom = atom<boolean>(false)
export const myCopilotsAtom = atomWithStorage<any[]>('myCopilots', []) 