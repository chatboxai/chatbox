import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, ColorInput, Flex, Stack } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { updateGroup, useGroups } from '@/stores/groupStore'
import { add as addToast } from '@/stores/toastActions'

interface Props {
  groupId: string
}

const GROUP_PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]

const SetGroupColor = NiceModal.create(({ groupId }: Props) => {
  const modal = useModal()
  const { t } = useTranslation()
  const { groups } = useGroups()
  const group = groups?.find((g) => g.id === groupId)

  const [color, setColor] = useState<string>(group?.color ?? '')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setColor(group?.color ?? '')
  }, [group?.color])

  const resetState = () => {
    setColor('')
    setSubmitting(false)
  }

  const onClose = () => {
    resetState()
    modal.resolve()
    modal.hide()
  }

  const applyColor = async (next: string | undefined) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await updateGroup(groupId, { color: next })
      resetState()
      modal.resolve(next)
      modal.hide()
    } catch (error) {
      console.error('Failed to update group color:', error)
      addToast(error instanceof Error ? error.message : String(error))
      setSubmitting(false)
    }
  }

  if (!group) {
    if (modal.visible) {
      console.error(`SetGroupColor: group not found id=${groupId}`)
      modal.hide()
    }
    return null
  }

  return (
    <AdaptiveModal opened={modal.visible} onClose={onClose} size="sm" centered title={t('Set color')}>
      <Stack gap="md">
        <ColorInput
          value={color}
          onChange={setColor}
          format="hex"
          swatches={GROUP_PRESET_COLORS}
          swatchesPerRow={8}
          closeOnColorSwatchClick
          withPicker
        />
        <Flex gap="md" justify="flex-end" align="center" mt="md">
          <Button variant="subtle" color="chatbox-tertiary" onClick={() => void applyColor(undefined)} disabled={submitting}>
            {t('Reset to Default')}
          </Button>
          <Button variant="default" onClick={onClose} disabled={submitting}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void applyColor(color || undefined)} loading={submitting}>
            {t('Confirm')}
          </Button>
        </Flex>
      </Stack>
    </AdaptiveModal>
  )
})

export default SetGroupColor
