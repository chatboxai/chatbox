// @vitest-environment jsdom
import { createStore } from 'jotai'
import { afterEach, expect, test, vi } from 'vitest'
import { currentSessionIdAtom } from './sessionAtoms'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

test('keeps the current session usable when browser storage is full', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const store = createStore()
  store.set(currentSessionIdAtom, 'session-1')
  expect(store.get(currentSessionIdAtom)).toBe('session-1')
})

test('preserves unexpected storage errors', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('unexpected storage failure')
  })
  expect(() => createStore().set(currentSessionIdAtom, 'session-1')).toThrow('unexpected storage failure')
})

test('receives current session changes from another window', () => {
  const store = createStore()
  const unsubscribe = store.sub(currentSessionIdAtom, () => {})
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: '_currentSessionIdCachedAtom',
      newValue: JSON.stringify('session-2'),
      storageArea: localStorage,
    })
  )
  expect(store.get(currentSessionIdAtom)).toBe('session-2')
  unsubscribe()
})
