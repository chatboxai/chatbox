import { getDefaultStore } from 'jotai'
import { useEffect } from 'react'
import { navigateToSettings } from '@/modals/settings-navigation'
import { router } from '@/router'
import { uiStore } from '@/stores/uiStore'
import { getOS } from '../packages/navigator'
import platform from '../platform'
import { currentSessionIdAtom } from '../stores/atoms'
import { switchToIndex, switchToNext } from '../stores/session/crud'
import { startNewThread } from '../stores/session/threads'
import { settingsStore } from '../stores/settingsStore'
import * as dom from './dom'
import { useIsSmallScreen } from './useScreenChange'

function isShortcutPressed(e: KeyboardEvent, shortcut: string) {
  if (!shortcut) {
    return false
  }

  const keys = shortcut.toLowerCase().split('+')
  const key = keys[keys.length - 1]
  const isMac = getOS() === 'Mac'
  const expectsMod = keys.includes('mod')
  const expectsCtrl = keys.includes('ctrl') || keys.includes('control') || (expectsMod && !isMac)
  const expectsMeta = keys.includes('meta') || keys.includes('command') || (expectsMod && isMac)
  const expectsAlt = keys.includes('alt') || keys.includes('option')
  const expectsShift = keys.includes('shift')

  return (
    e.key.toLowerCase() === key &&
    e.ctrlKey === expectsCtrl &&
    e.metaKey === expectsMeta &&
    e.altKey === expectsAlt &&
    e.shiftKey === expectsShift
  )
}

function getRouteSessionId() {
  const sessionRouteMatch = router.state.location.pathname.match(/^\/session\/([^/]+)/)
  return sessionRouteMatch?.[1] ? decodeURIComponent(sessionRouteMatch[1]) : null
}

export default function useShortcut() {
  const isSmallScreen = useIsSmallScreen()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keyboardShortcut(e)
    }
    const focusMessageInput = () => {
      // 大屏幕下，窗口显示时自动聚焦输入框
      if (!isSmallScreen) {
        dom.focusMessageInput()
      }
    }
    const cancelOnFocus = platform.type === 'desktop' ? platform.onWindowFocused(focusMessageInput) : () => {}
    const cancelOnShow = platform.onWindowShow(focusMessageInput)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelOnFocus()
      cancelOnShow()
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSmallScreen])

  function keyboardShortcut(e: KeyboardEvent) {
    // 这里不用 e.key 是因为 alt、 option、shift 都会改变 e.key 的值
    const shift = e.shiftKey
    const shortcuts = settingsStore.getState().shortcuts

    const ctrlKey = getOS() === 'Mac' ? e.metaKey : e.ctrlKey

    if (e.key === 'i' && ctrlKey) {
      dom.focusMessageInput()
      return
    }
    if (e.key === 'e' && ctrlKey) {
      dom.focusMessageInput()
      // Toggle session-level web browsing mode using cached display value
      const sessionId = getDefaultStore().get(currentSessionIdAtom) || 'new'
      uiStore.getState().toggleSessionWebBrowsing(sessionId)
      return
    }

    // 创建新会话 CmdOrCtrl + N
    if (e.key === 'n' && ctrlKey && !shift) {
      router.navigate({
        to: '/',
      })
      return
    }
    // 创建新话题 CmdOrCtrl + Shift + N
    if (isShortcutPressed(e, shortcuts.messageListRefreshContext)) {
      e.preventDefault()
      const sid = getRouteSessionId()
      if (sid) {
        void startNewThread(sid)
      }
      return
    }
    // 创建新图片会话
    if (isShortcutPressed(e, shortcuts.newPictureChat)) {
      e.preventDefault()
      router.navigate({
        to: '/image-creator',
      })
      return
    }
    if (e.code === 'Tab' && ctrlKey && !shift) {
      switchToNext()
    }
    if (e.code === 'Tab' && ctrlKey && shift) {
      switchToNext(true)
    }
    for (let i = 1; i <= 9; i++) {
      if (e.code === `Digit${i}` && ctrlKey) {
        switchToIndex(i - 1)
      }
    }

    if (e.key === 'k' && ctrlKey) {
      const openSearchDialog = uiStore.getState().openSearchDialog
      if (openSearchDialog) {
        uiStore.setState({ openSearchDialog: false })
      } else {
        uiStore.setState({ openSearchDialog: true })
      }
    }
    if (e.key === ',' && ctrlKey) {
      e.preventDefault()
      navigateToSettings()
      return
    }
  }
}
