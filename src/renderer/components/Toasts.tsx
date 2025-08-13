import { Snackbar } from '@mui/material'
import { useAtomValue } from 'jotai'
import {} from 'react'
import * as atoms from '../stores/atoms'
import * as toastActions from '../stores/toastActions'

function Toasts() {
  const toasts = useAtomValue(atoms.toastsAtom)
  return (
    <>
      {toasts.map((toast) => (
        <Snackbar
          className="Snackbar"
          key={toast.id}
          open
          onClose={() => toastActions.remove(toast.id)}
          message={toast.content}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          autoHideDuration={toast.duration ?? 3000}
        />
      ))}
    </>
  )
}

export default Toasts
