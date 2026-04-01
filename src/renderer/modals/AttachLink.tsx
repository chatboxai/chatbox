import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Textarea } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'

const AttachLink = NiceModal.create(() => {
  const modal = useModal()
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const onClose = () => {
    modal.resolve([])
    modal.hide()
  }
  const onSubmit = () => {
    const raw = input.trim()
    const urls = raw
      .split(/\s+/)
      .map((url) => url.trim())
      .map((url) => (url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`))
    modal.resolve(urls)
    modal.hide()
  }
  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    setInput(e.target.value)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ctrlOrCmd = event.ctrlKey || event.metaKey
    // ctrl + enter 提交
    if (event.keyCode === 13 && ctrlOrCmd) {
      event.preventDefault()
      onSubmit()
      return
    }
  }

  return (
    <AdaptiveModal
      opened={modal.visible}
      onClose={() => {
        modal.resolve()
        modal.hide()
      }}
      centered
      title={t('Attach Link')}
    >
      <Textarea
        autoFocus
        autosize
        minRows={5}
        maxRows={15}
        placeholder={`https://example.com\nhttps://example.com/page`}
        value={input}
        onChange={onInput}
        onKeyDown={onKeyDown}
      />

      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={onClose} />
        <Button onClick={onSubmit}>{t('Submit')}</Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default AttachLink
