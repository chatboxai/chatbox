import type { CSSProperties } from 'react'
import { GLASS_SURFACE_CLASS, GLASS_TINT_CLASS } from '@/lib/glass-surface'

// The input box surface, shared with PendingActionBar so a pause can take over
// the same slot without the frame or the height shifting. The composer sits on the
// primary background with a border so it reads apart from the gray sent-message bubbles.
export const INPUT_SURFACE_CLASS_NAME = `chatbox-composer-surface ${GLASS_SURFACE_CLASS} relative flex flex-col justify-between gap-xs rounded-lg bg-chatbox-background-primary px-3 py-2 shadow-sm`

/** Desktop only: keeps the swap between input and pause from jumping. */
export const INPUT_SURFACE_MIN_HEIGHT_CLASS_NAME = 'min-h-[92px]'

export const INPUT_SURFACE_STYLE = { border: '1px solid var(--chatbox-border-primary)' }

export const INPUT_PAYLOAD_MAX_HEIGHT = 'min(200px, 30vh)'

/** Send button while submitting is blocked: keeps the button shape visible without the brand fill. */
export const SEND_BUTTON_BLOCKED_CLASS =
  'disabled:!opacity-100 !bg-chatbox-background-tertiary !text-chatbox-tint-white'

/** The slash skill list, portaled above the composer. */
export const SKILL_MENU_SURFACE_CLASS_NAME = `z-[400] overflow-y-auto rounded-lg border border-solid border-chatbox-border-primary bg-chatbox-background-primary py-1 shadow-lg ${GLASS_SURFACE_CLASS}`

/** Warning notice inside the composer. Its fill stays a class so the composer glass can tint it. */
export const COMPOSER_NOTICE_CLASS_NAME = `w-full rounded-lg px-2.5 py-2 mb-1 bg-chatbox-background-primary ${GLASS_TINT_CLASS}`

export const COMPOSER_NOTICE_STYLE: CSSProperties = {
  border: '1px solid var(--chatbox-border-primary)',
  borderLeft: '3px solid var(--chatbox-tint-warning)',
}
