import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Alert, Stack, Text } from '@mantine/core'
import { ChatboxAIAPIError } from '@shared/models/errors'
import { IconAlertCircle } from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { navigateToSettings } from '@/modals/Settings'

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
                onClose()
                navigateToSettings('/provider')
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
          LinkToHomePage: <span />,
          LinkToAdvancedFileProcessing: <span />,
          LinkToAdvancedUrlProcessing: <span />,
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
