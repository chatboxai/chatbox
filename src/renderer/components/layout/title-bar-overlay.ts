import { useLayoutEffect } from 'react'

/**
 * Height of the small-screen chat header overlay (status-bar inset plus the title row), defined in
 * `globals.css`. The message list reserves it at its top and lands explicit scroll targets below it.
 */
export const TITLE_BAR_OVERLAY_HEIGHT = 'var(--chatbox-title-bar-overlay-height)'

/** Root attribute that lets the app content run up under the status bar while an overlay header is mounted. */
export const TITLE_BAR_OVERLAY_ROOT_ATTRIBUTE = 'data-chat-header-overlay'

/** Resolves the overlay height in CSS pixels for the current safe area. */
export function measureTitleBarOverlayInset(): number {
  const probe = document.createElement('div')
  probe.style.cssText = `position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:${TITLE_BAR_OVERLAY_HEIGHT}`
  document.body.appendChild(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()
  return height
}

let mountedOverlays = 0

/** Marks the document root while at least one overlay header is mounted. */
export function useTitleBarOverlayRoot(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return
    mountedOverlays++
    document.documentElement.setAttribute(TITLE_BAR_OVERLAY_ROOT_ATTRIBUTE, '')
    return () => {
      mountedOverlays--
      if (!mountedOverlays) document.documentElement.removeAttribute(TITLE_BAR_OVERLAY_ROOT_ATTRIBUTE)
    }
  }, [active])
}
