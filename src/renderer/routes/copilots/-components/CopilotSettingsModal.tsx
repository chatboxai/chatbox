import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Avatar, Button, FileButton, Flex, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core'
import { COPILOT_PROMPT_MAX_CHARS, type CopilotDetail } from '@shared/types'
import { IconMessageCircle2Filled, IconPhoto, IconUpload } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import { useCopilotMemory } from '@/hooks/useCopilots'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { CopilotMemoriesList } from './CopilotMemoriesList'

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
    const { readEnabled: readCopilotMemoryEnabled, setEnabled: setCopilotMemory } = useCopilotMemory()
    const [memoryEnabled, setMemoryEnabled] = useState<boolean>()

    useEffect(() => {
      if (!modal.visible) return

      let active = true
      if (copilot) {
        setFormData({ ...copilot })
        setMemoryEnabled(undefined)
        readCopilotMemoryEnabled(copilot.id)
          .then((enabled) => {
            if (active) setMemoryEnabled(enabled)
          })
          .catch((error) => console.error('CopilotSettingsModal: failed to load memory ownership', error))
      } else {
        setFormData({
          id: uuidv4(),
          name: '',
          prompt: '',
          description: '',
        })
        setMemoryEnabled(false)
      }
      setErrors({})

      // Snapshot the switch when the modal opens; it is applied on save like every
      // other field, so later changes elsewhere must not overwrite the draft.
      return () => {
        active = false
      }
    }, [modal.visible, copilot, readCopilotMemoryEnabled])

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
      } else if (formData.prompt.trim().length > COPILOT_PROMPT_MAX_CHARS) {
        newErrors.prompt = t('Prompt cannot exceed {{max}} characters', { max: COPILOT_PROMPT_MAX_CHARS })
      }

      setErrors(newErrors)
      return Object.keys(newErrors).length === 0
    }

    const handleClose = () => {
      modal.resolve()
      modal.hide()
    }

    const handleSave = () => {
      if (!formData || memoryEnabled === undefined) return
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
      setCopilotMemory({ id: trimmedData.id, name: trimmedData.name }, memoryEnabled)
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
          className="max-h-[70vh] overflow-y-auto border border-solid border-chatbox-border-primary rounded-lg p-sm"
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
                    radius="lg"
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
                    className="rounded-lg bg-chatbox-background-brand-secondary"
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
                    radius="lg"
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
                    className="rounded-lg bg-chatbox-background-secondary border border-dashed border-chatbox-border-primary"
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
            description={t('{{count}} / {{max}} characters', {
              count: (formData.prompt || '').length,
              max: COPILOT_PROMPT_MAX_CHARS,
            })}
            maxLength={COPILOT_PROMPT_MAX_CHARS}
            minRows={5}
            maxRows={10}
            autosize
          />

          {/* Memory */}
          <Stack gap="xs">
            <Flex justify="space-between" align="center" gap="md" wrap="nowrap">
              <Stack gap={2} className="min-w-0">
                <Text size="sm" fw={500}>
                  {t('Copilot Memory')}
                </Text>
                <Text size="xs" c="dimmed">
                  {t('All chats with this Copilot use its shared memory when on, or follow Global Memory when off.')}
                </Text>
              </Stack>
              <Switch
                checked={memoryEnabled ?? false}
                disabled={memoryEnabled === undefined}
                onChange={(e) => setMemoryEnabled(e.currentTarget.checked)}
              />
            </Flex>
            {mode === 'edit' && <CopilotMemoriesList copilotId={formData.id} />}
          </Stack>
        </Stack>

        {/* Footer Actions */}
        <Flex justify="flex-end" align="center" mt="lg">
          <Flex gap="sm">
            <Button variant="outline" onClick={handleClose}>
              {t('cancel')}
            </Button>
            <Button disabled={memoryEnabled === undefined} onClick={handleSave}>
              {t('save')}
            </Button>
          </Flex>
        </Flex>
      </AdaptiveModal>
    )
  }
)

export default CopilotSettingsModal
