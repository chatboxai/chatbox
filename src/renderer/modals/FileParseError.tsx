import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Alert, Stack, Text } from '@mantine/core'
import {
  LOCAL_PARSER_FILE_TOO_LARGE_ERROR,
  LOCAL_PARSER_MAX_PDF_FILE_SIZE_LABEL,
  LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR,
} from '@shared/file-parse-errors'
import { IconAlertCircle } from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import LinkTargetBlank from '@/components/common/Link'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { navigateToSettings } from '@/modals/settings-navigation'
import { trackingEvent } from '@/packages/event'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import {
  isSessionAttachmentRagAuthError,
  isSessionAttachmentRagIndexingError,
  SESSION_ATTACHMENT_RAG_PARSED_CONTENT_TOO_LARGE_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_KNOWLEDGE_BASE_ERROR,
  SESSION_ATTACHMENT_RAG_REQUIRES_TOOL_USE_MODEL_ERROR,
} from '@/stores/sessionAttachmentRagErrors'
import * as settingActions from '@/stores/settingActions'
import { getFileParseErrorI18nKey } from '@/utils/file-parse-error'

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

  // 根据错误码和平台能力获取错误文案
  const errorI18nKey = getFileParseErrorI18nKey(errorCode, platform.isDesktopLike)

  // 错误提示内容
  const renderErrorTips = () => {
    if (errorCode === LOCAL_PARSER_PDF_PASSWORD_PROTECTED_ERROR) {
      return (
        <Text>
          {t('This PDF is password-protected, so its content cannot be read. Remove the password and upload it again.')}
        </Text>
      )
    }
    if (errorCode === LOCAL_PARSER_FILE_TOO_LARGE_ERROR) {
      return (
        <Text>
          {t('This PDF is too large to process (max {{size}}). Please upload a smaller file.', {
            size: LOCAL_PARSER_MAX_PDF_FILE_SIZE_LABEL,
          })}
        </Text>
      )
    }
    if (isSessionAttachmentRagAuthError(errorCode)) {
      return (
        <Text>
          {t(
            'This large file needs Chatbox AI to finish indexing. Sign in to Chatbox AI, then retry this file. If you do not want to use Chatbox AI, remove the file and upload a smaller attachment instead.'
          )}
        </Text>
      )
    }
    if (isSessionAttachmentRagIndexingError(errorCode)) {
      return <Text>{`${t('Indexing failed')}. ${t('Continue')}`}</Text>
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

    if (!errorI18nKey) {
      // 未知错误
      return <Text>{t('Failed to parse file. Please try again or use a different file format.')}</Text>
    }

    return (
      <Trans
        i18nKey={errorI18nKey}
        values={{
          model: t('current model'),
        }}
        components={{
          OpenSettingButton: (
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 underline font-semibold text-blue-600 hover:text-blue-700"
              onClick={() => {
                onClose()
                navigateToSettings('/chatbox-ai')
              }}
            />
          ),
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
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 underline font-semibold text-blue-600 hover:text-blue-700"
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
