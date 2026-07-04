import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Alert, Stack, Text } from '@mantine/core'
import { CodedError } from '@shared/models/errors'
import { IconAlertCircle } from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { navigateToSettings } from '@/modals/Settings'
import {
  isSessionAttachmentRagAuthError,
  isSessionAttachmentRagIndexingError,
  SESSION_ATTACHMENT_RAG_PARSED_CONTENT_TOO_LARGE_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_KNOWLEDGE_BASE_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_TOOL_USE_MODEL_ERROR,
} from '@/stores/sessionHelpers'

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
  const errorDetail = CodedError.codeNameMap[errorCode]

  // 错误提示内容
  const renderErrorTips = () => {
    if (isSessionAttachmentRagAuthError(errorCode)) {
      return (
        <Text>
          {t(
            'Large-file chat indexing is not available in this local-only build. Remove the file and upload a smaller attachment, or add it to Knowledge Base instead.'
          )}
        </Text>
      )
    }
    if (isSessionAttachmentRagIndexingError(errorCode)) {
      return (
        <Text>
          {t(
            'Large file indexing failed. The file was parsed, but WorkspAIce could not save the local search index. Remove this file and try uploading it again. If the problem continues, use a smaller file or Knowledge Base.'
          )}
        </Text>
      )
    }
    if (errorCode === SESSION_ATTACHMENT_RAG_REQUIRES_KNOWLEDGE_BASE_ERROR) {
      return (
        <Text>
          {t('This attachment is too large for chat attachments. Please upload it through Knowledge Base instead.')}
        </Text>
      )
    }
    if (errorCode === SESSION_ATTACHMENT_RAG_PARSED_CONTENT_TOO_LARGE_ERROR) {
      return (
        <Text>
          {t(
            'This document contains too much text for chat attachments. Please upload it through Knowledge Base instead.'
          )}
        </Text>
      )
    }
    if (errorCode === SESSION_ATTACHMENT_RAG_REQUIRES_TOOL_USE_MODEL_ERROR) {
      return (
        <Text>
          {t(
            'Large file Q&A requires a model with tool use support. Switch to a compatible model or remove this file.'
          )}
        </Text>
      )
    }

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
                navigateToSettings('/document-parser')
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
          <Text size="sm" c="workspaice-secondary">
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
