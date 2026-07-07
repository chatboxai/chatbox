import { describe, expect, it } from 'vitest'
import {
  type ComposerKeyContext,
  type ComposerKeyEvent,
  matchSendShortcut,
  resolveComposerKeyAction,
} from './composerKeyboard'

// Builds a keyboard event with sensible defaults; override per case.
function keyEvent(overrides: Partial<ComposerKeyEvent> = {}): ComposerKeyEvent {
  return {
    key: 'Enter',
    keyCode: 13,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  }
}

function ctx(overrides: Partial<ComposerKeyContext> = {}): ComposerKeyContext {
  return {
    sendShortcut: 'Enter',
    sendWithoutResponseShortcut: 'Ctrl+Enter',
    isInputFocused: true,
    isEmptyOrFullySelected: true,
    ...overrides,
  }
}

describe('matchSendShortcut', () => {
  it('never matches when the shortcut is disabled ("")', () => {
    expect(matchSendShortcut('', keyEvent())).toBe(false)
    expect(matchSendShortcut('', keyEvent({ ctrlKey: true }))).toBe(false)
  })

  it('never matches a non-Enter keycode', () => {
    expect(matchSendShortcut('Enter', keyEvent({ keyCode: 65 }))).toBe(false)
    expect(matchSendShortcut('Ctrl+Enter', keyEvent({ keyCode: 65, ctrlKey: true }))).toBe(false)
  })

  it('matches bare Enter only with no modifiers', () => {
    expect(matchSendShortcut('Enter', keyEvent())).toBe(true)
    expect(matchSendShortcut('Enter', keyEvent({ shiftKey: true }))).toBe(false)
    expect(matchSendShortcut('Enter', keyEvent({ ctrlKey: true }))).toBe(false)
    expect(matchSendShortcut('Enter', keyEvent({ altKey: true }))).toBe(false)
    expect(matchSendShortcut('Enter', keyEvent({ metaKey: true }))).toBe(false)
  })

  it('matches CommandOrControl+Enter for either Ctrl or Meta but not with Shift', () => {
    expect(matchSendShortcut('CommandOrControl+Enter', keyEvent({ ctrlKey: true }))).toBe(true)
    expect(matchSendShortcut('CommandOrControl+Enter', keyEvent({ metaKey: true }))).toBe(true)
    expect(matchSendShortcut('CommandOrControl+Enter', keyEvent())).toBe(false)
    expect(matchSendShortcut('CommandOrControl+Enter', keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('matches Ctrl+Enter only without Shift', () => {
    expect(matchSendShortcut('Ctrl+Enter', keyEvent({ ctrlKey: true }))).toBe(true)
    expect(matchSendShortcut('Ctrl+Enter', keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matchSendShortcut('Ctrl+Enter', keyEvent())).toBe(false)
  })

  it('matches Command+Enter whenever Meta is held', () => {
    expect(matchSendShortcut('Command+Enter', keyEvent({ metaKey: true }))).toBe(true)
    // Command+Enter intentionally ignores other modifiers (mirrors the original map)
    expect(matchSendShortcut('Command+Enter', keyEvent({ metaKey: true, shiftKey: true }))).toBe(true)
    expect(matchSendShortcut('Command+Enter', keyEvent())).toBe(false)
  })

  it('matches Shift+Enter and Ctrl+Shift+Enter', () => {
    expect(matchSendShortcut('Shift+Enter', keyEvent({ shiftKey: true }))).toBe(true)
    expect(matchSendShortcut('Shift+Enter', keyEvent())).toBe(false)
    expect(matchSendShortcut('Ctrl+Shift+Enter', keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(matchSendShortcut('Ctrl+Shift+Enter', keyEvent({ ctrlKey: true }))).toBe(false)
  })
})

describe('resolveComposerKeyAction', () => {
  it('returns send when the send shortcut matches', () => {
    expect(resolveComposerKeyAction(keyEvent(), ctx())).toEqual({ type: 'send' })
  })

  it('returns send-without-response for that shortcut', () => {
    const action = resolveComposerKeyAction(
      keyEvent({ ctrlKey: true }),
      // send is bare Enter, without-response is Ctrl+Enter
      ctx()
    )
    expect(action).toEqual({ type: 'send-without-response' })
  })

  it('prioritizes send over send-without-response when both could match', () => {
    // Both shortcuts set to bare Enter → send wins (checked first)
    const action = resolveComposerKeyAction(keyEvent(), ctx({ sendWithoutResponseShortcut: 'Enter' }))
    expect(action).toEqual({ type: 'send' })
  })

  it('navigates history up/down only when focused and empty/fully-selected', () => {
    expect(resolveComposerKeyAction(keyEvent({ key: 'ArrowUp', keyCode: 38 }), ctx())).toEqual({
      type: 'history-prev',
    })
    expect(resolveComposerKeyAction(keyEvent({ key: 'ArrowDown', keyCode: 40 }), ctx())).toEqual({
      type: 'history-next',
    })
  })

  it('does not navigate history when the input is not focused', () => {
    expect(resolveComposerKeyAction(keyEvent({ key: 'ArrowUp', keyCode: 38 }), ctx({ isInputFocused: false }))).toEqual(
      { type: 'none' }
    )
  })

  it('does not navigate history when there is a partial selection', () => {
    expect(
      resolveComposerKeyAction(keyEvent({ key: 'ArrowDown', keyCode: 40 }), ctx({ isEmptyOrFullySelected: false }))
    ).toEqual({ type: 'none' })
  })

  it('returns blur on Escape regardless of focus state', () => {
    expect(resolveComposerKeyAction(keyEvent({ key: 'Escape', keyCode: 27 }), ctx())).toEqual({ type: 'blur' })
    expect(resolveComposerKeyAction(keyEvent({ key: 'Escape', keyCode: 27 }), ctx({ isInputFocused: false }))).toEqual({
      type: 'blur',
    })
  })

  it('returns none for an unrelated key', () => {
    expect(resolveComposerKeyAction(keyEvent({ key: 'a', keyCode: 65 }), ctx())).toEqual({ type: 'none' })
  })

  it('returns none for Enter when the send shortcut is disabled', () => {
    expect(resolveComposerKeyAction(keyEvent(), ctx({ sendShortcut: '', sendWithoutResponseShortcut: '' }))).toEqual({
      type: 'none',
    })
  })
})
