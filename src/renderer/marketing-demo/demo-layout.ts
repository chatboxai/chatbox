import { useEffect, useState } from 'react'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import type { DemoLayout } from '@/marketing-demo/protocol'
import { uiStore } from '@/stores/uiStore'

let forcedLayout: DemoLayout | null = null
const listeners = new Set<() => void>()

export function setForcedDemoLayout(layout: DemoLayout | null): void {
  forcedLayout = layout
  for (const listener of listeners) listener()
}

export function applyDemoLayout(layout: DemoLayout): void {
  if (layout === 'mobile') {
    uiStore.setState({ showSidebar: false, widthFull: true, sidebarWidth: null })
  } else {
    uiStore.setState({ showSidebar: true, widthFull: false, sidebarWidth: 252 })
  }
  document.documentElement.setAttribute('data-demo-layout', layout)
}

export function useDemoIsMobile(): boolean {
  const isSmallScreen = useIsSmallScreen()
  const [forced, setForced] = useState(forcedLayout)

  useEffect(() => {
    const sync = () => setForced(forcedLayout)
    listeners.add(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [])

  if (forced === 'mobile') return true
  if (forced === 'desktop') return false
  return isSmallScreen || window.innerWidth < 600
}
