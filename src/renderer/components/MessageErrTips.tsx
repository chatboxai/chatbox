import { Link } from '@mui/material'
import Alert from '@mui/material/Alert'
import { useNavigate } from '@tanstack/react-router'
import { useSetAtom } from 'jotai'
import type React from 'react'
import { Trans } from 'react-i18next'
import { trackingEvent } from '@/packages/event'
import platform from '@/platform'
import { aiProviderNameHash } from '../../shared/models'
import { ChatboxAIAPIError } from '../../shared/models/errors'
import type { Message } from '../../shared/types'
import * as atoms from '../stores/atoms'
import * as settingActions from '../stores/settingActions'
import LinkTargetBlank from './Link'

export default function MessageErrTips(props: { msg: Message }) {
  const { msg } = props
  const navigate = useNavigate()
  const setOpenSettingDialogAtom = useSetAtom(atoms.openSettingDialogAtom)
  if (!msg.error) {
    return null
  }
  const errorMessage = msg.errorExtra?.responseBody
    ? (() => {
        try {
          const json = JSON.parse(msg.errorExtra.responseBody as string)
          return JSON.stringify(json, null, 2)
        } catch {
          return String(msg.errorExtra.responseBody)
        }
      })()
    : msg.error

  const tips: React.ReactNode[] = []
  let onlyShowTips = false // 是否只显示提示，不显示错误信息详情
  if (msg.error.startsWith('API Error')) {
    tips.push(
      <Trans
        i18nKey="Connection to {{aiProvider}} failed. This typically occurs due to incorrect configuration or {{aiProvider}} account issues. Please <buttonOpenSettings>check your settings</buttonOpenSettings> and verify your {{aiProvider}} account status, or purchase a <LinkToLicensePricing>Chatbox AI License</LinkToLicensePricing> to unlock all advanced models instantly without any configuration."
        values={{
          aiProvider: msg.aiProvider ? aiProviderNameHash[msg.aiProvider] : 'AI Provider',
        }}
        components={{
          buttonOpenSettings: (
            <a
              className="cursor-pointer underline font-bold hover:text-blue-600 transition-colors"
              onClick={() => {
                setOpenSettingDialogAtom('ai')
                navigate(
                  msg.aiProvider
                    ? {
                        to: '/settings/provider/$providerId',
                        params: { providerId: msg.aiProvider },
                      }
                    : {
                        to: '/settings/provider',
                      }
                )
              }}
            />
          ),
          LinkToLicensePricing: (
            <LinkTargetBlank
              className="!font-bold !text-gray-700 hover:!text-blue-600 transition-colors"
              href="https://chatboxai.app/redirect_app/advanced_url_processing"
            />
          ),
          a: <a href={`https://chatboxai.app/redirect_app/faqs/${settingActions.getLanguage()}`} target="_blank" />,
        }}
      />
    )
  } else if (msg.error.startsWith('Network Error')) {
    tips.push(
      <Trans
        i18nKey="network error tips"
        values={{
          host: msg.errorExtra?.['host'] || 'AI Provider',
        }}
      />
    )
    const proxy = settingActions.getProxy()
    if (proxy) {
      tips.push(<Trans i18nKey="network proxy error tips" values={{ proxy }} />)
    }
  } else if (msg.errorCode === 10003) {
    tips.push(
      <Trans
        i18nKey="ai provider no implemented paint tips"
        values={{
          aiProvider: msg.aiProvider ? aiProviderNameHash[msg.aiProvider] : 'AI Provider',
        }}
        components={[
          <Link
            key="0"
            className="cursor-pointer font-bold"
            onClick={() => {
              setOpenSettingDialogAtom('ai')
              navigate({
                to: '/settings',
              })
            }}
          ></Link>,
        ]}
      />
    )
  } else if (msg.errorCode && ChatboxAIAPIError.getDetail(msg.errorCode)) {
    const chatboxAIErrorDetail = ChatboxAIAPIError.getDetail(msg.errorCode)
    if (chatboxAIErrorDetail) {
      onlyShowTips = true
      tips.push(
        <Trans
          i18nKey={chatboxAIErrorDetail.i18nKey}
          values={{
            model: msg.model,
            supported_web_browsing_models: 'gemini-2.0-flash(API), perplexity API',
          }}
          components={{
            OpenSettingButton: (
              <Link
                className="cursor-pointer italic"
                onClick={() => {
                  setOpenSettingDialogAtom('ai')
                  navigate({
                    to: '/settings',
                  })
                }}
              ></Link>
            ),
            OpenExtensionSettingButton: (
              <Link
                className="cursor-pointer italic"
                onClick={() => {
                  setOpenSettingDialogAtom('extension')
                  navigate({
                    to: '/settings',
                  })
                }}
              ></Link>
            ),
            OpenMorePlanButton: (
              <Link
                className="cursor-pointer italic"
                onClick={() => {
                  platform.openLink('https://chatboxai.app/redirect_app/view_more_plans')
                  trackingEvent('click_view_more_plans_button_from_upgrade_error_tips', {
                    event_category: 'user',
                  })
                }}
              ></Link>
            ),
            LinkToHomePage: <LinkTargetBlank href="https://chatboxai.app"></LinkTargetBlank>,
            LinkToAdvancedFileProcessing: (
              <LinkTargetBlank href="https://chatboxai.app/redirect_app/advanced_file_processing"></LinkTargetBlank>
            ),
            LinkToAdvancedUrlProcessing: (
              <LinkTargetBlank href="https://chatboxai.app/redirect_app/advanced_url_processing"></LinkTargetBlank>
            ),
          }}
        />
      )
    }
  } else {
    tips.push(
      <Trans
        i18nKey="unknown error tips"
        components={[
          <a
            key="0"
            href={`https://chatboxai.app/redirect_app/faqs/${settingActions.getLanguage()}`}
            target="_blank"
          ></a>,
        ]}
      />
    )
  }
  return (
    <Alert icon={false} severity="error" className="message-error-tips">
      {tips.map((tip, i) => (
        <b key={`${i}-${tip}`}>{tip}</b>
      ))}
      {onlyShowTips ? null : (
        <>
          <br />
          <br />
          <div className="text-sm whitespace-pre-wrap p-2 rounded-md bg-red-50 dark:bg-red-900/20">{errorMessage}</div>
        </>
      )}
    </Alert>
  )
}
