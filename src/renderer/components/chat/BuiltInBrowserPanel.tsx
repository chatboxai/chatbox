import { Loader, Text, TextInput } from '@mantine/core'
import type { BuiltInBrowserTab, BuiltInBrowserTabs } from '@shared/built-in-browser'
import {
  IconArrowLeft,
  IconArrowRight,
  IconDots,
  IconExternalLink,
  IconRefresh,
  IconTrash,
  IconWorld,
  IconX,
} from '@tabler/icons-react'
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionMenu } from '@/components/ActionMenu'
import { ICON_SIZE, IconButton } from '@/components/common/IconButton'
import platform from '@/platform'
import type { BuiltInBrowser } from '@/platform/interfaces'
import * as toastActions from '@/stores/toastActions'

/**
 * The conversation's open browser tabs, kept current as pages load and tabs open or close;
 * undefined until the first list arrives.
 */
export function useBuiltInBrowserTabs(builtInBrowser: BuiltInBrowser): BuiltInBrowserTabs | undefined {
  const [tabs, setTabs] = useState<BuiltInBrowserTabs>()
  useEffect(() => {
    let active = true
    let pushed = false
    const unsubscribe = builtInBrowser.onTabsChange((next) => {
      pushed = true
      setTabs(next)
    })
    void builtInBrowser.getTabs().then((initial) => {
      // A push that arrived first is newer than the initial answer.
      if (active && !pushed) setTabs(initial)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [builtInBrowser])
  return tabs
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
 * A web tab of the conversation side panel. The page itself is a native view that the main process
 * draws over the placeholder below the address bar, so the user can take the page over; it is
 * placed only while this tab shows and steps aside for menus and dialogs that cover it.
 */
export function BuiltInBrowserView({
  builtInBrowser,
  tab,
}: {
  builtInBrowser: BuiltInBrowser
  tab: BuiltInBrowserTab
}) {
  const { t } = useTranslation()
  const state = tab
  const page = useMemo(() => builtInBrowser.tab(tab.id), [builtInBrowser, tab.id])
  const pageRef = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState(state.url)
  const [editingAddress, setEditingAddress] = useState(false)
  const [clearingData, setClearingData] = useState(false)
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
      page
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
      void page.setView({
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
  }, [page, showPage, hasPage])

  useEffect(() => () => void page.setView({ visible: false }), [page])

  const submitAddress = () => {
    const url = address.trim()
    if (!url) return
    setEditingAddress(false)
    page.navigate(url).catch(reportError)
  }

  const clearData = async () => {
    if (clearingData) return
    setClearingData(true)
    try {
      await builtInBrowser.clearData()
      setEditingAddress(false)
      setAddress('')
      setSnapshot(null)
      toastActions.add(t('All browser pages and website data cleared'))
    } catch (error) {
      reportError(error)
    } finally {
      setClearingData(false)
    }
  }

  return (
    <div data-testid="built-in-browser-panel" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <IconButton
          icon={IconArrowLeft}
          iconSize={ICON_SIZE.inline}
          aria-label={t('Back')}
          disabled={!state.canGoBack}
          onClick={() => page.goBack().catch(reportError)}
        />
        <IconButton
          icon={IconArrowRight}
          iconSize={ICON_SIZE.inline}
          aria-label={t('Forward')}
          disabled={!state.canGoForward}
          onClick={() => page.goForward().catch(reportError)}
        />
        {state.loading ? (
          <IconButton
            icon={IconX}
            iconSize={ICON_SIZE.inline}
            aria-label={t('Stop')}
            onClick={() => page.stop().catch(reportError)}
          />
        ) : (
          <IconButton
            icon={IconRefresh}
            iconSize={ICON_SIZE.inline}
            aria-label={t('Reload')}
            disabled={!hasPage}
            onClick={() => page.reload().catch(reportError)}
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
              text: t('Open in external browser'),
              icon: IconExternalLink,
              disabled: !hasPage,
              onClick: () => void platform.openLink(state.url).catch(reportError),
            },
            {
              text: t('Clear all pages and website data'),
              icon: IconTrash,
              disabled: clearingData,
              doubleCheck: { text: t('Clear all pages and sign out of websites?') as string },
              onClick: () => void clearData(),
            },
          ]}
        >
          <IconButton icon={IconDots} iconSize={ICON_SIZE.inline} aria-label={t('More')} disabled={clearingData} />
        </ActionMenu>
      </div>
      {clearingData && (
        <div role="status" className="flex items-center gap-2 px-3 py-2">
          <Loader size="xs" />
          <Text size="xs">{t('Clearing browser data…')}</Text>
        </div>
      )}
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
    </div>
  )
}
