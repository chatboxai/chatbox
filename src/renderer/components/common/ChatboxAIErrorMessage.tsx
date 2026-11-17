import { CircularProgress, Link } from '@mui/material'
import { ChatboxAIAPIError } from '@shared/models/errors'
import { type CSSProperties, type FC, type ReactNode, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import LinkTargetBlank from '@/components/common/Link'
import { navigateToSettings } from '@/modals/settings-navigation'
import { trackingEvent } from '@/packages/event'
import { openLinkWithAuth } from '@/packages/openLinkWithAuth'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import { useAuthInfoStore } from '@/stores/authInfoStore'
import * as settingActions from '@/stores/settingActions'
import { useSettingsStore } from '@/stores/settingsStore'

interface ChatboxAIErrorMessageProps {
  errorCode: number
  /** Optional model name for `{{model}}` interpolation in i18n keys. */
  model?: string
  /** Tracking source label appended to upgrade-link analytics events. */
  trackingSource?: string
  linkStyle?: CSSProperties
}

const SUPPORTED_WEB_BROWSING_MODELS = 'gemini-2.0-flash(API), perplexity API'

function ClaimFreePlanLink({ children, linkStyle }: { children?: ReactNode; linkStyle?: CSSProperties }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [opened, setOpened] = useState(false)
  const pendingRef = useRef(false)

  const handleClick = async () => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      await openLinkWithAuth(
        buildChatboxUrl(
          `/redirect_app/claim_free_plan/${settingActions.getLanguage()}/?utm_source=app&utm_content=msg_license_not_found_claim_free`
        )
      )
      setOpened(true)
    } catch (error) {
      console.error('Failed to open Chatbox AI free plan page:', error)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Link component="button" type="button" style={linkStyle} disabled={pending} onClick={() => void handleClick()}>
        {children}
      </Link>
      {pending && <CircularProgress size={12} aria-label={t('Loading...') || 'Loading...'} />}
      {opened && (
        <span>
          {' '}
          <Trans
            i18nKey="After claiming your free plan, open Chatbox AI settings to activate it"
            components={{
              OpenChatboxSettingsButton: (
                <Link
                  component="button"
                  type="button"
                  style={linkStyle}
                  onClick={() => navigateToSettings('chatbox-ai?view=login')}
                />
              ),
            }}
          />
        </span>
      )}
    </span>
  )
}

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
  const isLoggedIn = useAuthInfoStore((state) => Boolean(state.accessToken && state.refreshToken))
  const isManualLicense = useSettingsStore((state) => state.licenseActivationMethod === 'manual')
  const detail = ChatboxAIAPIError.getDetail(errorCode)
  if (!detail) return null

  if (detail.name === 'license_not_found' || detail.name === 'license_key_required')
    return (
      <Trans
        i18nKey={
          isLoggedIn && isManualLicense && detail.name === 'license_not_found'
            ? 'Chatbox AI manual license not found'
            : isLoggedIn
              ? 'Chatbox AI license missing for signed-in user'
              : 'Chatbox AI license missing for signed-out user'
        }
        components={{
          OpenChatboxLoginButton: (
            <Link
              component="button"
              type="button"
              style={linkStyle}
              onClick={() => navigateToSettings('chatbox-ai?view=login')}
            />
          ),
          OpenClaimFreePlanButton: <ClaimFreePlanLink linkStyle={linkStyle} />,
          OpenManualLicenseButton: (
            <Link
              component="button"
              type="button"
              style={linkStyle}
              onClick={() => navigateToSettings('chatbox-ai?view=licenseKey')}
            />
          ),
        }}
      />
    )

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
