import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { TestId } from '@shared/automation/testids'
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import platform from '@/platform'

const LONG_PRESS_DELAY = 550
const LONG_PRESS_MOVE_TOLERANCE = 10

function triggerLongPressHaptic() {
  if (platform.type === 'mobile') {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
      navigator.vibrate?.(10)
    })
    return
  }
  navigator.vibrate?.(10)
}

export function useSidebarContextMenu({
  touchLayout,
  disabled = false,
  nativeContextMenu = false,
}: {
  touchLayout: boolean
  disabled?: boolean
  nativeContextMenu?: boolean
}) {
  const [menuOpened, setMenuOpened] = useState(false)
  const [longPressing, setLongPressing] = useState(false)
  const [menuPortalTarget, setMenuPortalTarget] = useState<HTMLElement>()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggeredRef = useRef(false)
  const startPointRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const clearLongPressTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    startPointRef.current = null
    setLongPressing(false)
  }

  const handlePointerDown = (event: PointerEvent) => {
    // Consume only the click from this press, even when the previous press had none.
    triggeredRef.current = false
    clearLongPressTimer()
    if (!touchLayout || disabled) return
    setMenuPortalTarget(event.currentTarget.closest<HTMLElement>(`[data-testid="${TestId.sidebar.root}"]`) ?? undefined)
    startPointRef.current = { x: event.clientX, y: event.clientY }
    setLongPressing(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      triggeredRef.current = true
      setLongPressing(false)
      triggerLongPressHaptic()
      setMenuOpened(true)
    }, LONG_PRESS_DELAY)
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (!startPointRef.current) return
    const deltaX = Math.abs(event.clientX - startPointRef.current.x)
    const deltaY = Math.abs(event.clientY - startPointRef.current.y)
    if (deltaX > LONG_PRESS_MOVE_TOLERANCE || deltaY > LONG_PRESS_MOVE_TOLERANCE) clearLongPressTimer()
  }

  const handleContextMenu = (event: MouseEvent) => {
    if (nativeContextMenu) return
    event.preventDefault()
    if (disabled) return
    setMenuPortalTarget(event.currentTarget.closest<HTMLElement>(`[data-testid="${TestId.sidebar.root}"]`) ?? undefined)
    // Touch browsers can also emit contextmenu before the release click.
    if ('pointerType' in event.nativeEvent && event.nativeEvent.pointerType === 'touch') {
      clearLongPressTimer()
      triggeredRef.current = true
    }
    setMenuOpened(true)
  }

  const handleMenuChange = (opened: boolean) => {
    setMenuOpened(opened)
    if (!opened) {
      clearLongPressTimer()
      triggeredRef.current = false
    }
  }

  const consumeClick = () => {
    if (triggeredRef.current) {
      triggeredRef.current = false
      return true
    }
    // A tap on the menu's own row dismisses it before the row's default action.
    if (menuOpened) {
      handleMenuChange(false)
      return true
    }
    return false
  }

  return {
    menuOpened,
    menuPortalTarget,
    longPressing,
    consumeClick,
    handleContextMenu,
    handleMenuChange,
    handlePointerDown,
    handlePointerMove,
    clearLongPressTimer,
  }
}
