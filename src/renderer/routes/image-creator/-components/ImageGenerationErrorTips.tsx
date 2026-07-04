import { ActionIcon, Button, Flex, Paper, Text, Tooltip } from '@mantine/core'
import { CodedError } from '@shared/models/errors'
import type { ImageGeneration } from '@shared/types'
import { IconCheck, IconCopy, IconRefresh, IconX } from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import { useCopied } from '@/hooks/useCopied'
import { navigateToSettings } from '@/modals/Settings'

export interface ImageGenerationErrorTipsProps {
  record: ImageGeneration
  onRetry: () => void
  isRetrying: boolean
}

type ImageGenerationTaskErrorCode = 'image_generation_failed' | 'image_content_moderation_blocked' | 'ai_provider_error'

function isImageGenerationTaskErrorCode(errorCode: unknown): errorCode is ImageGenerationTaskErrorCode {
  return (
    errorCode === 'image_generation_failed' ||
    errorCode === 'image_content_moderation_blocked' ||
    errorCode === 'ai_provider_error'
  )
}

function ImageGenerationTaskErrorMessage({ errorCode }: { errorCode: ImageGenerationTaskErrorCode }) {
  switch (errorCode) {
    case 'image_content_moderation_blocked':
      return <Trans i18nKey="Content not allowed. Please modify your request and try again." />
    case 'ai_provider_error':
      return <Trans i18nKey="The AI provider is temporarily unavailable. Please try again later." />
    case 'image_generation_failed':
      return <Trans i18nKey="Image generation failed. Please try again." />
  }
  return null
}

export function ImageGenerationErrorTips({ record, onRetry, isRetrying }: ImageGenerationErrorTipsProps) {
  const { t } = useTranslation()

  const codedErrorDetail = typeof record.errorCode === 'number' ? CodedError.getDetail(record.errorCode) : null
  const imageGenerationTaskErrorCode = isImageGenerationTaskErrorCode(record.errorCode) ? record.errorCode : undefined
  const errorDebugInfo = [
    record.errorItemUuid ? `UUID: ${record.errorItemUuid}` : undefined,
    record.taskId ? `Task ID: ${record.taskId}` : undefined,
  ].filter((item): item is string => !!item)
  const showErrorDebugInfo = Boolean((codedErrorDetail || imageGenerationTaskErrorCode) && errorDebugInfo.length > 0)
  const { copied, copy } = useCopied(errorDebugInfo.join('\n'))

  return (
    <Paper
      p="lg"
      radius="lg"
      className="bg-[var(--workspaice-background-error-secondary)] border border-[var(--workspaice-border-error)]"
    >
      <Flex direction="column" align="center" gap="md">
        <div className="w-12 h-12 rounded-full bg-[var(--workspaice-background-error-primary)] flex items-center justify-center">
          <IconX size={24} className="text-white" />
        </div>

        <Text fw={500} size="sm">
          {t('Generation Failed')}
        </Text>

        {codedErrorDetail ? (
          <Text size="sm" c="dimmed" ta="center" maw={400}>
            <Trans
              i18nKey={codedErrorDetail.i18nKey}
              values={{
                model: record.model.modelId,
              }}
              components={{
                OpenSettingButton: (
                  <Text
                    component="span"
                    className="cursor-pointer underline"
                    c="workspaice-brand"
                    onClick={() => navigateToSettings()}
                  />
                ),
                OpenMorePlanButton: (
                  <Text
                    component="span"
                    className="cursor-pointer underline"
                    c="workspaice-brand"
                    onClick={() => navigateToSettings()}
                  />
                ),
                LinkToHomePage: <span />,
              }}
            />
          </Text>
        ) : imageGenerationTaskErrorCode ? (
          <Text size="sm" c="dimmed" ta="center" maw={400}>
            <ImageGenerationTaskErrorMessage errorCode={imageGenerationTaskErrorCode} />
          </Text>
        ) : (
          <Text size="sm" c="dimmed" ta="center" className="whitespace-pre-wrap" maw={400}>
            {record.error}
          </Text>
        )}

        {showErrorDebugInfo && (
          <Flex align="center" gap={6} className="opacity-60">
            <Flex direction="column" gap={2} maw={360}>
              {record.errorItemUuid && (
                <Text size="xs" c="dimmed" className="break-all">
                  UUID: {record.errorItemUuid}
                </Text>
              )}
              {record.taskId && (
                <Text size="xs" c="dimmed" className="break-all">
                  Task ID: {record.taskId}
                </Text>
              )}
            </Flex>
            <Tooltip label={copied ? t('Copied') : t('Copy')} withArrow openDelay={500}>
              <ActionIcon variant="subtle" size="xs" color="gray" onClick={copy} aria-label={t('Copy')}>
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </ActionIcon>
            </Tooltip>
          </Flex>
        )}

        <Flex gap="sm">
          <Button
            variant="light"
            color="workspaice-error"
            leftSection={<IconRefresh size={16} />}
            onClick={onRetry}
            disabled={isRetrying}
            loading={isRetrying}
            radius="md"
          >
            {t('Retry')}
          </Button>
        </Flex>
      </Flex>
    </Paper>
  )
}
