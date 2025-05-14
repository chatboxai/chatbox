import { atom } from 'jotai'

export * from './settingsAtoms'
export * from './sessionAtoms'
export * from './configAtoms'
export * from './throttleWriteSessionAtom'
export * from './uiAtoms'
export * from './copilotAtoms'

export interface Bookmark {
  messageId: string
  title: string
  timestamp: number
  sessionId: string
}

export const bookmarksAtom = atom<Bookmark[]>([])
export const bookmarkSidebarOpenAtom = atom<boolean>(false)
