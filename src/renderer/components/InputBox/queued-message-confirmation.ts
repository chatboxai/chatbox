import NiceModal from '@ebay/nice-modal-react'
import i18n from '@/i18n'
import { getSubmissionQueueState } from '@/stores/atoms/submissionQueueAtoms'
import { clearSessionSubmissionQueue } from '@/stores/session/submission-queue'

export async function confirmAndDiscardSubmissionQueue(
  sessionId: string,
  action?: () => void | Promise<void>
): Promise<boolean> {
  const count = getSubmissionQueueState(sessionId).items.length
  if (count === 0) {
    await action?.()
    return true
  }

  const confirmed = await NiceModal.show('confirm', {
    title: i18n.t('Discard queued messages?'),
    message: i18n.t('This action will discard {{count}} queued message(s).', { count }),
    confirmText: i18n.t('Discard'),
    danger: true,
  })
  if (confirmed !== true) return false

  await clearSessionSubmissionQueue(sessionId)
  await action?.()
  return true
}
