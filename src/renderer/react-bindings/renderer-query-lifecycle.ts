import type { ReactQueryHostLifecycle } from '@chatbox/react/query'
import platform from '@/platform'

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

export function createRendererQueryLifecycle(): ReactQueryHostLifecycle {
  return {
    focus: {
      getCurrent: () => platform.isWindowFocused(),
      subscribe(listener) {
        const unsubscribePlatform = platform.onWindowFocused(() => listener(true))
        const handleVisibility = () => listener(isVisible())
        const handleFocus = () => listener(true)
        const handleBlur = () => listener(false)
        document.addEventListener('visibilitychange', handleVisibility, false)
        window.addEventListener('focus', handleFocus, false)
        window.addEventListener('blur', handleBlur, false)
        return () => {
          unsubscribePlatform()
          document.removeEventListener('visibilitychange', handleVisibility, false)
          window.removeEventListener('focus', handleFocus, false)
          window.removeEventListener('blur', handleBlur, false)
        }
      },
    },
    online: {
      getCurrent: () => navigator.onLine,
      subscribe(listener) {
        const handleOnline = () => listener(true)
        const handleOffline = () => listener(false)
        window.addEventListener('online', handleOnline, false)
        window.addEventListener('offline', handleOffline, false)
        return () => {
          window.removeEventListener('online', handleOnline, false)
          window.removeEventListener('offline', handleOffline, false)
        }
      },
    },
  }
}
