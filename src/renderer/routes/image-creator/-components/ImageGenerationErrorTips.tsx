import { Button, Flex, Paper, Text } from '@mantine/core'
import { ChatboxAIAPIError } from '@shared/models/errors'
import type { ImageGeneration } from '@shared/types'
import { IconRefresh, IconX } from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import { navigateToSettings } from '@/modals/Settings'

export interface ImageGenerationErrorTipsProps {
  record: ImageGeneration
  onRetry: () => void
  isRetrying: boolean
}

export function ImageGenerationErrorTips({ record, onRetry, isRetrying }: ImageGenerationErrorTipsProps) {
  const { t } = useTranslation()

  const chatboxAIErrorDetail = record.errorCode ? ChatboxAIAPIError.getDetail(record.errorCode) : null
  const showDetailedError = !chatboxAIErrorDetail

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
                      navigateToSettings('/provider')
                    }}
                  />
                ),
                LinkToHomePage: <span />,
              }}
            />
          </Text>
        ) : (
          <Text size="sm" c="dimmed" ta="center" className="whitespace-pre-wrap" maw={400}>
            {record.error}
          </Text>
        )}

        {showDetailedError && record.error && chatboxAIErrorDetail && (
          <Text size="xs" c="dimmed" ta="center" className="whitespace-pre-wrap opacity-60" maw={400}>
            {record.error}
          </Text>
        )}

        <Button
          variant="light"
          color="chatbox-error"
          leftSection={<IconRefresh size={16} />}
          onClick={onRetry}
          disabled={isRetrying}
          loading={isRetrying}
          radius="md"
        >
          {t('Retry')}
        </Button>
      </Flex>
    </Paper>
  )
}
