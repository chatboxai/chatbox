/**
 * Glass over a chat wallpaper.
 *
 * While a chat wallpaper is shown, the document root carries CHAT_WALLPAPER_ATTRIBUTE (set by the root
 * route). Every rule in globals.css hangs off that marker, so without a wallpaper nothing changes. The
 * marker is global: popovers and menus opened anywhere on a chat route turn to glass, including those
 * over the solid sidebar or inside a desktop modal, where they read as frosted copies of the surface
 * under them.
 *
 * Three tiers, picked by what an element is:
 * - Surface (GLASS_SURFACE_CLASS): something floating over the transcript, such as the composer,
 *   popovers, menus, the side panel and floating buttons. Translucent fill plus backdrop blur. Mantine
 *   Popover, Menu, HoverCard and Combobox (so Select too) dropdowns get it from the theme defaults, and
 *   every vaul bottom drawer (`[data-vaul-drawer]`) is a surface, dialog drawers included. A surface
 *   inside another surface would see only its parent as backdrop, so each stack has one surface.
 * - Fill (GLASS_FILL_CLASS): content in the scrolling transcript, such as bubbles, chips and cards.
 *   Translucent fill without blur, so long conversations scroll without per-frame backdrop sampling.
 * - Tint (GLASS_TINT_CLASS) and bar (GLASS_BAR_CLASS): cards, rows and sticky bars inside a surface
 *   or fill. A tint takes the light gray of in-message file cards; a sticky bar stays near-opaque so
 *   rows scrolling under it stay hidden.
 *
 * To give a new component glass, add the class for its tier next to its usual `bg-*` class and keep the
 * fill out of inline styles: inline backgrounds win over every stylesheet rule. A Mantine dropdown that
 * draws its own surfaces inside adds GLASS_HOST_CLASS.
 *
 * Fill opacity and blur come from `--chatbox-glass-opacity` and `--chatbox-glass-blur` on the root, and
 * sticky bars derive their opacity from the first. A user opacity setting only has to write
 * `document.documentElement.style.setProperty('--chatbox-glass-opacity', '70%')`. With reduced
 * transparency requested, the stylesheet makes glass near-opaque and drops the blur.
 */
export const CHAT_WALLPAPER_ATTRIBUTE = 'data-chat-wallpaper'

/** Floating surface: translucent fill and backdrop blur over a chat wallpaper. */
export const GLASS_SURFACE_CLASS = 'chatbox-glass-surface'

/** In-flow transcript content: translucent fill without blur over a chat wallpaper. */
export const GLASS_FILL_CLASS = 'chatbox-glass-fill'

/** Card, row or bar inside a surface or fill: the light gray tint of in-message file cards. */
export const GLASS_TINT_CLASS = 'chatbox-glass-tint'

/** Sticky bar inside a surface or fill: a near-opaque fill without its own blur. */
export const GLASS_BAR_CLASS = 'chatbox-glass-bar'

/**
 * Mantine dropdown that draws its own surfaces inside: it stays clear itself and drops the `will-change`
 * of its open transition, which would otherwise make it the backdrop root of the surfaces inside and
 * leave them blurring the empty dropdown instead of the page.
 */
export const GLASS_HOST_CLASS = 'chatbox-glass-host'

/** Decoration painted in the page color, such as edge fades, that is hidden over a chat wallpaper. */
export const GLASS_HIDDEN_CLASS = 'chatbox-glass-hidden'

/** Theme default `classNames` for Mantine dropdowns. */
export const GLASS_DROPDOWN_CLASS_NAMES = { dropdown: GLASS_SURFACE_CLASS }

export function setChatWallpaperMarker(root: HTMLElement, active: boolean): void {
  if (active) {
    root.setAttribute(CHAT_WALLPAPER_ATTRIBUTE, '')
  } else {
    root.removeAttribute(CHAT_WALLPAPER_ATTRIBUTE)
  }
}
