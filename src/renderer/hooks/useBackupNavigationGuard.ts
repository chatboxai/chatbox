import { useEffect } from 'react'
import platform from '@/platform'
import NiceModal from '@ebay/nice-modal-react'
import { useBlocker } from '@tanstack/react-router'
import { t } from 'i18next'
import { rendererApplication } from '@/app/renderer-application'

let nativeGuardUsers = 0
let releaseNativeGuard: (() => void) | undefined

let pendingConfirmation: Promise<boolean> | null = null

export async function confirmBackupInterruption(): Promise<boolean> {
  const operations = rendererApplication.backupOperations
  if (!operations.getSnapshot()) return true
  if (!pendingConfirmation) {
    pendingConfirmation = (async () => {
      const confirmed = await NiceModal.show('confirm', {
        title: t('Interrupt backup?'),
        message: t('This will interrupt the import or export. Please wait while Chatbox finishes cleanup.'),
        confirmText: t('Interrupt and leave'),
        cancelText: t('Stay in settings'),
        danger: true,
      })
      if (confirmed !== true) return false
      try {
        await operations.cancelAndWait()
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
      pendingConfirmation = null
    })
  }
  return pendingConfirmation
}

/** Install in both the settings router and the modal's outer router. */
export function useBackupNavigationGuard(): void {
  useEffect(() => {
    if (!platform.onBackupCloseRequest || !platform.setBackupOperationActive || !platform.finishBackupClose) return
    if (nativeGuardUsers++ === 0) {
      releaseNativeGuard = platform.onBackupCloseRequest(() => {
        void confirmBackupInterruption()
          .then((confirmed) => platform.finishBackupClose?.(confirmed))
          .catch(console.error)
      })
    }
    return () => {
      if (--nativeGuardUsers === 0) {
        releaseNativeGuard?.()
        releaseNativeGuard = undefined
      }
    }
  }, [])
  useBlocker({
    shouldBlockFn: async () => !(await confirmBackupInterruption()),
    enableBeforeUnload: () => rendererApplication.backupOperations.getSnapshot() !== null,
  })
}
