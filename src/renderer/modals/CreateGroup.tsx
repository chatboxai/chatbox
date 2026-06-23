import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Flex, Stack, TextInput } from '@mantine/core'
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { createGroup } from '@/stores/groupStore'
import { add as addToast } from '@/stores/toastActions'

const CreateGroup = NiceModal.create(({ parentId = null }: { parentId?: string | null } = {}) => {
  const modal = useModal()
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  const handleConfirm = async () => {
    const trimmed = name.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await createGroup({ name: trimmed, parentId })
      onClose()
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleConfirm()
    }
  }

  return (
    <AdaptiveModal
      opened={modal.visible}
      onClose={onClose}
      title={parentId ? t('New subgroup') : t('New group')}
      size="sm"
    >
      <Stack gap="md">
        <TextInput
          autoFocus
          data-autofocus
          value={name}
          placeholder={t('New group name') ?? ''}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={handleKey}
        />
        <Flex gap="md" justify="flex-end" align="center">
          <Button variant="subtle" color="chatbox-tertiary" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void handleConfirm()} loading={submitting} disabled={!name.trim()}>
            {t('Create')}
          </Button>
        </Flex>
      </Stack>
    </AdaptiveModal>
  )
})

export default CreateGroup
