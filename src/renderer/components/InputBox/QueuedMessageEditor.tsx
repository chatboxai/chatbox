import { Button, Stack, Text, Textarea } from '@mantine/core'
import type { Message } from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'

type ImagePart = Extract<Message['contentParts'][number], { type: 'image' }>

export type QueuedMessageEditorProps = {
  opened: boolean
  message: Message
  dispatching: boolean
  onSave: (message: Message) => void
  onClose: () => void
}

function getText(message: Message): string {
  return message.contentParts.find((part) => part.type === 'text')?.text ?? ''
}

function replaceMessageText(message: Message, text: string): Message {
  const remaining = message.contentParts.filter((part) => part.type !== 'text')
  return { ...message, contentParts: [{ type: 'text', text }, ...remaining] }
}

export default function QueuedMessageEditor({
  opened,
  message,
  dispatching,
  onSave,
  onClose,
}: QueuedMessageEditorProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(message)

  useEffect(() => {
    if (opened) setDraft(message)
  }, [message, opened])

  const text = getText(draft)
  const images = useMemo(
    () => draft.contentParts.filter((part): part is ImagePart => part.type === 'image'),
    [draft.contentParts]
  )
  const hasAttachments = Boolean(draft.files?.length || draft.links?.length || images.length)
  const canSave = !dispatching && (text.trim().length > 0 || hasAttachments)

  const save = () => {
    if (!canSave) return
    onSave(replaceMessageText(draft, text))
    onClose()
  }

  return (
    <AdaptiveModal opened={opened} onClose={onClose} centered title={t('Edit queued message')}>
      <Stack gap="sm">
        <Textarea
          label={t('Message')}
          value={text}
          disabled={dispatching}
          autosize
          minRows={3}
          onChange={(event) => {
            const nextText = event.currentTarget.value
            setDraft((current) => replaceMessageText(current, nextText))
          }}
        />

        {(draft.files?.length ?? 0) > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {t('Files')}
            </Text>
            {draft.files?.map((file) => (
              <div key={file.id} className="flex items-center justify-between gap-2">
                <Text size="sm" truncate>
                  {file.name}
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  disabled={dispatching}
                  aria-label={t('Remove file {{name}}', { name: file.name })}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      files: current.files?.filter((candidate) => candidate.id !== file.id),
                    }))
                  }
                >
                  {t('Remove')}
                </Button>
              </div>
            ))}
          </Stack>
        )}

        {(draft.links?.length ?? 0) > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {t('Links')}
            </Text>
            {draft.links?.map((link) => {
              const linkKey = link.storageKey ?? link.url
              const label = link.title || link.url
              return (
                <div key={linkKey} className="flex items-center justify-between gap-2">
                  <Text size="sm" truncate>
                    {label}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    disabled={dispatching}
                    aria-label={t('Remove link {{name}}', { name: label })}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        links: current.links?.filter(
                          (candidate) => (candidate.storageKey ?? candidate.url) !== linkKey
                        ),
                      }))
                    }
                  >
                    {t('Remove')}
                  </Button>
                </div>
              )
            })}
          </Stack>
        )}

        {images.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {t('Images')}
            </Text>
            {images.map((image) => (
              <div key={image.storageKey} className="flex items-center justify-between gap-2">
                <Text size="sm">{t('Image')}</Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  disabled={dispatching}
                  aria-label={t('Remove image')}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      contentParts: current.contentParts.filter(
                        (part) => part.type !== 'image' || part.storageKey !== image.storageKey
                      ),
                    }))
                  }
                >
                  {t('Remove')}
                </Button>
              </div>
            ))}
          </Stack>
        )}
      </Stack>

      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={onClose} />
        <Button disabled={!canSave} aria-label={t('Save queued message')} onClick={save}>
          {t('Save')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
}
