import { Haptics, ImpactStyle } from '@capacitor/haptics'
import platform from '@/platform'

/** Light tap confirming a long press: Capacitor haptics in the app, `navigator.vibrate` in browsers that have it. */
export function triggerLongPressHaptic() {
  if (platform.type === 'mobile') {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
      navigator.vibrate?.(10)
    })
    return
  }
  navigator.vibrate?.(10)
}

/** Medium tap marking the moment a swiped message will reply again on release. */
export function triggerSwipeArmHaptic() {
  if (platform.type === 'mobile') {
    void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {
      navigator.vibrate?.(10)
    })
    return
  }
  navigator.vibrate?.(10)
}
