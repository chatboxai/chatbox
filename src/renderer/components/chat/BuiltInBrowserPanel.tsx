import { Loader, Text, TextInput } from '@mantine/core'
import { type BuiltInBrowserState, EMPTY_BUILT_IN_BROWSER_STATE } from '@shared/built-in-browser'
import { IconArrowLeft, IconArrowRight, IconDots, IconRefresh, IconTrash, IconWorld, IconX } from '@tabler/icons-react'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionMenu } from '@/components/ActionMenu'
import { ICON_SIZE, IconButton } from '@/components/common/IconButton'
import type { BuiltInBrowser } from '@/platform/interfaces'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'

function useBuiltInBrowserState(builtInBrowser: BuiltInBrowser): BuiltInBrowserState {
  const [state, setState] = useState<BuiltInBrowserState>(EMPTY_BUILT_IN_BROWSER_STATE)
  useEffect(() => {
    let active = true
    const unsubscribe = builtInBrowser.onStateChange((next) => setState(next))
    void builtInBrowser.getState().then((initial) => {
      if (active) setState(initial)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [builtInBrowser])
  return state
}

const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'
// Modal dialogs dim the whole window, so the page steps aside for them wherever they sit.
const MODAL_SELECTOR =
  '[role="dialog"][aria-modal="true"], [role="dialog"][data-state]:not([data-radix-popper-content-wrapper] *)'

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

function hasOverlayOver(page: HTMLElement | null): boolean {
  if (!page) return false
  const pageRect = page.getBoundingClientRect()
  // Some overlays stay mounted while closed, hidden with `display` or `visibility`. Opacity is
  // ignored: overlays mount transparent and fade in without a DOM mutation to re-check on.
  return Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some(
    (element) =>
      element.checkVisibility({ visibilityProperty: true }) &&
      (element.matches(MODAL_SELECTOR) || intersects(element.getBoundingClientRect(), pageRect))
  )
}

/**
 * The page view is drawn above the app, so it would cover app menus and dialogs. Reports
 * whether one covers the page so the view can step aside. Portaled overlays mount under <body>.
 */
function useOverlayOver(pageRef: RefObject<HTMLElement | null>): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      setOpen(hasOverlayOver(pageRef.current))
    }
    // Checked at most once per frame; streaming replies mutate the DOM often.
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(update)
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden'],
    })
    update()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [pageRef])
  return open
}

function reportError(error: unknown) {
  toastActions.add(error instanceof Error ? error.message : String(error))
}

/**
 * Right sidebar showing the built-in browser. The page itself is a native view that the main
 * process draws over the placeholder below the toolbar, so the user can take the page over.
 * Opens on its own when the model starts reading a page.
 */
export function BuiltInBrowserSidebar({ builtInBrowser }: { builtInBrowser: BuiltInBrowser }) {
  const state = useBuiltInBrowserState(builtInBrowser)
  const open = useUIStore((s) => s.showBuiltInBrowser)
  const setOpen = useUIStore((s) => s.setShowBuiltInBrowser)

  useEffect(() => {
    if (state.reading) setOpen(true)
  }, [state.reading, setOpen])

  if (!open) return null
  return <BuiltInBrowserPanel builtInBrowser={builtInBrowser} state={state} onClose={() => setOpen(false)} />
}

