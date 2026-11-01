import { Button, Snackbar } from '@mui/material'
import { useStore } from 'zustand'
import { navigateToSettings } from '@/modals/settings-navigation'
import platform from '@/platform'
import { uiStore } from '@/stores/uiStore'
import * as toastActions from '../../stores/toastActions'

function Toasts() {
  const toasts = useStore(uiStore, (state) => state.toasts)
  return (
    <>
      {toasts.map((toast) => (
        <Snackbar
          className="Snackbar"
          style={platform.isDesktopLike ? { top: 64 } : undefined}
          key={toast.id}
          open
          onClose={() => toastActions.remove(toast.id)}
          message={toast.content}
          action={
            toast.action ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  try {
                    if (toast.action?.settingsPath) {
                      navigateToSettings(toast.action.settingsPath)
                    }
                    toast.action?.onClick?.()
                  } finally {
                    toastActions.remove(toast.id)
                  }
                }}
              >
                {toast.action.label}
              </Button>
            ) : undefined
          }
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          autoHideDuration={toast.duration ?? 3000}
        />
      ))}
    </>
  )
}

export default Toasts
