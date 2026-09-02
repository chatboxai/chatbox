import { ActionIcon, Button, Flex, Paper, Text } from '@mantine/core'
import { ChatboxAIAPIError } from '@shared/models/errors'
import type { ImageGeneration } from '@shared/types'
import { IconCheck, IconCopy, IconRefresh, IconSettings, IconX } from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import LinkTargetBlank from '@/components/common/Link'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useCopied } from '@/hooks/useCopied'
import { navigateToSettings } from '@/modals/settings-navigation'
import { trackingEvent } from '@/packages/event'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'

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

  const chatboxAIErrorDetail =
    typeof record.errorCode === 'number' ? ChatboxAIAPIError.getDetail(record.errorCode) : null
  const imageGenerationTaskErrorCode = isImageGenerationTaskErrorCode(record.errorCode) ? record.errorCode : undefined
  const errorDebugInfo = [
    record.errorItemUuid ? `UUID: ${record.errorItemUuid}` : undefined,
    record.taskId ? `Task ID: ${record.taskId}` : undefined,
  ].filter((item): item is string => !!item)
  const showErrorDebugInfo = Boolean(
    (chatboxAIErrorDetail || imageGenerationTaskErrorCode) && errorDebugInfo.length > 0
  )
  const { copied, copy } = useCopied(errorDebugInfo.join('\n'))
  const isLicenseError =
    chatboxAIErrorDetail && ['license_not_found', 'expired_license'].includes(chatboxAIErrorDetail.name)

  return (
    <Paper
      p="lg"
      radius="lg"
      className="bg-[var(--chatbox-background-error-secondary)] border border-[var(--chatbox-border-error)]"
    >
      <Flex direction="column" align="center" gap="md">
        <div className="w-12 h-12 rounded-full bg-[var(--chatbox-background-error-primary)] flex items-center justify-center">
          <IconX size={24} className="text-white" />
        </div>

        <Text fw={500} size="sm">
          {t('Generation Failed')}
        </Text>

        {chatboxAIErrorDetail ? (
          <Text size="sm" c="dimmed" ta="center" maw={400}>
            <Trans
              i18nKey={chatboxAIErrorDetail.i18nKey}
              values={{
                model: record.model.modelId,
              }}
              components={{
                OpenSettingButton: (
                  <Text
                    component="span"
                    className="cursor-pointer underline"
                    c="chatbox-brand"
                    onClick={() => navigateToSettings()}
                  />
                ),
                OpenMorePlanButton: (
                  <Text
                    component="span"
                    className="cursor-pointer underline"
                    c="chatbox-brand"
                    onClick={() => {
                      platform.openLink(
                        buildChatboxUrl(
                          `/redirect_app/view_more_plans/${settingActions.getLanguage()}?utm_source=app&utm_content=image_creator_upgrade_required`
                        )
                      )
                      trackingEvent('click_view_more_plans_button_from_image_creator', {
                        event_category: 'user',
                      })
                    }}
                  />
                ),
                LinkToHomePage: <LinkTargetBlank href="https://chatboxai.app" />,
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
          {isLicenseError && (
            <Button
              variant="light"
              color="gray"
              leftSection={<IconSettings size={16} />}
              onClick={() => navigateToSettings()}
              radius="lg"
            >
              {t('Settings')}
            </Button>
          )}
          <Button
            variant="light"
            color="chatbox-error"
            leftSection={<IconRefresh size={16} />}
            onClick={onRetry}
            disabled={isRetrying}
            loading={isRetrying}
            radius="lg"
          >
            {t('Retry')}
          </Button>
        </Flex>
      </Flex>
    </Paper>
  )
}
