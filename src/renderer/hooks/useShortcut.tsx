import { getDefaultStore } from 'jotai'
import { useEffect } from 'react'
import { commandPalette } from '@/components/commandPaletteStore'
import { navigateToSettings } from '@/modals/Settings'
import { router } from '@/router'
import { uiStore } from '@/stores/uiStore'
import { getOS } from '../packages/navigator'
import platform from '../platform'
import { currentSessionIdAtom } from '../stores/atoms'
import { switchToIndex, switchToNext } from '../stores/sessionActions'
import * as dom from './dom'
import { useIsSmallScreen } from './useScreenChange'

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
    const cancelOnFocus = platform.onWindowFocused(focusMessageInput)
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
    // 创建新图片会话 CmdOrCtrl + Shift + N
    if (e.key === 'n' && ctrlKey && shift) {
      router.navigate({
        to: '/image-creator',
      })
      return
    }
    if (e.code === 'Tab' && ctrlKey && !shift) {
      void switchToNext()
    }
    if (e.code === 'Tab' && ctrlKey && shift) {
      void switchToNext(true)
    }
    for (let i = 1; i <= 9; i++) {
      if (e.code === `Digit${i}` && ctrlKey) {
        void switchToIndex(i - 1)
      }
    }

    // 全局命令面板 CmdOrCtrl + K；搜索改为 CmdOrCtrl + Shift + F
    if (e.key === 'k' && ctrlKey) {
      e.preventDefault()
      commandPalette.toggle()
      return
    }
    if ((e.key === 'f' || e.key === 'F') && ctrlKey && shift) {
      e.preventDefault()
      const openSearchDialog = uiStore.getState().openSearchDialog
      uiStore.setState({ openSearchDialog: !openSearchDialog })
      return
    }
    if (e.key === ',' && ctrlKey) {
      e.preventDefault()
      navigateToSettings()
      return
    }
  }
}
