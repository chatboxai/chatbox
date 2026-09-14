import { t } from 'i18next'
import { rendererApplication } from './renderer-application'

/** Immediate admission check, before an action joins a generation or persistence queue. */
export async function guardBackupWrite(): Promise<boolean> {
  if (!rendererApplication.backupOperations.getSnapshot()) return true
  const toastActions = await import('@/stores/toastActions')
  toastActions.add(t('Wait for the import or export to finish'), 2500)
  return false
}
