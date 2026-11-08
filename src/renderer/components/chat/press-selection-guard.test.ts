// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createPressSelectionGuard,
  PRESS_SELECTION_GUARD_CLASS,
  type PressSelectionGuard,
} from './press-selection-guard'

const created: PressSelectionGuard[] = []
const ownerA = { message: 'a' }
const ownerB = { message: 'b' }

function createGuard(options: Parameters<typeof createPressSelectionGuard>[0] = {}) {
  const guard = createPressSelectionGuard(options)
  created.push(guard)
  return guard
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<p id="text">Some reply</p><textarea id="input">draft</textarea>'
})
afterEach(() => {
  for (const guard of created.splice(0)) {
    guard.release(ownerA)
    guard.release(ownerB)
  }
  expect(document.documentElement.classList.contains(PRESS_SELECTION_GUARD_CLASS)).toBe(false)
  vi.useRealTimers()
  document.getSelection()?.removeAllRanges()
  ;(document.activeElement as HTMLElement | null)?.blur()
})

const text = () => document.getElementById('text') as HTMLElement
const guarded = () => document.documentElement.classList.contains(PRESS_SELECTION_GUARD_CLASS)
const selectText = () => {
  const range = document.createRange()
  range.selectNodeContents(text())
  document.getSelection()?.addRange(range)
}
const selectStart = (target: Element) =>
  target.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }))
const touchEvent = (type: string, touches: Touch[] = []) =>
  document.body.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { touches }))
const touchEnd = (touches: Touch[] = []) => touchEvent('touchend', touches)

/** Expects the guard to be fully off: no class, and `selectstart` is no longer cancelled. */
function expectReleased(guard: PressSelectionGuard) {
  expect(guard.isActive()).toBe(false)
  expect(guarded()).toBe(false)
  expect(selectStart(text())).toBe(true)
}

it('blocks selection page-wide while a press is held and until shortly after the finger lifts', () => {
  const guard = createGuard({ releaseMs: 300 })
  expect(selectStart(text())).toBe(true)

  guard.engage(ownerA)
  expect(guarded()).toBe(true)
  expect(selectStart(text())).toBe(false)

  // The menu opens under the finger and the system has already selected some text.
  selectText()
  guard.clearSelection()
  expect(document.getSelection()?.rangeCount).toBe(0)

  // Another finger lifting does not end the press.
  touchEnd([{} as Touch])
  vi.advanceTimersByTime(1_000)
  expect(guard.isActive()).toBe(true)

  touchEnd()
  selectText()
  vi.advanceTimersByTime(299)
  expect(guard.isActive()).toBe(true)
  expect(selectStart(text())).toBe(false)
  vi.advanceTimersByTime(1)
  // A selection formed in the tail is dropped on release; selection works normally afterwards.
  expect(document.getSelection()?.rangeCount).toBe(0)
  expectReleased(guard)
})

it('a press that turns into a scroll releases right away', () => {
  const guard = createGuard()
  guard.engage(ownerA)
  guard.release(ownerA)
  expectReleased(guard)
})

it('does not release a press owned by another message', () => {
  const guard = createGuard()
  guard.engage(ownerA)
  // Message B unmounts or is disabled while A is pressed.
  guard.release(ownerB)
  expect(guard.isActive()).toBe(true)
  expect(guarded()).toBe(true)
  guard.release(ownerA)
  expectReleased(guard)
})

it('a new press during the release tail keeps the guard, owned by the new press', () => {
  const guard = createGuard({ releaseMs: 300 })
  guard.engage(ownerA)
  touchEnd()
  vi.advanceTimersByTime(200)
  touchEvent('touchstart', [{} as Touch])
  guard.engage(ownerB)
  vi.advanceTimersByTime(500)
  expect(guard.isActive()).toBe(true)
  guard.release(ownerA)
  expect(guard.isActive()).toBe(true)
  guard.release(ownerB)
  expectReleased(guard)
})

it.each([
  ['the window loses focus', () => window.dispatchEvent(new Event('blur'))],
  ['the page is hidden', () => window.dispatchEvent(new Event('pagehide'))],
  [
    'the document becomes hidden',
    () => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      vi.restoreAllMocks()
    },
  ],
])('releases when %s without a terminal touch', (_, deactivate) => {
  const guard = createGuard()
  guard.engage(ownerA)
  selectText()
  deactivate()
  expect(document.getSelection()?.rangeCount).toBe(0)
  expectReleased(guard)
})

it('stays engaged while the document is still visible', () => {
  const guard = createGuard()
  guard.engage(ownerA)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(guard.isActive()).toBe(true)
  guard.release(ownerA)
})

it('recovers when a new gesture starts after the terminal touch was lost', () => {
  const guard = createGuard()
  guard.engage(ownerA)
  // The release never arrives; the next touch elsewhere on the page starts a new gesture.
  touchEvent('touchstart', [{} as Touch])
  expectReleased(guard)
})

it('a second finger joining the press does not release it', () => {
  const guard = createGuard()
  guard.engage(ownerA)
  touchEvent('touchstart', [{} as Touch, {} as Touch])
  expect(guard.isActive()).toBe(true)
  guard.release(ownerA)
})

it('releases at the safety deadline when nothing else ends the press', () => {
  const guard = createGuard({ maxMs: 5_000 })
  guard.engage(ownerA)
  vi.advanceTimersByTime(4_999)
  expect(guard.isActive()).toBe(true)
  vi.advanceTimersByTime(1)
  expectReleased(guard)
})

it('a released guard no longer reacts to page events', () => {
  const guard = createGuard()
  const removeSpy = vi.spyOn(document, 'removeEventListener')
  guard.engage(ownerA)
  guard.release(ownerA)
  const removed = removeSpy.mock.calls.map(([type]) => type)
  expect(removed).toEqual(
    expect.arrayContaining(['selectstart', 'touchstart', 'touchend', 'touchcancel', 'visibilitychange'])
  )
  removeSpy.mockRestore()
  window.dispatchEvent(new Event('blur'))
  expectReleased(guard)
})

it('leaves editable fields alone', () => {
  const guard = createGuard()
  const input = document.getElementById('input') as HTMLTextAreaElement
  guard.engage(ownerA)
  expect(selectStart(input)).toBe(true)
  input.focus()
  selectText()
  guard.clearSelection()
  expect(document.getSelection()?.rangeCount).toBe(1)
  guard.release(ownerA)
})
