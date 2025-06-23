import { useNavigate } from '@tanstack/react-router'
import { getDefaultStore } from 'jotai'
import { useEffect } from 'react'
import platform from '../platform'
import * as atoms from '../stores/atoms'
import * as sessionActions from '../stores/sessionActions'
import * as dom from './dom'
import { useIsSmallScreen } from './useScreenChange'
import { getOS } from '../packages/navigator'
import { router } from '@/router'

type NavigationCallback = (path: string) => void

export default function useShortcut() {
  const isSmallScreen = useIsSmallScreen()
  const navigate = useNavigate()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keyboardShortcut(e, (path) => navigate({ to: path }))
    }
    const cancel = platform.onWindowShow(() => {
      // 大屏幕下，窗口显示时自动聚焦输入框
      if (!isSmallScreen) {
        dom.focusMessageInput()
      }
    })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancel()
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSmallScreen, navigate])
}

function keyboardShortcut(e: KeyboardEvent, navigate?: NavigationCallback) {
  // 这里不用 e.key 是因为 alt、 option、shift 都会改变 e.key 的值
  const ctrlOrCmd = e.ctrlKey || e.metaKey
  const shift = e.shiftKey
  const altOrOption = e.altKey

  const ctrlKey = getOS() === 'Mac' ? e.metaKey : e.ctrlKey

  if (e.key === 'i' && ctrlKey) {
    dom.focusMessageInput()
    return
  }
  if (e.key === 'e' && ctrlKey) {
    dom.focusMessageInput()
    const store = getDefaultStore()
    store.set(atoms.inputBoxWebBrowsingModeAtom, (v) => !v)
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
    sessionActions.createEmpty('picture')
    return
  }
  // 归档当前会话的上下文。
  // if (e.key === 'r' && altOrOption) {
  //     e.preventDefault()
  //     sessionActions.startNewThread()
  //     return
  // }
  if (e.key === 'r' && ctrlKey) {
    e.preventDefault()
    sessionActions.startNewThread()
    return
  }

  if (e.code === 'Tab' && ctrlKey && !shift) {
    sessionActions.switchToNext()
  }
  if (e.code === 'Tab' && ctrlKey && shift) {
    sessionActions.switchToNext(true)
  }
  for (let i = 1; i <= 9; i++) {
    if (e.code === `Digit${i}` && ctrlKey) {
      sessionActions.switchToIndex(i - 1)
    }
  }

  if (e.key === 'k' && ctrlKey) {
    const store = getDefaultStore()
    const openSearchDialog = store.get(atoms.openSearchDialogAtom)
    if (openSearchDialog) {
      store.set(atoms.openSearchDialogAtom, false)
    } else {
      store.set(atoms.openSearchDialogAtom, true)
    }
  }
  if (e.key === ',' && e.metaKey && navigate) {
    e.preventDefault()
    navigate('/settings')
    return
  }
}
