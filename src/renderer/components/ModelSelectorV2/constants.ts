import type { CSSProperties } from 'react'
import { GLASS_BAR_CLASS, GLASS_SURFACE_CLASS } from '@/lib/glass-surface'

export const SELECTED_CLASS = '!bg-chatbox-background-brand-secondary text-chatbox-tint-primary'
export const HOVER_CLASS = 'hover:bg-chatbox-background-secondary-hover'
export const MODEL_SELECTOR_SURFACE_CLASS = 'bg-chatbox-background-primary'
/** Sticky bars inside the selector: the surface fill, a plain near-opaque fill over a wallpaper. */
export const MODEL_SELECTOR_STICKY_BAR_CLASS = `${MODEL_SELECTOR_SURFACE_CLASS} ${GLASS_BAR_CLASS}`

/**
 * Fill of the selector panel and the model detail card. On desktop they float on their own, so each is
 * one glass surface over a wallpaper. On mobile they sit in a bottom drawer, which is the surface.
 */
export function getModelSelectorFloatingSurfaceClass(mobile: boolean): string {
  return mobile ? '' : `${MODEL_SELECTOR_SURFACE_CLASS} ${GLASS_SURFACE_CLASS}`
}
export const FALLBACK_UPGRADE_URL = 'https://chatboxai.app/#pricing'
export const DESKTOP_DETAIL_CARD_WIDTH = 320
export const DESKTOP_DETAIL_CARD_MARGIN = 4
export const DESKTOP_DETAIL_CARD_OUTER_WIDTH = DESKTOP_DETAIL_CARD_WIDTH + DESKTOP_DETAIL_CARD_MARGIN * 2
export const DESKTOP_DETAIL_CARD_GAP = 12
export const DESKTOP_DETAIL_VIEWPORT_MARGIN = 12
export const EMPTY_MODEL_IDS: string[] = []

export const CARD_SURFACE_STYLE: CSSProperties = {
  borderColor: 'color-mix(in srgb, var(--chatbox-border-secondary), transparent 18%)',
  boxShadow: '0 14px 36px rgb(0 0 0 / 0.14)',
}

/** Border of the mobile drawers; their fill is MODEL_SELECTOR_SURFACE_CLASS on the drawer content. */
export const DRAWER_SURFACE_STYLE: CSSProperties = {
  borderColor: 'color-mix(in srgb, var(--chatbox-border-secondary), transparent 12%)',
}

export const MOBILE_TAP_RESET_STYLE: CSSProperties = {
  WebkitTapHighlightColor: 'transparent',
}
