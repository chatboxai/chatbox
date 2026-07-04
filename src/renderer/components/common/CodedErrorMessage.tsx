import { Link } from '@mui/material'
import { CodedError } from '@shared/models/errors'
import type { FC } from 'react'
import { Trans } from 'react-i18next'
import { navigateToSettings } from '@/modals/Settings'

interface CodedErrorMessageProps {
  errorCode: number
  /** Optional model name for `{{model}}` interpolation in i18n keys. */
  model?: string
  /** Kept for callers that still identify where the local-only error was rendered. */
  trackingSource?: string
}

const SUPPORTED_WEB_BROWSING_MODELS = 'gemini-2.0-flash(API), perplexity API'

/**
 * Renders a localized message for a known CodedError code, with action
 * links (open settings, switch search provider, upgrade plan). Returns `null`
 * for unknown codes so callers can fall back to a generic message.
 */
export const CodedErrorMessage: FC<CodedErrorMessageProps> = ({ errorCode, model }) => {
  const detail = CodedError.getDetail(errorCode)
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
            className="cursor-pointer italic"
            onClick={() => {
              navigateToSettings()
            }}
          />
        ),
        OpenExtensionSettingButton: (
          <Link
            component="button"
            type="button"
            className="cursor-pointer italic"
            onClick={() => {
              navigateToSettings('/web-search')
            }}
          />
        ),
        OpenMorePlanButton: (
          <Link
            component="button"
            type="button"
            className="cursor-pointer italic"
            onClick={() => {
              navigateToSettings()
            }}
          />
        ),
        LinkToHomePage: <span />,
        LinkToAdvancedFileProcessing: <span />,
        LinkToAdvancedUrlProcessing: <span />,
        OpenDocumentParserSettingButton: (
          <Link
            component="button"
            type="button"
            className="cursor-pointer italic"
            onClick={() => {
              navigateToSettings('/document-parser')
            }}
          />
        ),
      }}
    />
  )
}
