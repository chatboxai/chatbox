import type { TFunction } from 'i18next'
import * as toastActions from '@/stores/toastActions'

const ARCHIVE_UNDO_DURATION = 8000
const RESTORE_CONFIRMATION_DURATION = 5000

export function showSessionArchiveUndo(options: {
  t: TFunction
  restore: () => Promise<void>
  openSession: () => void
}): void {
  const restoreArchivedSession = async () => {
    try {
      await options.restore()
      toastActions.add(options.t('Chat restored') || '', RESTORE_CONFIRMATION_DURATION, {
        label: options.t('Open') || '',
        onClick: options.openSession,
      })
    } catch (error) {
      console.error('Failed to restore archived session:', error)
      toastActions.add(options.t('Failed to restore chat. Please try again.') || '', ARCHIVE_UNDO_DURATION, {
        label: options.t('Retry') || '',
        onClick: () => {
          void restoreArchivedSession()
        },
      })
    }
  }

  toastActions.add(options.t('Archived. Manage archived chats in Settings.') || '', ARCHIVE_UNDO_DURATION, {
    label: options.t('Undo') || '',
    onClick: () => {
      void restoreArchivedSession()
    },
  })
}
