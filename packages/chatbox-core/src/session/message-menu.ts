import type { Message } from '../types'

/**
 * Entries of the long-press message menu shared by small-screen Web/Capacitor and the React Native app. Every
 * platform renders the same entries in the same order; `divider` separates the secondary group (report, delete).
 */
export type MessageMenuEntryId =
  | 'stop'
  | 'retry'
  | 'reply-below'
  | 'edit'
  | 'copy'
  | 'generate-more-images'
  | 'select-text'
  | 'quote'
  | 'divider'
  | 'report'
  | 'view-json'
  | 'delete'

export interface MessageMenuAvailability {
  /** The reply can be stopped from the menu (a streaming assistant reply). */
  stop: boolean
  retry: boolean
  replyBelow: boolean
  edit: boolean
  copy: boolean
  /** Image sessions offer "Generate More Images Below" on assistant messages instead of edit/copy/select text. */
  generateMoreImages: boolean
  selectText: boolean
  quote: boolean
  report: boolean
  viewJson: boolean
  delete: boolean
}

export type MessageMenuMessage = Pick<Message, 'role' | 'generating' | 'model' | 'error' | 'errorCode'>

export interface MessageMenuContext {
  /** Image-generation sessions replace text actions on assistant replies. */
  pictureSession?: boolean
}

function hasError(message: MessageMenuMessage): boolean {
  return Boolean(message.error || message.errorCode)
}

/**
 * Ordered entries for one message. Availability flags carry the caller's mode/permission rules (work mode, read-only
 * handlers, dev-only JSON); this function applies the per-state rules every platform shares:
 * - generating: stop / copy / select text / quote ── delete
 * - assistant: reply again / edit / copy / select text / quote ── report / delete
 * - user: reply again below / edit / copy / select text / quote ── delete
 * - failed assistant reply: reply again / copy / select text / quote ── report / delete
 * - image session assistant reply: reply again / generate more images below / quote ── report / delete
 */
export function getMessageMenuEntries(
  message: MessageMenuMessage,
  availability: MessageMenuAvailability,
  context: MessageMenuContext = {}
): MessageMenuEntryId[] {
  const isAssistant = message.role === 'assistant'
  const generating = Boolean(message.generating)
  const imageReply = isAssistant && Boolean(context.pictureSession)
  const primary: MessageMenuEntryId[] = []
  const secondary: MessageMenuEntryId[] = []

  if (generating) {
    if (isAssistant && availability.stop) primary.push('stop')
  } else if (isAssistant) {
    if (availability.retry) primary.push('retry')
  } else if (availability.replyBelow) {
    primary.push('reply-below')
  }

  if (imageReply) {
    if (!generating && availability.generateMoreImages) primary.push('generate-more-images')
  } else {
    const canEdit =
      availability.edit &&
      !generating &&
      !(isAssistant && hasError(message)) &&
      !message.model?.startsWith('Chatbox-AI')
    if (canEdit) primary.push('edit')
    if (availability.copy) primary.push('copy')
    if (availability.selectText) primary.push('select-text')
  }
  if (availability.quote) primary.push('quote')

  if (isAssistant && !generating && availability.report) secondary.push('report')
  if (availability.viewJson) secondary.push('view-json')
  if (availability.delete) secondary.push('delete')

  if (primary.length && secondary.length) return [...primary, 'divider', ...secondary]
  return [...primary, ...secondary]
}

export const MESSAGE_MENU_TITLE_PREVIEW_LENGTH = 20

/** One-line preview of a message for the menu title, clipped to `maxLength` characters with an ellipsis. */
export function clipMessageMenuPreview(text: string, maxLength = MESSAGE_MENU_TITLE_PREVIEW_LENGTH): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}…` : chars.join('')
}

/**
 * Splits a menu title around the first occurrence of `emphasis` (the author name), so it can be drawn in bold
 * wherever the translation places it. Returns undefined when the title does not contain it.
 */
export function splitMessageMenuTitle(
  title: string,
  emphasis: string | undefined
): { before: string; emphasis: string; after: string } | undefined {
  if (!emphasis) return undefined
  const index = title.indexOf(emphasis)
  if (index < 0) return undefined
  return { before: title.slice(0, index), emphasis, after: title.slice(index + emphasis.length) }
}
