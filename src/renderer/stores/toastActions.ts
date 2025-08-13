import { getDefaultStore } from 'jotai'
import { v4 as uuidv4 } from 'uuid'
import * as atoms from './atoms'

export function add(content: string, duration?: number) {
  const store = getDefaultStore()
  const newToast = { id: `toast:${uuidv4()}`, content, duration }
  store.set(atoms.toastsAtom, (toasts) => [...toasts, newToast])
}

export function remove(id: string) {
  const store = getDefaultStore()
  store.set(atoms.toastsAtom, (toasts) => toasts.filter((toast) => toast.id !== id))
}
