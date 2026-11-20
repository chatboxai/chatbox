import NiceModal from '@ebay/nice-modal-react'
import { Button } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { confirmSessionDeletion } from '@/presentation/session/session-deletion-confirmation'
import { deleteSession } from '@/stores/session/crud'
import { add as addToast } from '@/stores/toastActions'

export function MissingSessionActions({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState(false)

  const onDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      const confirmed = await NiceModal.show('confirm', {
        title: t('Delete this chat?'),
        message: t('This will permanently delete the chat and its local data. This cannot be undone.'),
        confirmText: t('Delete'),
        danger: true,
      })
      if (confirmed !== true || !(await confirmSessionDeletion(sessionId))) return
      await deleteSession(sessionId)
      onBack()
    } catch (error) {
      console.error('Failed to delete missing session:', error)
      addToast(t('Failed to delete chat. Please try again.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <Button variant="outline" onClick={onBack} disabled={deleting}>
        {t('Back to HomePage')}
      </Button>
      <Button color="chatbox-error" variant="outline" loading={deleting} onClick={() => void onDelete()}>
        {t('Delete Current Session')}
      </Button>
    </div>
  )
}
