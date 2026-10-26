import NiceModal from '@ebay/nice-modal-react'
import { useBlocker } from '@tanstack/react-router'
import { t } from 'i18next'
import { useCallback, useRef } from 'react'

export interface BackupNavigationTask {
  isActive(): boolean
  cancelAndWait(): Promise<void>
}

/** Returns the same leave check for a host window-close handler. */
export function useBackupNavigationGuard(task: BackupNavigationTask): () => Promise<boolean> {
  const pendingConfirmation = useRef<Promise<boolean> | null>(null)
  const confirmInterruption = useCallback((): Promise<boolean> => {
    if (!task.isActive()) return Promise.resolve(true)
    if (!pendingConfirmation.current) {
      pendingConfirmation.current = (async () => {
        const confirmed = await NiceModal.show('confirm', {
          title: t('Interrupt backup?'),
          message: t('This will interrupt the import or export. Please wait while Chatbox finishes cleanup.'),
          confirmText: t('Interrupt and leave'),
          cancelText: t('Stay in settings'),
          danger: true,
        })
        if (confirmed !== true) return false
        try {
          await task.cancelAndWait()
          return true
        } catch (error) {
          await NiceModal.show('confirm', {
            title: t('Error'),
            message: error instanceof Error ? error.message : String(error),
            confirmText: t('OK'),
            cancelText: t('Cancel'),
          })
          return false
        }
      })().finally(() => {
        pendingConfirmation.current = null
      })
    }
    return pendingConfirmation.current
  }, [task])
  useBlocker({
    shouldBlockFn: async () => !(await confirmInterruption()),
    enableBeforeUnload: () => task.isActive(),
  })
  return confirmInterruption
}