function BuiltInBrowserPanel({
  builtInBrowser,
  state,
  onClose,
}: {
  builtInBrowser: BuiltInBrowser
  state: BuiltInBrowserState
  onClose: () => void
}) {
  const { t } = useTranslation()
  const pageRef = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState(state.url)
  const [editingAddress, setEditingAddress] = useState(false)
  const hasPage = Boolean(state.url)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const overlayOpen = useOverlayOver(pageRef)
  const showPage = hasPage && !overlayOpen

  useEffect(() => {
    if (!editingAddress) setAddress(state.url)
  }, [state.url, editingAddress])

  // Keep the native page view over the placeholder while the panel is on screen. While an
  // overlay covers it, the placeholder shows a still of the page instead.
  useLayoutEffect(() => {
    const element = pageRef.current
    if (!element || !showPage) {
      let active = true
      builtInBrowser
        .setView({ visible: false, snapshot: hasPage })
        .then((image) => {
          if (active) setSnapshot(image)
        })
        .catch(() => undefined)
      return () => {
        active = false
      }
    }
    setSnapshot(null)
    const place = () => {
      const rect = element.getBoundingClientRect()
      void builtInBrowser.setView({
        visible: true,
        bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    observer.observe(document.body)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [builtInBrowser, showPage, hasPage])

  useEffect(() => () => void builtInBrowser.setView({ visible: false }), [builtInBrowser])

  const submitAddress = () => {
    const url = address.trim()
    if (!url) return
    setEditingAddress(false)
    builtInBrowser.navigate(url).catch(reportError)
  }

  const clearData = () => {
    builtInBrowser
      .clearData()
      .then(() => toastActions.add(t('Built-in browser data cleared')))
      .catch(reportError)
  }

  return (
    <aside
      data-testid="built-in-browser-panel"
      className="flex h-full w-[min(560px,45%)] min-w-[320px] shrink-0 flex-col border-0 border-l border-solid border-chatbox-border-primary"
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <IconButton
          icon={IconArrowLeft}
          iconSize={ICON_SIZE.inline}
          aria-label={t('Back')}
          disabled={!state.canGoBack}
          onClick={() => builtInBrowser.goBack().catch(reportError)}
        />
        <IconButton
          icon={IconArrowRight}
          iconSize={ICON_SIZE.inline}
          aria-label={t('Forward')}
          disabled={!state.canGoForward}
          onClick={() => builtInBrowser.goForward().catch(reportError)}
        />
        {state.loading ? (
          <IconButton
            icon={IconX}
            iconSize={ICON_SIZE.inline}
            aria-label={t('Stop')}
            onClick={() => builtInBrowser.stop().catch(reportError)}
          />
        ) : (
          <IconButton
            icon={IconRefresh}
            iconSize={ICON_SIZE.inline}
            aria-label={t('Reload')}
            disabled={!hasPage}
            onClick={() => builtInBrowser.reload().catch(reportError)}
          />
        )}
        <TextInput
          data-testid="built-in-browser-address"
          className="min-w-0 flex-1"
          size="xs"
          radius="md"
          placeholder={t('Enter a URL') as string}
          value={address}
          onFocus={(event) => {
            setEditingAddress(true)
            event.currentTarget.select()
          }}
          onBlur={() => setEditingAddress(false)}
          onChange={(event) => setAddress(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitAddress()
            if (event.key === 'Escape') event.currentTarget.blur()
          }}
        />
        <ActionMenu
          position="bottom-end"
          items={[
            {
              text: t('Clear built-in browser data'),
              icon: IconTrash,
              onClick: clearData,
            },
          ]}
        >
          <IconButton icon={IconDots} iconSize={ICON_SIZE.inline} aria-label={t('More')} />
        </ActionMenu>
        <IconButton icon={IconX} iconSize={ICON_SIZE.inline} aria-label={t('Close')} onClick={onClose} />
      </div>
      {state.reading && (
        <div
          data-testid="built-in-browser-reading"
          className="flex items-center gap-2 px-3 pb-1.5 text-chatbox-tint-secondary"
        >
          <Loader size={12} />
          <Text size="xs" c="chatbox-secondary">
            {t('AI is reading this page')}
          </Text>
        </div>
      )}
      <div ref={pageRef} className="relative min-h-0 flex-1 bg-chatbox-background-secondary">
        {hasPage && !showPage && snapshot && (
          <img
            src={snapshot}
            alt=""
            className="pointer-events-none absolute inset-0 size-full object-cover object-left-top"
          />
        )}
        {!hasPage && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <IconWorld size={28} className="text-chatbox-tint-tertiary" />
            <Text size="sm" c="chatbox-secondary">
              {t(
                'Pages the AI reads open here. You can sign in or click through a page yourself, then ask the AI to continue.'
              )}
            </Text>
            <Text size="xs" c="chatbox-tertiary">
              {t('Sign-ins stay in the built-in browser and are never sent to the model.')}
            </Text>
          </div>
        )}
      </div>
    </aside>
  )
}
