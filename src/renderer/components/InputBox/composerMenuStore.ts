import { create } from 'zustand'

export type ComposerMenuId = 'work-mode-panel' | 'approval-status' | 'working-dir-status'

interface ComposerMenuState {
  activeMenu: ComposerMenuId | null
  openMenu: (id: ComposerMenuId) => void
  closeMenu: (id: ComposerMenuId) => void
}

/**
 * Single-slot coordination for the popup menus around the composer: the Work Mode
 * hover panel and the status-row chip menus overlap the same area above the input,
 * so opening any of them claims the slot and the others close.
 */
export const useComposerMenuStore = create<ComposerMenuState>((set) => ({
  activeMenu: null,
  openMenu: (id) => set({ activeMenu: id }),
  closeMenu: (id) => set((state) => (state.activeMenu === id ? { activeMenu: null } : state)),
}))
