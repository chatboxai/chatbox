import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Avatar, Button, FileButton, Flex, Stack, Text, Textarea, TextInput } from '@mantine/core'
import type { CopilotDetail } from '@shared/types'
import { IconMessageCircle2Filled, IconPhoto, IconUpload } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

export interface CopilotSettingsModalProps {
  copilot?: CopilotDetail | null
  onSave: (copilot: CopilotDetail) => void
  onDelete?: (id: string) => void
  mode?: 'create' | 'edit'
}

const CopilotSettingsModal = NiceModal.create(
  ({ copilot, onSave, onDelete, mode = 'create' }: CopilotSettingsModalProps) => {
    const modal = useModal()
    const { t } = useTranslation()
    const isSmallScreen = useIsSmallScreen()
    const [formData, setFormData] = useState<CopilotDetail | null>(null)
    const [errors, setErrors] = useState<Record<string, string>>({})

    useEffect(() => {
      if (modal.visible) {
        if (copilot) {
          setFormData({ ...copilot })
        } else {
          setFormData({
            id: uuidv4(),
            name: '',
            prompt: '',
            description: '',
          })
        }
        setErrors({})
      }
    }, [modal.visible, copilot])

    const updateField = <K extends keyof CopilotDetail>(field: K, value: CopilotDetail[K]) => {
      if (!formData) return
      setFormData({ ...formData, [field]: value })
      if (errors[field]) {
        setErrors({ ...errors, [field]: '' })
      }
    }

    const handleIconUpload = (file: File | null) => {
      if (!file || !formData) return
      if (file.size > MAX_IMAGE_SIZE) {
        setErrors((prev) => ({ ...prev, avatar: t('Support jpg or png file smaller than 5MB') }))

        return
      }
      const key = StorageKeyGenerator.picture(`copilot-icon:${formData.id}`)
      handleImageInputAndSave(
        file,
        key,
        () => {
          updateField('avatar', { type: 'storage-key', storageKey: key })
        },
        (k, v) => storage.setBlob(k, v)
      )
    }

    const handleBackgroundUpload = (file: File | null) => {
      if (!file || !formData) return
      if (file.size > MAX_IMAGE_SIZE) {
        setErrors((prev) => ({ ...prev, backgroundImage: t('Support jpg or png file smaller than 5MB') }))
        return
      }
      const key = StorageKeyGenerator.picture(`copilot-bg:${formData.id}`)
      handleImageInputAndSave(
        file,
        key,
        () => {
          updateField('backgroundImage', { type: 'storage-key', storageKey: key })
        },
        (k, v) => storage.setBlob(k, v)
      )
    }

    const validate = (): boolean => {
      if (!formData) return false
      const newErrors: Record<string, string> = {}

      if (!formData.name?.trim()) {
        newErrors.name = t('cannot be empty')
      }
      if (!formData.prompt?.trim()) {
        newErrors.prompt = t('cannot be empty')
      }

      setErrors(newErrors)
      return Object.keys(newErrors).length === 0
    }

    const handleClose = () => {
      modal.resolve()
      modal.hide()
    }

    const handleSave = () => {
      if (!formData) return
      if (!validate()) return

      const trimmedData = {
        createdAt: Date.now(),
        ...formData,
        name: formData.name.trim(),
        prompt: formData.prompt.trim(),
        description: formData.description?.trim(),
        updatedAt: Date.now(),
      }

      onSave(trimmedData)
      trackingEvent(mode === 'edit' ? 'edit_copilot' : 'create_copilot', { event_category: 'user' })
      modal.resolve(trimmedData)
      modal.hide()
    }

    if (!formData) return null

    return (
      <AdaptiveModal
        opened={modal.visible}
        onClose={handleClose}
        title={t('Copilot Settings')}
        centered
        size="lg"
        trapFocus={false}
      >
        <Stack
          gap="md"
          className="max-h-[70vh] overflow-y-auto border border-solid border-chatbox-border-primary rounded-md p-sm"
        >
          {/* Title */}
          <TextInput
            label={
              <Text size="sm" fw={500}>
                {t('Title')}
                <Text component="span" c="red">
                  *
                </Text>
              </Text>
            }
            placeholder={t('Title') || ''}
            value={formData.name || ''}
            onChange={(e) => updateField('name', e.currentTarget.value)}
            error={errors.name}
            autoFocus={!isSmallScreen}
          />

          {/* Icon and Background Image */}
          <Flex gap="xl">
            {/* Icon Upload */}
            <Stack gap="xs" className="flex-1">
              <Text size="sm" fw={500}>
                {t('Icon')}
              </Text>
              <Flex align="center" gap="sm">
                {formData.avatar?.type === 'storage-key' || formData.avatar?.type === 'url' || formData.picUrl ? (
                  <Avatar
                    src={formData.avatar?.type === 'url' ? formData.avatar.url : formData.picUrl || ''}
                    alt={formData.name}
                    size={48}
                    radius="xl"
                    className="flex-shrink-0 border border-solid border-chatbox-border-primary"
                  >
                    {formData.avatar?.type === 'storage-key' ? (
                      <ImageInStorage
                        storageKey={formData.avatar.storageKey}
                        className="object-cover object-center w-full h-full"
                      />
                    ) : (
                      formData.name?.charAt(0)?.toUpperCase()
                    )}
                  </Avatar>
                ) : (
                  <Stack
                    w={48}
                    h={48}
                    align="center"
                    justify="center"
                    className="rounded-md bg-chatbox-background-brand-secondary"
                  >
                    <ScalableIcon icon={IconMessageCircle2Filled} size={28} className="text-chatbox-tint-brand" />
                  </Stack>
                )}
                <FileButton onChange={handleIconUpload} accept="image/png,image/jpeg">
                  {(props) => (
                    <Button
                      {...props}
                      variant="outline"
                      size="xs"
                      leftSection={<ScalableIcon icon={IconUpload} size={14} />}
                    >
                      {t('Upload')}
                    </Button>
                  )}
                </FileButton>
              </Flex>
              {errors.avatar && (
                <Text size="xs" c="red">
                  {errors.avatar}
                </Text>
              )}
            </Stack>

            {/* Background Image Upload */}
            <Stack gap="xs" className="flex-1">
              <Text size="sm" fw={500}>
                {t('Set Background Image')}
              </Text>
              <Flex align="center" gap="sm">
                {formData.backgroundImage ? (
                  <Avatar
                    src={formData.backgroundImage?.type === 'url' ? formData.backgroundImage.url : ''}
                    size={48}
                    radius="md"
                    className="flex-shrink-0 border border-solid border-chatbox-border-primary"
                  >
                    {formData.backgroundImage?.type === 'storage-key' && (
                      <ImageInStorage
                        storageKey={formData.backgroundImage.storageKey}
                        className="object-cover object-center w-full h-full"
                      />
                    )}
                  </Avatar>
                ) : (
                  <Stack
                    w={48}
                    h={48}
                    align="center"
                    justify="center"
                    className="rounded-md bg-chatbox-background-secondary border border-dashed border-chatbox-border-primary"
                  >
                    <ScalableIcon icon={IconPhoto} size={20} className="text-chatbox-tint-tertiary" />
                  </Stack>
                )}
                <FileButton onChange={handleBackgroundUpload} accept="image/png,image/jpeg">
                  {(props) => (
                    <Button
                      {...props}
                      variant="outline"
                      size="xs"
                      leftSection={<ScalableIcon icon={IconUpload} size={14} />}
                    >
                      {t('Upload')}
                    </Button>
                  )}
                </FileButton>
              </Flex>
              {errors.backgroundImage && (
                <Text size="xs" c="red">
                  {errors.backgroundImage}
                </Text>
              )}
            </Stack>
          </Flex>

          {/* Description */}
          <Textarea
            label={
              <Text size="sm" fw={500}>
                {t('Description')}
              </Text>
            }
            placeholder={t('Description') || ''}
            value={formData.description || ''}
            onChange={(e) => updateField('description', e.currentTarget.value)}
            error={errors.description}
            minRows={3}
            maxRows={5}
            autosize
          />

          {/* Prompt Content */}
          <Textarea
            label={
              <Text size="sm" fw={500}>
                {t('Prompt Content')}
                <Text component="span" c="red">
                  *
                </Text>
              </Text>
            }
            placeholder={t('Copilot Prompt Demo') || ''}
            value={formData.prompt || ''}
            onChange={(e) => updateField('prompt', e.currentTarget.value)}
            error={errors.prompt}
            minRows={5}
            maxRows={10}
            autosize
          />
        </Stack>

        {/* Footer Actions */}
        <Flex justify="flex-end" align="center" mt="lg">
          <Flex gap="sm">
            <Button variant="outline" onClick={handleClose}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSave}>{t('save')}</Button>
          </Flex>
        </Flex>
      </AdaptiveModal>
    )
  }
)

export default CopilotSettingsModal
