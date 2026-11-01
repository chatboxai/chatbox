import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Input } from '@mantine/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { rendererApplication } from '@/app/renderer-application'

import { editThread } from '@/stores/session/threads'

const ThreadNameEdit = NiceModal.create((props: { sessionId: string; threadId: string }) => {
  const { sessionId, threadId } = props
  const { read: threadRead } = rendererApplication.sessionHooks.useSessionThread(sessionId, threadId)
  const modal = useModal()
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const currentThreadName = threadRead?.thread.name ?? ''

  const [threadName, setThreadName] = useState(currentThreadName)
  useEffect(() => setThreadName(currentThreadName), [currentThreadName])

  const onClose = useCallback(() => {
    modal.resolve()
    modal.hide()
  }, [modal])

  const onSave = useCallback(async () => {
    if (!threadRead) return
    const trimmed = threadName.trim()
    await editThread(sessionId, threadId, { name: trimmed || currentThreadName })
    onClose()
  }, [onClose, threadId, threadName, currentThreadName, sessionId, threadRead])

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
