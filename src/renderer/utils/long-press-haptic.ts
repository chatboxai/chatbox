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
