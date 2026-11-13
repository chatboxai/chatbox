import type { Toast } from '@shared/types'
import { uiStore } from './uiStore'

export function add(content: string, duration?: number | null, action?: Toast['action']): string {
  return uiStore.getState().addToast(content, duration, action)
}

export function remove(id: string) {
  uiStore.getState().removeToast(id)
}
