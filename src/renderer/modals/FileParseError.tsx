import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Alert, Stack, Text } from '@mantine/core'
import { ChatboxAIAPIError } from '@shared/models/errors'
import { IconAlertCircle } from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import LinkTargetBlank from '@/components/common/Link'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { navigateToSettings } from '@/modals/Settings'
import { trackingEvent } from '@/packages/event'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'

interface FileParseErrorProps {
  errorCode: string
  fileName?: string
}

const FileParseError = NiceModal.create(({ errorCode, fileName }: FileParseErrorProps) => {
  const modal = useModal()
  const { t } = useTranslation()

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  // 根据错误码获取错误详情
  const errorDetail = ChatboxAIAPIError.codeNameMap[errorCode]

  // 错误提示内容
  const renderErrorTips = () => {
    if (!errorDetail) {
      // 未知错误
      return <Text>{t('Failed to parse file. Please try again or use a different file format.')}</Text>
    }

    return (
      <Trans
        i18nKey={errorDetail.i18nKey}
        values={{
          model: t('current model'),
        }}
        components={{
          OpenSettingButton: <span />,
          OpenExtensionSettingButton: <span />,
          OpenMorePlanButton: (
            <a
              className="cursor-pointer underline font-semibold text-blue-600 hover:text-blue-700"
              onClick={() => {
                platform.openLink(
                  buildChatboxUrl(
                    `/redirect_app/view_more_plans/${settingActions.getLanguage()}?utm_source=app&utm_content=file_parse_error`
                  )
                )
                trackingEvent('click_view_more_plans_button_from_file_parse_error', {
                  event_category: 'user',
                })
              }}
            />
          ),
          OpenDocumentParserSettingButton: (
            <a
              className="cursor-pointer underline font-semibold text-blue-600 hover:text-blue-700"
              onClick={() => {
                onClose()
                navigateToSettings('/document-parser')
              }}
            />
          ),
          LinkToHomePage: <LinkTargetBlank href="https://chatboxai.app" />,
          LinkToAdvancedFileProcessing: (
            <LinkTargetBlank
              href={buildChatboxUrl(
                `/redirect_app/advanced_file_processing/${settingActions.getLanguage()}?utm_source=app&utm_content=file_parse_error`
              )}
            />
          ),
          LinkToAdvancedUrlProcessing: (
            <LinkTargetBlank
              href={buildChatboxUrl(
                `/redirect_app/advanced_url_processing/${settingActions.getLanguage()}?utm_source=app&utm_content=file_parse_error`
              )}
            />
          ),
        }}
      />
    )
  }

  return (
    <AdaptiveModal opened={modal.visible} onClose={onClose} size="md" centered title={t('File Processing Error')}>
      <Stack gap="md">
        {fileName && (
          <Text size="sm" c="chatbox-secondary">
            {t('File')}: {fileName}
          </Text>
        )}

        <Alert icon={<ScalableIcon size={20} icon={IconAlertCircle} />} color="orange" variant="light">
          {renderErrorTips()}
        </Alert>

        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={onClose} />
        </AdaptiveModal.Actions>
      </Stack>
    </AdaptiveModal>
  )
})

export default FileParseError
