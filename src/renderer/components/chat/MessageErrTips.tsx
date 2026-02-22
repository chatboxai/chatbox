import { ActionIcon, Collapse, Flex, Tooltip } from '@mantine/core'
import { Link } from '@mui/material'
import Alert from '@mui/material/Alert'
import { aiProviderNameHash } from '@shared/models'
import { ChatboxAIAPIError } from '@shared/models/errors'
import type { Message } from '@shared/types'
import { IconCheck, IconChevronDown, IconChevronUp, IconCopy } from '@tabler/icons-react'
import type React from 'react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useCopied } from '@/hooks/useCopied'
import { navigateToSettings } from '@/modals/Settings'
import * as settingActions from '@/stores/settingActions'

const MAX_CHARS = 200
const MAX_LINES = 3

function shouldTruncate(text: string): boolean {
  if (text.length > MAX_CHARS) return true
  const lineCount = text.split('\n').length
  return lineCount > MAX_LINES
}

function getTruncatedText(text: string): string {
  if (text.length > MAX_CHARS) {
    return `${text.slice(0, MAX_CHARS)}...`
  }
  const lines = text.split('\n')
  if (lines.length > MAX_LINES) {
    return `${lines.slice(0, MAX_LINES).join('\n')}...`
  }
  return text
}

/**
 * Detects if an error message indicates a context length exceeded error from various AI providers.
 */
export function isContextLengthError(errorText: string | null | undefined): boolean {
  if (!errorText) return false
  const text = errorText.toLowerCase()

  if (text.includes('context_length_exceeded')) return true
  if (text.includes('prompt is too long')) return true
  if (text.includes('maximum context length')) return true
  if (text.includes('input token limit')) return true
  if (text.includes('token') && text.includes('exceed') && text.includes('limit')) return true
  if (text.includes('exceed') && text.includes('max_prompt_tokens')) return true

  return false
}

export default function MessageErrTips(props: { msg: Message }) {
  const { msg } = props
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const errorMessage = msg.errorExtra?.responseBody
    ? (() => {
        try {
          const json = JSON.parse(msg.errorExtra.responseBody as string)
          return JSON.stringify(json, null, 2)
        } catch {
          return String(msg.errorExtra.responseBody)
        }
      })()
    : msg.error || ''

  const { copied, copy } = useCopied(errorMessage)
  const isTruncated = shouldTruncate(errorMessage)

  if (!msg.error) {
    return null
  }

  const tips: React.ReactNode[] = []
  let onlyShowTips = false // 是否只显示提示，不显示错误信息详情

  if (isContextLengthError(msg.error) || isContextLengthError(errorMessage)) {
    tips.push(
      <Trans i18nKey="Your conversation has exceeded the model's context limit. Try compressing the conversation, starting a new chat, or reducing the number of context messages in settings." />
    )
  } else if (msg.error.startsWith('OCR Error')) {
    tips.push(
      <Trans
        i18nKey="OCR processing failed (provider: {{aiProvider}}). Please check your <OpenSettingButton>OCR model settings</OpenSettingButton> and ensure the configured model is available."
        values={{
          aiProvider: msg.errorExtra?.['aiProvider'] || 'AI Provider',
        }}
        components={{
          OpenSettingButton: (
            <Link
              className="cursor-pointer italic"
              onClick={() => {
                navigateToSettings('/default-models')
              }}
            ></Link>
          ),
        }}
      />
    )
  } else if (msg.error.startsWith('API Error')) {
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
                navigateToSettings(msg.aiProvider ? `/provider/${msg.aiProvider}` : '/provider')
              }}
            />
          ),
          LinkToLicensePricing: <span className="font-bold text-gray-700" />,
          a: <span />,
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
            key="link"
            className="cursor-pointer font-bold"
            onClick={() => {
              navigateToSettings()
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
                  navigateToSettings()
                }}
              ></Link>
            ),
            OpenExtensionSettingButton: (
              <Link
                className="cursor-pointer italic"
                onClick={() => {
                  navigateToSettings('/web-search')
                }}
              ></Link>
            ),
            OpenMorePlanButton: (
              <Link
                className="cursor-pointer italic"
                onClick={() => {
                  navigateToSettings('/provider')
                }}
              ></Link>
            ),
            LinkToHomePage: <span />,
            LinkToAdvancedFileProcessing: <span />,
            LinkToAdvancedUrlProcessing: <span />,
            OpenDocumentParserSettingButton: (
              <Link
                className="cursor-pointer italic"
                onClick={() => {
                  navigateToSettings('/document-parser')
                }}
              ></Link>
            ),
          }}
        />
      )
    }
  } else {
    tips.push(<Trans i18nKey="unknown error tips" components={[<span key="a"></span>]} />)
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
          {isTruncated ? (
            <div
              className="text-sm p-2 rounded-md bg-red-50 dark:bg-red-900/20 cursor-pointer overflow-hidden"
              onClick={() => setExpanded(!expanded)}
            >
              <Flex align="flex-start" gap="xs" className="min-w-0">
                <ActionIcon variant="transparent" size="xs" c="red" p={0} className="flex-shrink-0">
                  {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                </ActionIcon>
                <div className="flex-1 min-w-0 whitespace-pre-wrap break-all">
                  {expanded ? errorMessage : getTruncatedText(errorMessage)}
                </div>
              </Flex>
              <Collapse in={expanded}>
                <Flex justify="flex-end" mt="xs">
                  <Tooltip label={t('copy')} withArrow openDelay={1000}>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      color="red"
                      onClick={(e) => {
                        e.stopPropagation()
                        copy()
                      }}
                    >
                      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                </Flex>
              </Collapse>
            </div>
          ) : (
            <div className="text-sm p-2 rounded-md bg-red-50 dark:bg-red-900/20 overflow-hidden">
              <div className="whitespace-pre-wrap break-all">{errorMessage}</div>
              <Flex justify="flex-end" mt="xs">
                <Tooltip label={t('copy')} withArrow openDelay={1000}>
                  <ActionIcon variant="subtle" size="sm" color="red" onClick={() => copy()}>
                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  </ActionIcon>
                </Tooltip>
              </Flex>
            </div>
          )}
        </>
      )}
    </Alert>
  )
}
