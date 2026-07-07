import type { ShortcutSendValue } from '../../../shared/types'

/**
 * Pure decision logic for the composer textarea's keydown handling, extracted
 * from `InputBox.tsx` so it can be characterized in isolation. The component
 * translates the returned action into DOM side effects (preventDefault, submit,
 * history navigation, blur); this module decides *what* a keystroke means and
 * owns none of the effects.
 */

/** The subset of a React keyboard event this logic depends on. */
export interface ComposerKeyEvent {
  key: string
  keyCode: number
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

export interface ComposerKeyContext {
  /** `shortcuts.inputBoxSendMessage` */
  sendShortcut: ShortcutSendValue
  /** `shortcuts.inputBoxSendMessageWithoutResponse` */
  sendWithoutResponseShortcut: ShortcutSendValue
  /** The textarea currently holds focus (`el === document.activeElement`). */
  isInputFocused: boolean
  /** The input is empty or its entire contents are selected. */
  isEmptyOrFullySelected: boolean
}

export type ComposerKeyAction =
  | { type: 'none' }
  | { type: 'send' }
  | { type: 'send-without-response' }
  | { type: 'history-prev' }
  | { type: 'history-next' }
  | { type: 'blur' }

/**
 * Whether the given keystroke matches a configured send shortcut. Mirrors the
 * original `isPressedHash` map: every shortcut requires the Enter key
 * (`keyCode === 13`) plus the exact modifier combination.
 */
export function matchSendShortcut(shortcut: ShortcutSendValue, event: ComposerKeyEvent): boolean {
  const isEnter = event.keyCode === 13
  switch (shortcut) {
    case '':
      return false
    case 'Enter':
      return isEnter && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
    case 'CommandOrControl+Enter':
      return isEnter && (event.ctrlKey || event.metaKey) && !event.shiftKey
    case 'Ctrl+Enter':
      return isEnter && event.ctrlKey && !event.shiftKey
    case 'Command+Enter':
      return isEnter && event.metaKey
    case 'Shift+Enter':
      return isEnter && event.shiftKey
    case 'Ctrl+Shift+Enter':
      return isEnter && event.ctrlKey && event.shiftKey
    default:
      return false
  }
}

/**
 * Resolve a keystroke to a composer action. Precedence matches the original
 * handler: send → send-without-response → history nav → Escape → none.
 */
export function resolveComposerKeyAction(event: ComposerKeyEvent, ctx: ComposerKeyContext): ComposerKeyAction {
  if (matchSendShortcut(ctx.sendShortcut, event)) {
    return { type: 'send' }
  }

  if (matchSendShortcut(ctx.sendWithoutResponseShortcut, event)) {
    return { type: 'send-without-response' }
  }

  if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && ctx.isInputFocused && ctx.isEmptyOrFullySelected) {
    return event.key === 'ArrowUp' ? { type: 'history-prev' } : { type: 'history-next' }
  }

  if (event.key === 'Escape') {
    return { type: 'blur' }
  }

  return { type: 'none' }
}
