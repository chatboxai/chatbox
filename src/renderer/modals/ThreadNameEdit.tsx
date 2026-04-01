import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Input } from '@mantine/core'
import type { Session } from '@shared/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSession } from '@/stores/chatStore'
import { editThread } from '@/stores/sessionActions'

const ThreadNameEdit = NiceModal.create((props: { sessionId: string; threadId: string }) => {
  const { sessionId, threadId } = props
  const { session: currentSession } = useSession(sessionId)
  const modal = useModal()
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const currentThreadName = useMemo(() => {
    if (currentSession?.id === threadId) {
      return currentSession.threadName || ''
    }
    const threads = currentSession?.threads ?? []
    return threads.find((thread: NonNullable<Session['threads']>[number]) => thread.id === threadId)?.name || ''
  }, [currentSession?.threadName, currentSession?.threads, currentSession?.id, threadId])

  const [threadName, setThreadName] = useState(currentThreadName)
  useEffect(() => setThreadName(currentThreadName), [currentThreadName])

  const onClose = useCallback(() => {
    modal.resolve()
    modal.hide()
  }, [modal])

  const onSave = useCallback(async () => {
    if (!currentSession) return
    await editThread(currentSession.id, threadId, { name: threadName })
    onClose()
  }, [onClose, threadId, threadName, currentSession?.id, currentSession])

  const onContentInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    setThreadName(e.target.value)
  }, [])

  return (
    <AdaptiveModal opened={modal.visible} onClose={onClose} centered title={t('Edit Thread Name')}>
      <Input autoFocus={!isSmallScreen} placeholder="Thread Name" value={threadName} onChange={onContentInput} />

      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={onClose} />
        <Button onClick={onSave}>{t('Save')}</Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default ThreadNameEdit
