import { Link } from '@mui/material'
import { ChatboxAIAPIError } from '@shared/models/errors'
import type { CSSProperties, FC } from 'react'
import { Trans } from 'react-i18next'
import LinkTargetBlank from '@/components/common/Link'
import { navigateToSettings } from '@/modals/settings-navigation'
import { trackingEvent } from '@/packages/event'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'

interface ChatboxAIErrorMessageProps {
  errorCode: number
  /** Optional model name for `{{model}}` interpolation in i18n keys. */
  model?: string
  /** Tracking source label appended to upgrade-link analytics events. */
  trackingSource?: string
  linkStyle?: CSSProperties
}

const SUPPORTED_WEB_BROWSING_MODELS = 'gemini-2.0-flash(API), perplexity API'

/**
 * Renders a localized message for a known ChatboxAIAPIError code, with action
 * links (open settings, switch search provider, upgrade plan). Returns `null`
 * for unknown codes so callers can fall back to a generic message.
 */
export const ChatboxAIErrorMessage: FC<ChatboxAIErrorMessageProps> = ({
  errorCode,
  model,
  trackingSource = 'msg_upgrade_required',
  linkStyle,
}) => {
  const detail = ChatboxAIAPIError.getDetail(errorCode)
  if (!detail) return null

  return (
    <Trans
      i18nKey={detail.i18nKey}
      values={{
        model,
        supported_web_browsing_models: SUPPORTED_WEB_BROWSING_MODELS,
      }}
      components={{
        OpenSettingButton: (
          <Link
            component="button"
            type="button"
            className={linkStyle ? 'cursor-pointer' : 'cursor-pointer italic'}
            style={linkStyle}
            onClick={() => {
              navigateToSettings()
            }}
          />
        ),
        OpenExtensionSettingButton: (
          <Link
            component="button"
            type="button"
            className={linkStyle ? 'cursor-pointer' : 'cursor-pointer italic'}
            style={linkStyle}
            onClick={() => {
              navigateToSettings('/web-search')
            }}
          />
        ),
        OpenMorePlanButton: (
          <Link
            component="button"
            type="button"
            className={linkStyle ? 'cursor-pointer' : 'cursor-pointer italic'}
            style={linkStyle}
            onClick={() => {
              platform.openLink(
                buildChatboxUrl(
                  `/redirect_app/view_more_plans/${settingActions.getLanguage()}?utm_source=app&utm_content=${trackingSource}`
                )
              )
              trackingEvent('click_view_more_plans_button_from_upgrade_error_tips', {
                event_category: 'user',
              })
            }}
          />
        ),
        LinkToHomePage: <LinkTargetBlank style={linkStyle} href="https://chatboxai.app" />,
        LinkToAdvancedFileProcessing: (
          <LinkTargetBlank
            style={linkStyle}
            href={buildChatboxUrl(
              `/redirect_app/advanced_file_processing/${settingActions.getLanguage()}?utm_source=app&utm_content=${trackingSource}`
            )}
          />
        ),
        LinkToAdvancedUrlProcessing: (
          <LinkTargetBlank
            style={linkStyle}
            href={buildChatboxUrl(
              `/redirect_app/advanced_url_processing/${settingActions.getLanguage()}?utm_source=app&utm_content=${trackingSource}`
            )}
          />
        ),
        OpenDocumentParserSettingButton: (
          <Link
            component="button"
            type="button"
            className={linkStyle ? 'cursor-pointer' : 'cursor-pointer italic'}
            style={linkStyle}
            onClick={() => {
              navigateToSettings('/document-parser')
            }}
          />
        ),
      }}
    />
  )
}
